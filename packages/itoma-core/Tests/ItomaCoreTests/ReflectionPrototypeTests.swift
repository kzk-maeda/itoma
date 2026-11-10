import Foundation
import Testing
@testable import ItomaCore

private func rt(_ text: String) throws -> Instant { try Instant(ISO8601DateFormatter().date(from: text)!) }
private func ri(_ start: String, _ end: String) throws -> ReflectionPrototypeInterval { try .init(from: rt(start), until: rt(end)) }
private let source = UUID(uuidString: "00000000-0000-0000-0000-000000000136")!
private func dataset(unlocks: [ReflectionPrototypeInterval] = [], gaps: [ReflectionPrototypeInterval] = [],
                     restricted: [ReflectionPrototypeInterval]? = nil, asOf: String = "2026-11-09T23:00:00Z",
                     revision: Int64 = 1) throws -> ReflectionPrototypeDataset {
    let range = try ri("2026-11-09T21:00:00Z", "2026-11-09T23:00:00Z")
    return try .init(sourceID: source, revision: revision, asOf: rt(asOf), timeZone: "UTC", scope: .syntheticFixture,
        coverage: .recorded, recordedRange: range, restricted: restricted ?? [range], unlocked: unlocks, gaps: gaps)
}
private func snapshot(_ input: ReflectionPrototypeDataset) throws -> ReflectionPrototypeSnapshot {
    try ReflectionPrototypeCalculator.snapshot(input, period: .week, day: "2026-11-09")
}

