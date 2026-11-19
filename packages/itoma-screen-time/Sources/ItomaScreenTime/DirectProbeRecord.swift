import Foundation
import Darwin

public enum DirectProbeFailure: Error { case busy, unavailable, invalid, changed, normalRulesActive }
public struct DirectProbeRecord: Codable, Sendable {
    public enum Phase: String, Codable, Sendable { case prepared, registering, armed, stopped }
    public enum Observation: String, Codable, Sendable { case none, applied, cleared, uncertain }
    public enum Origin: String, Codable, Sendable { case none, monitor, manual, expiry }
    public var id: UUID
    public var phase: Phase
    public var startsAt: Double
    public var endsAt: Double
    public var tokenData: Data?
    public var hasSchedule = true
    public var observation: Observation = .none
    public var origin: Origin = .none
    public var observedAt: Double?
    public var activityName: String { "itoma.directprobe.\(id.uuidString.lowercased())" }

    public init(id: UUID = UUID(), startsAt: Double, tokenData: Data) throws {
        self.id = id; phase = .prepared; self.startsAt = startsAt; endsAt = startsAt + 1200
        self.tokenData = tokenData
        try validate()
    }
    public mutating func stop() { phase = .stopped; tokenData = nil }
    public func validate() throws {
        guard startsAt.isFinite, endsAt.isFinite, endsAt - startsAt == 1200,
              observedAt?.isFinite != false,
              phase == .stopped ? tokenData == nil : (tokenData?.isEmpty == false && (tokenData?.count ?? 0) <= 16384)
        else { throw DirectProbeFailure.invalid }
    }
    public enum Decision { case ignore, apply, clear }
    public func decision(activity: String, now: Double) -> Decision {
        guard now.isFinite, activity == activityName else { return .ignore }
        if phase == .stopped { return .clear }
        guard phase == .armed else { return .ignore }
        if now >= endsAt { return .clear }
        return now >= startsAt ? .apply : .ignore
    }
}

/// One bounded record and one nonblocking lock shared by host/Extension. No product DB schema.
public struct DirectProbeFile {
    public let directory: URL
    public init(directory: URL) { self.directory = directory }
    public var recordURL: URL { directory.appendingPathComponent("direct-probe.json") }
    public var lockURL: URL { directory.appendingPathComponent("direct-probe.lock") }
    public func withLock<T>(_ body: (DirectProbeFile) throws -> T) throws -> T {
        let descriptor = open(lockURL.path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw DirectProbeFailure.unavailable }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { throw DirectProbeFailure.busy }
        defer { _ = flock(descriptor, LOCK_UN) }
        return try body(self)
    }
    public func read() throws -> DirectProbeRecord? {
        guard FileManager.default.fileExists(atPath: recordURL.path) else { return nil }
        let size = try recordURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
        guard size <= 32768 else { throw DirectProbeFailure.invalid }
        let record = try JSONDecoder().decode(DirectProbeRecord.self, from: Data(contentsOf: recordURL))
        try record.validate(); return record
    }
    public func write(_ record: DirectProbeRecord) throws {
        try record.validate()
        let data = try JSONEncoder().encode(record)
        guard data.count <= 32768 else { throw DirectProbeFailure.invalid }
        try data.write(to: recordURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: recordURL.path)
    }
}
