import CSQLite
import Foundation

/// Safe categories only. Do not include SQL, paths, tokens, or raw SQLite messages.
public enum StorageError: Error, Equatable, Sendable {
    case missingDatabase, alreadyExists, unavailable, busy, corrupt, wrongDatabase
    case unsupportedSchema(Int64), closed, conflict, invalidSelection, databaseFailure
}

enum SQLValue: Equatable {
    case integer(Int64), text(String), blob(Data), null
}

final class SQLiteDatabase {
    private var connection: OpaquePointer?

    init(path: String, busyTimeoutMilliseconds: Int32) throws {
        guard busyTimeoutMilliseconds >= 0 else { throw StorageError.databaseFailure }
        var handle: OpaquePointer?
        let code = sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil)
        guard code == SQLITE_OK, let handle else {
            if let handle { sqlite3_close(handle) }
            throw Self.failure(code)
        }
        connection = handle
        guard sqlite3_busy_timeout(handle, busyTimeoutMilliseconds) == SQLITE_OK else {
            try? close()
            throw StorageError.databaseFailure
        }
        try execute("PRAGMA foreign_keys=ON")
    }

    deinit { if let connection { sqlite3_close_v2(connection) } }

    func close() throws {
        guard let handle = connection else { return }
        let code = sqlite3_close(handle)
        guard code == SQLITE_OK else { throw Self.failure(code) }
        connection = nil
    }

    func execute(_ sql: String, _ bindings: [SQLValue] = []) throws {
        _ = try rows(sql, bindings)
    }

    func rows(_ sql: String, _ bindings: [SQLValue] = []) throws -> [[SQLValue]] {
        guard let connection else { throw StorageError.closed }
        var statement: OpaquePointer?
        let prepared = sqlite3_prepare_v2(connection, sql, -1, &statement, nil)
        guard prepared == SQLITE_OK, let statement else { throw Self.failure(prepared) }
        defer { sqlite3_finalize(statement) }
        guard Int(sqlite3_bind_parameter_count(statement)) == bindings.count else { throw StorageError.databaseFailure }
        for (offset, value) in bindings.enumerated() {
            let index = Int32(offset + 1)
            let code: Int32
            switch value {
            case let .integer(number): code = sqlite3_bind_int64(statement, index, number)
            case let .text(text):
                code = text.withCString { sqlite3_bind_text(statement, index, $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
            case let .blob(data):
                guard data.count <= Int(Int32.max) else { throw StorageError.databaseFailure }
                code = data.isEmpty ? sqlite3_bind_zeroblob(statement, index, 0) : data.withUnsafeBytes {
                    sqlite3_bind_blob(statement, index, $0.baseAddress, Int32(data.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self))
                }
            case .null: code = sqlite3_bind_null(statement, index)
            }
            guard code == SQLITE_OK else { throw Self.failure(code) }
        }
        var result: [[SQLValue]] = []
        while true {
            let code = sqlite3_step(statement)
            if code == SQLITE_DONE { return result }
            guard code == SQLITE_ROW else { throw Self.failure(code) }
            var row: [SQLValue] = []
            for column in 0..<sqlite3_column_count(statement) {
                switch sqlite3_column_type(statement, column) {
                case SQLITE_INTEGER: row.append(.integer(sqlite3_column_int64(statement, column)))
                case SQLITE_TEXT:
                    guard let bytes = sqlite3_column_text(statement, column),
                          let text = String(data: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, column))), encoding: .utf8)
                    else { throw StorageError.corrupt }
                    row.append(.text(text))
                case SQLITE_BLOB:
                    let count = Int(sqlite3_column_bytes(statement, column))
                    if count == 0 { row.append(.blob(Data())) }
                    else if let bytes = sqlite3_column_blob(statement, column) { row.append(.blob(Data(bytes: bytes, count: count))) }
                    else { throw StorageError.corrupt }
                case SQLITE_NULL: row.append(.null)
                default: throw StorageError.corrupt
                }
            }
            result.append(row)
        }
    }

    /// Synchronous closure only; OS requests and other awaits cannot run inside this API.
    func transaction<T>(writer: Bool, _ body: () throws -> T) throws -> T {
        try execute(writer ? "BEGIN IMMEDIATE" : "BEGIN DEFERRED")
        do {
            let result = try body()
            try execute("COMMIT")
            return result
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private static func failure(_ code: Int32) -> StorageError {
        switch code & 0xff {
        case SQLITE_BUSY, SQLITE_LOCKED: .busy
        case SQLITE_CORRUPT, SQLITE_NOTADB: .corrupt
        case SQLITE_CANTOPEN, SQLITE_IOERR, SQLITE_FULL, SQLITE_READONLY, SQLITE_PERM, SQLITE_AUTH: .unavailable
        case SQLITE_CONSTRAINT: .conflict
        default: .databaseFailure
        }
    }
}
