import Foundation
import ItomaCore

/// A display filter, not a reconstruction of past policy or an aggregation metric.
public struct HistoryDayRange: Sendable {
    public let start: Instant
    public let end: Instant
    public init(day: String, timeZone: TimeZone) throws {
        guard day.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { throw HistoryError.invalidPage }
        let numbers = day.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        guard numbers.count == 3, (1900...9998).contains(numbers[0]),
              let date = calendar.date(from: DateComponents(year: numbers[0], month: numbers[1], day: numbers[2])),
              calendar.component(.year, from: date) == numbers[0], calendar.component(.month, from: date) == numbers[1],
              calendar.component(.day, from: date) == numbers[2], let range = calendar.dateInterval(of: .day, for: date) else { throw HistoryError.invalidPage }
        start = try Instant(range.start); end = try Instant(range.end)
    }
}
