import ItomaSQLite

/// Safe categories only. Do not include SQL, paths, tokens, or raw SQLite messages.
public enum StorageError: Error, Equatable, Sendable {
    case missingDatabase, alreadyExists, unavailable, busy, corrupt, wrongDatabase
    case unsupportedSchema(Int64), closed, conflict, invalidSelection, databaseFailure
    case invalidCommand, transactionExpired, nestedTransaction, rollbackRequired

    static func translating<T>(_ body: () throws -> T) throws -> T {
        do { return try body() }
        catch let error as SQLiteFailure {
            switch error {
            case .busy: throw Self.busy
            case .corrupt: throw Self.corrupt
            case .unavailable: throw Self.unavailable
            case .closed: throw Self.closed
            case .constraint: throw Self.conflict
            case .nestedTransaction: throw Self.nestedTransaction
            case .invalidArgument, .failure: throw Self.databaseFailure
            }
        }
    }
}
