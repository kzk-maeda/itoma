import Foundation
import ItomaCore
import ItomaSQLite
import ItomaStorage

/// Main-app private failures. They never include the reason, path, SQL, or OS error text.
public enum HistoryError: Error, Equatable, Sendable {
    case missingDatabase, alreadyExists, unavailable, busy, corrupt, wrongDatabase
    case unsupportedSchema(Int64), closed, conflict, databaseFailure
    case invalidReason, invalidDummySelection, invalidCapacity, invalidPage, capacityExceeded, deleted

    static func translating<T>(_ body: () throws -> T) throws -> T {
        do { return try body() }
        catch let error as SQLiteFailure {
            switch error {
            case .busy: throw Self.busy
            case .corrupt: throw Self.corrupt
            case .unavailable: throw Self.unavailable
            case .closed: throw Self.closed
            case .constraint: throw Self.conflict
            case .invalidArgument, .failure, .nestedTransaction, .rollbackFailure: throw Self.databaseFailure
            }
        }
    }
}

/// Inject after product/device measurement. No provisional MiB value is a shipping default.
public struct HistoryCapacityPolicy: Equatable, Sendable {
    public let warningBytes: Int64
    public let maximumBytes: Int64

    public init(warningBytes: Int64, maximumBytes: Int64) throws {
        guard warningBytes >= 0, maximumBytes > 0, warningBytes <= maximumBytes else {
            throw HistoryError.invalidCapacity
        }
        self.warningBytes = warningBytes
        self.maximumBytes = maximumBytes
    }
}

public struct HistoryCapacity: Equatable, Sendable {
    public let logicalPayloadBytes: Int64
    public let warningReached: Bool
    public let limitReached: Bool
}

/// File sizes are observations separate from payload capacity, not a total-device guarantee.
/// An absent sidecar has size 0; nil means its size could not be observed.
public struct HistoryFileUsage: Equatable, Sendable {
    public let databaseBytes: Int64?
    public let walBytes: Int64?
    public let sharedMemoryBytes: Int64?
}

/// Prepared means private commit only. It is never proof of shared acceptance or OS success.
/// A tombstone retains identity and time after an explicit deletion, without the body/hash.
public struct ReasonRecord: Equatable, Sendable {
    public let reasonRef: ReasonRef
    public let commandID: CommandID
    public let preparedAt: Instant
    public let body: String?
    public var isDeleted: Bool { body == nil }
}

/// Storage format only, with no default amount or live payment operation.
public struct DummyChoice: Equatable, Codable, Sendable {
    public let minorUnits: Int64
    public let currencyCode: String
    public init(minorUnits: Int64, currencyCode: String) throws {
        guard minorUnits >= 0, currencyCode.utf8.count == 3,
              currencyCode.utf8.allSatisfy({ (65...90).contains($0) }) else { throw HistoryError.invalidDummySelection }
        self.minorUnits = minorUnits; self.currencyCode = currencyCode
    }
    enum CodingKeys: CodingKey { case minorUnits, currencyCode }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(minorUnits: values.decode(Int64.self, forKey: .minorUnits),
                      currencyCode: values.decode(String.self, forKey: .currencyCode))
    }
}

public struct DummySelectionRecord: Equatable, Sendable {
    public let commandID: CommandID
    public let preparedAt: Instant
    public let choice: DummyChoice?
}

/// A pre-confirmation cancellation cannot carry a body, reasonRef, command, or dummy choice.
public enum PrivateHistoryRecord: Equatable, Codable, Sendable {
    case control(ControlHistoryEvent)
    case cancelled(id: EventID, at: Instant)

    public var id: EventID {
        switch self { case let .control(event): event.id; case let .cancelled(id, _): id }
    }
}

public struct StoredHistoryRecord: Equatable, Sendable {
    public let cursor: Int64
    public let record: PrivateHistoryRecord
}

public enum ReasonReconciliation: Equatable, Sendable {
    case missing, deleted, preparedOnly
    case sharedAccepted(CommandStatus)
}
