import Foundation
import ItomaSQLite
import Testing

@Test func explicitUTF8BindingsPreserveNulEmptyAndUnicodeAndRollback() throws {
    let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data().write(to: path)
    defer { try? FileManager.default.removeItem(at: path) }
    let database = try SQLiteDatabase(path: path.path, busyTimeoutMilliseconds: 1)
    try database.execute("CREATE TABLE values_test(value TEXT, payload BLOB)")
    let values = ["", "a\0b", "あいう🌱", "e\u{301}"]
    for value in values { try database.execute("INSERT INTO values_test VALUES (?,?)", [.text(value), .blob(Data(value.utf8))]) }
    let rows = try database.rows("SELECT value,payload FROM values_test ORDER BY rowid")
    for (row, value) in zip(rows, values) {
        guard case let .text(actual) = row[0], case let .blob(bytes) = row[1] else { Issue.record("Invalid binding type"); continue }
        #expect(Data(actual.utf8) == Data(value.utf8))
        #expect(bytes == Data(value.utf8))
    }
    enum Injected: Error { case stop }
    #expect(throws: Injected.stop) {
        try database.transaction(writer: true) {
            try database.execute("DELETE FROM values_test")
            throw Injected.stop
        }
    }
    #expect(try database.rows("SELECT count(*) FROM values_test") == [[.integer(4)]])
    #expect(throws: SQLiteFailure.nestedTransaction) {
        try database.transaction(writer: true) { try database.transaction(writer: false) {} }
    }
    #expect(try database.rows("SELECT count(*) FROM values_test") == [[.integer(4)]])
    try database.close()
}
