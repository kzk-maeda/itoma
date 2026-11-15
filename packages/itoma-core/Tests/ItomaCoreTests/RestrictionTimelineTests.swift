import Foundation
import Testing
@testable import ItomaCore

private let timelineBase = 1_794_700_800.0
private func instant(_ offset: Double) throws -> Instant { try Instant(secondsSince1970: timelineBase + offset) }
private func sample(_ offset: Double, _ state: RestrictionTimelineSample.State,
                    boundary: RestrictionTimelineSample.Boundary = .checkpoint,
                    uptime: Double? = nil, zone: String = "UTC", limit: Double = 7_200) throws -> RestrictionTimelineSample {
    try .init(at: instant(offset), uptime: uptime ?? 10_000 + offset, timeZone: zone, state: state,
              boundary: boundary, validUntil: state == .restricted ? instant(limit) : nil)
}
private func total(_ builder: RestrictionTimelineBuilder) throws -> ReflectionPrototypeSnapshot? {
    try builder.dataset(sourceID: UUID(), revision: 1, asOf: instant(10_000), timeZone: "UTC")
        .map { try ReflectionPrototypeCalculator.snapshot($0, period: .week, day: "2026-11-15") }
}

@Test func nativeTimelineSubtractsActualUnlockAndEarlyReturnWithoutScheduledExtrapolation() throws {
    for (end, expected) in [(2_100.0, 6_900.0), (1_920.0, 7_080.0)] {
        let source = UUID(); var b = RestrictionTimelineBuilder()
        let samples = try [sample(0, .restricted), sample(1_800, .unknown, boundary: .controlledTransition),
                           sample(1_800, .excluded), sample(end, .unknown, boundary: .controlledTransition),
                           sample(end, .restricted), sample(7_200, .unknown, boundary: .controlledTransition)]
        for (n, value) in samples.enumerated() { try b.append(source: source, sequence: Int64(n + 1), sample: value, asOf: instant(10_000)) }
        let view = try #require(try total(b))
        #expect(view.total.knownSeconds == expected)
        #expect(view.total.coverage == .recorded)
        #expect(view.total.until == timelineBase + 7_200) // Does not extend to as-of 10,000.
    }
}

@Test func nativeTimelineRejectsRebootClockZoneSequenceAndFailedCheckpointContinuity() throws {
    let broken = try [
        sample(100, .restricted, uptime: 50), // Reboot.
        sample(100, .restricted, uptime: 10_010), // Clock discontinuity.
        sample(100, .restricted, zone: "Asia/Tokyo"),
        sample(100, .unknown), // Failed own-store/auth checkpoint invalidates the span.
    ]
    for value in broken {
        let source = UUID(); var b = RestrictionTimelineBuilder()
        try b.append(source: source, sequence: 1, sample: sample(0, .restricted), asOf: instant(10_000))
        try b.append(source: source, sequence: 2, sample: value, asOf: instant(10_000))
        #expect(try total(b) == nil)
    }
    var b = RestrictionTimelineBuilder(); let source = UUID()
    try b.append(source: source, sequence: 1, sample: sample(0, .restricted), asOf: instant(10_000))
    try b.append(source: source, sequence: 3, sample: sample(100, .restricted), asOf: instant(10_000))
    #expect(try total(b) == nil)
}

@Test func nativeTimelineNeverBackfillsLegacyPointsAndDistinguishesKnownZeroFromGap() throws {
    var b = RestrictionTimelineBuilder(); let source = UUID()
    try b.append(source: source, sequence: 1, sample: nil, asOf: instant(10_000))
    try b.append(source: source, sequence: 2, sample: sample(100, .excluded), asOf: instant(10_000))
    #expect(try total(b) == nil)
    try b.append(source: source, sequence: 3, sample: sample(200, .excluded), asOf: instant(10_000))
    let zero = try #require(try total(b)); #expect(zero.total.knownSeconds == 0)
    #expect(zero.total.from == timelineBase + 100)
    try b.append(source: source, sequence: 4, sample: nil, asOf: instant(10_000))
    try b.append(source: source, sequence: 5, sample: sample(400, .restricted), asOf: instant(10_000))
    try b.append(source: source, sequence: 6, sample: sample(500, .restricted), asOf: instant(10_000))
    let partial = try #require(try total(b)); #expect(partial.total.knownSeconds == 100)
    #expect(partial.total.coverage == .partial)
}

@Test func nativeTimelineTreatsLateReblockAsExcludedAndClipsAtPolicyValidity() throws {
    var b = RestrictionTimelineBuilder(); let source = UUID()
    // The requested unlock deadline is deliberately absent: only native transition samples count.
    let values = try [sample(0, .restricted, limit: 100), sample(200, .excluded),
                      sample(400, .excluded), sample(500, .restricted), sample(600, .restricted)]
    for (n, value) in values.enumerated() { try b.append(source: source, sequence: Int64(n + 1), sample: value, asOf: instant(10_000)) }
    let value = try #require(try total(b)); #expect(value.total.knownSeconds == 200)
    #expect(value.total.coverage == .partial) // 100...200 was beyond the old policy's validity.
}

@Test func nativeTimelineExcludesUnlockUnionAcrossOverlappingSourcesOrClockEpochs() throws {
    var b = RestrictionTimelineBuilder(); let a = UUID(), c = UUID()
    try b.append(source: a, sequence: 1, sample: sample(0, .restricted), asOf: instant(1_000))
    try b.append(source: a, sequence: 2, sample: sample(100, .restricted), asOf: instant(1_000))
    try b.append(source: c, sequence: 1, sample: sample(25, .excluded), asOf: instant(1_000))
    try b.append(source: c, sequence: 2, sample: sample(75, .excluded), asOf: instant(1_000))
    #expect(try total(b)?.total.knownSeconds == 50)
}