@Test func reflectionSubtractsActualFiveMinutesAndEarlyEndTwoMinutes() throws {
    let five = try snapshot(dataset(unlocks: [ri("2026-11-09T21:30:00Z", "2026-11-09T21:35:00Z")]))
    let early = try snapshot(dataset(unlocks: [ri("2026-11-09T21:30:00Z", "2026-11-09T21:32:00Z")]))
    #expect(five.total.knownSeconds == 6900.0); #expect(early.total.knownSeconds == 7080.0)
    #expect(five.selected.knownSeconds == five.total.knownSeconds)
    #expect(five.buckets.first?.knownSeconds == five.total.knownSeconds)
    #expect(five.proofScope == .syntheticFixture)
}
@Test func reflectionUnionsRestrictionsAndOverlappingUnlocksBeforeSubtraction() throws {
    let r = try ri("2026-11-09T21:00:00Z", "2026-11-09T23:00:00Z")
    let input = try dataset(unlocks: [ri("2026-11-09T21:30:00Z", "2026-11-09T21:35:00Z"), ri("2026-11-09T21:32:00Z", "2026-11-09T21:37:00Z")], restricted: [r, r])
    #expect(try snapshot(input).total.knownSeconds == 113 * 60)
}
@Test func reflectionClipsFutureAndExcludesUnknownGapWithoutFillingIt() throws {
    #expect(try snapshot(dataset(asOf: "2026-11-09T21:45:00Z")).total.knownSeconds == 45 * 60)
    let result = try snapshot(dataset(gaps: [ri("2026-11-09T21:30:00Z", "2026-11-09T22:15:00Z")]))
    #expect(result.total.knownSeconds == 4500.0); #expect(result.total.coverage == .partial)
    #expect(result.trend.first?.coverage == .partial)
}
@Test func reflectionUsesRecordedIntervalsForStopAndEditRatherThanCurrentPolicy() throws {
    let paused = try dataset(restricted: [ri("2026-11-09T21:00:00Z", "2026-11-09T22:00:00Z"), ri("2026-11-09T22:30:00Z", "2026-11-09T23:00:00Z")])
    let edited = try dataset(restricted: [ri("2026-11-09T21:00:00Z", "2026-11-09T21:30:00Z"), ri("2026-11-09T22:00:00Z", "2026-11-09T23:00:00Z")])
    #expect(try snapshot(paused).total.knownSeconds == 90 * 60)
    #expect(try snapshot(edited).total.knownSeconds == 90 * 60)
}
@Test func reflectionTotalStaysFixedAcrossWeekMonthAndClippedDayNavigation() throws {
    let input = try dataset()
    let week = try snapshot(input)
    let month = try ReflectionPrototypeCalculator.snapshot(input, period: .month, day: "2026-11-01", expectedToken: week.token)
    #expect(month.token == week.token); #expect(month.total == week.total)
    #expect(month.buckets.count <= 6); #expect(week.buckets.count == 7)
    #expect(month.buckets.first?.day == "2026-11-01")
    let nextDay = try rt("2026-11-02T00:00:00Z").secondsSince1970
    #expect(month.buckets.first?.until == nextDay)
    let clipped = try ReflectionPrototypeCalculator.snapshot(input, period: .week, day: "2026-11-01",
        clippedTo: ri("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"))
    #expect(clipped.buckets.count == 1); #expect(clipped.total == week.total)
}
@Test func reflectionCalendarHandlesBothDSTLengths() throws {
    for (start, end, day, hours) in [("2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z", "2026-03-08", 23),
                                    ("2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z", "2026-11-01", 25)] {
        let range = try ri(start, end)
        let input = try ReflectionPrototypeDataset(sourceID: source, revision: 1, asOf: rt(end), timeZone: "America/New_York",
            scope: .syntheticFixture, coverage: .recorded, recordedRange: range, restricted: [range])
        let result = try ReflectionPrototypeCalculator.snapshot(input, period: .week, day: day)
        let bucket = try #require(result.buckets.first { $0.day == day })
        #expect(bucket.until - bucket.from == Double(hours * 3600)); #expect(result.total.knownSeconds == Double(hours * 3600))
    }
}
@Test func reflectionPointObservationsNeverBecomePositiveOrKnownZero() throws {
    let input = try ReflectionPrototypeDataset(sourceID: source, revision: 1, asOf: rt("2026-11-09T23:00:00Z"), timeZone: "UTC",
        scope: .pointObservations, coverage: .partial, recordedRange: ri("2026-11-09T21:00:00Z", "2026-11-09T23:00:00Z"))
    let result = try snapshot(input)
    #expect(result.total.knownSeconds == nil); #expect(result.total.coverage == .partial)
    #expect(result.buckets.allSatisfy { $0.knownSeconds == nil })
    #expect(throws: ReflectionPrototypeError.invalidInput) {
        try ReflectionPrototypeDataset(sourceID: source, revision: 1, asOf: rt("2026-11-09T23:00:00Z"), timeZone: "UTC", scope: .pointObservations,
            coverage: .recorded, recordedRange: ri("2026-11-09T21:00:00Z", "2026-11-09T23:00:00Z"), restricted: [ri("2026-11-09T21:00:00Z", "2026-11-09T23:00:00Z")])
    }
}
@Test func reflectionDistinguishesUnrecordedDeletedAndRecordedZero() throws {
    for coverage in [ReflectionPrototypeCoverage.notRecorded, .deleted] {
        let input = try ReflectionPrototypeDataset(sourceID: source, revision: 1, asOf: rt("2026-11-09T23:00:00Z"), timeZone: "UTC",
            scope: .pointObservations, coverage: coverage, recordedRange: nil)
        let week = try snapshot(input), month = try ReflectionPrototypeCalculator.snapshot(input, period: .month, day: "2026-11-01")
        #expect(week.total.knownSeconds == nil); #expect(week.total.coverage == coverage); #expect(week.total == month.total)
    }
    #expect(try snapshot(dataset(restricted: [])).total.knownSeconds == 0)
}
@Test func reflectionTokenChangesInvalidateTheWholeDataset() throws {
    let old = try snapshot(dataset())
    #expect(throws: ReflectionPrototypeError.changed) {
        try ReflectionPrototypeCalculator.snapshot(dataset(revision: 2), period: .month, day: "2026-11-01", expectedToken: old.token)
    }
}
@Test func reflectionValidatesDatesIntervalsAndBoundsAndKeepsPreciseSeconds() throws {
    for day in ["2026-02-30", "2026-2-01", "2026-13-01", "0000-01-01", "2026-11-09\0"] {
        #expect(throws: ReflectionPrototypeError.invalidInput) { try ReflectionPrototypeCalculator.snapshot(dataset(), period: .week, day: day) }
    }
    #expect(throws: ReflectionPrototypeError.invalidInterval) { try ReflectionPrototypeInterval(from: rt("2026-11-09T23:00:00Z"), until: rt("2026-11-09T23:00:00Z")) }
    let exact = try dataset(restricted: [ri("2026-11-09T21:00:00Z", "2026-11-09T21:01:01Z"), ri("2026-11-09T21:02:00Z", "2026-11-09T21:02:59Z")])
    #expect(try snapshot(exact).total.knownSeconds == 120)
}
@Test func reflectionLargeRepeatedFixtureStillReturnsBoundedDTO() throws {
    let range = try ri("2026-11-09T21:00:00Z", "2026-11-09T23:00:00Z")
    let result = try snapshot(dataset(restricted: Array(repeating: range, count: 10_000)))
    #expect(result.total.knownSeconds == 7200); #expect(result.buckets.count == 7); #expect(result.trend.count <= 64)
}
