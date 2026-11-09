import Foundation
import ItomaCore
import ItomaStorage

public enum ScreenTimeRuntimeError: Error { case unavailable, invalidSelection, scheduleUnavailable, busy }

public enum ScreenTimeFiles {
    public static func sharedDirectory() throws -> URL {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "ITOMAAppGroup") as? String,
              group.hasPrefix("group."),
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw ScreenTimeRuntimeError.unavailable
        }
        return container.appendingPathComponent("ITOMA-Control", isDirectory: true)
    }

    public static func prepareDirectory(_ directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var directory = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
    }

    public static func protectDatabase(_ url: URL) throws {
        for file in [url.path, url.path + "-wal", url.path + "-shm"] where FileManager.default.fileExists(atPath: file) {
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: file)
        }
    }
}
