import Foundation
import Testing
import ItomaCore

private func ref<Kind>(_ value: Int) -> EntityID<Kind> {
    EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", value))!)
}

private func instant(_ text: String) throws -> Instant {
    try Instant(#require(ISO8601DateFormatter().date(from: text)))
}

private func scheduled(
    _ id: Int = 1, days: Set<Weekday> = Set(Weekday.allCases),
    start: Int = 540, end: Int = 1020, offset: EndDayOffset = .sameDay,
    enabled: Bool = true, mode: UnlockMode = .reason, version: Int64 = 1
) throws -> Rule {
    try Rule(id: ref(id), version: RuleVersion(version), enabled: enabled, selectionRef: ref(id),
             schedule: WeeklySchedule(weekdays: days, startMinute: start, endMinute: end, endDayOffset: offset),
             unlockMode: mode)
}

private func evaluate(
    _ rules: [Rule], at text: String, zone: String = "Asia/Tokyo", through: String? = nil,
    order: [Int]? = nil, selections: [Selection]? = nil,
    activation: Activation = .enabled, authorization: AuthorizationStatus = .approved
) throws -> RuleEvaluation {
    let now = try instant(text)
    let end = try through.map(instant) ?? Instant(secondsSince1970: now.secondsSince1970 + 8 * 86400)
    return try RuleEvaluator.evaluate(
        policy: PolicySnapshot(revision: PolicyRevision(7), rules: rules,
                               priorityOrder: order?.map { ref($0) } ?? rules.map(\.id)),
        selections: selections ?? rules.map { Selection(ref: $0.selectionRef, targets: [ref(1)]) },
        context: EvaluationContext(now: now, timeZone: TimeZoneID(zone),
                                   authorization: AuthorizationObservation(status: authorization, observedAt: now),
                                   activation: activation), through: end
    )
}

@Test(arguments: [
    ("2026-11-06T12:00:00Z", true),  // Friday 21:00, inclusive start
    ("2026-11-06T14:00:00Z", true),
    ("2026-11-06T16:00:00Z", true),  // Saturday 01:00, Friday occurrence
    ("2026-11-06T17:00:00Z", false), // Saturday 02:00, exclusive end
    ("2026-11-08T14:00:00Z", false), // Sunday 23:00
    ("2026-11-08T16:00:00Z", false), // Monday 01:00
])
func R01R02StartDayAndHalfOpenInterval(example: (String, Bool)) throws {
    let rule = try scheduled(days: [.monday, .tuesday, .wednesday, .thursday, .friday],
                             start: 1260, end: 120, offset: .nextDay)
    let result = try evaluate([rule], at: example.0)
    #expect(result.desiredTargets.isEmpty == !example.1)
    if example.1 {
        let winner = try #require(result.targets[ref(1)]?.winner)
        #expect(winner.key.startDay == (try LocalDate(year: 2026, month: 11, day: 6)))
    }
}

@Test func sundayCrossesWeekAndYearBoundary() throws {
    let rule = try scheduled(days: [.sunday], start: 1380, end: 60, offset: .nextDay)
    let result = try evaluate([rule], at: "2024-01-01T00:30:00Z", zone: "UTC")
    #expect(result.targets[ref(1)]?.winner?.key.startDay == (try LocalDate(year: 2023, month: 12, day: 31)))
    #expect(result.nextBoundary == (try instant("2024-01-01T01:00:00Z")))
}

@Test func sameDayBoundsAndExplicit24Hours() throws {
    let ordinary = try scheduled()
    #expect(try evaluate([ordinary], at: "2026-11-06T00:00:00Z").desiredTargets == [ref(1)])
    #expect(try evaluate([ordinary], at: "2026-11-06T08:00:00Z").desiredTargets.isEmpty)
    let daily = try scheduled(start: 540, end: 540, offset: .nextDay)
    let before = try evaluate([daily], at: "2026-11-05T23:59:59Z")
    let after = try evaluate([daily], at: "2026-11-06T00:00:00Z")
    #expect(before.targets[ref(1)]?.nextWinnerChange == (try instant("2026-11-06T00:00:00Z")))
    #expect(before.targets[ref(1)]?.winner?.key != after.targets[ref(1)]?.winner?.key)
    #expect(after.desiredTargets == [ref(1)])
}

@Test func R03R04R06PriorityIsPerTargetAndIndependentOfModeOrArrayOrder() throws {
    let low = try scheduled(1, mode: .reason)
    let high = try scheduled(2, mode: .unavailable)
    let selections = [Selection(ref: ref(1), targets: [ref(1), ref(2)]),
                      Selection(ref: ref(2), targets: [ref(1), ref(3)])]
    let result = try evaluate([low, high], at: "2026-11-06T03:00:00Z", order: [2, 1], selections: selections)
    #expect(result.desiredTargets == [ref(1), ref(2), ref(3)])
    #expect(result.targets[ref(1)]?.winner?.rule.id == high.id)
    #expect(result.targets[ref(2)]?.winner?.rule.id == low.id)
    #expect(result.targets[ref(3)]?.winner?.rule.id == high.id)
    let overlap = try #require(result.overlaps.first)
    #expect(overlap.higherPriority.ruleID == high.id)
    #expect(overlap.lowerPriority.ruleID == low.id)
    #expect(overlap.targets == [ref(1)])
    #expect(overlap.startsAt == result.context.now) // clipped to requested coverage
    #expect(overlap.endsAt == (try instant("2026-11-06T08:00:00Z")))
    let reversed = try evaluate([high, low], at: "2026-11-06T03:00:00Z", order: [1, 2], selections: selections)
    #expect(reversed.targets[ref(1)]?.winner?.rule.id == low.id) // no implicit stricter-mode fallback
    let stopped = try scheduled(2, enabled: false, mode: .unavailable)
    let remaining = try evaluate([low, stopped], at: "2026-11-06T03:00:00Z", order: [2, 1],
                                 selections: [selections[0]])
    #expect(remaining.targets[ref(1)]?.winner?.rule.id == low.id)
    #expect(remaining.desiredTargets == [ref(1), ref(2)])
}

@Test func nextWinnerChangeSkipsShadowedEdgesAndFindsFutureHigherPriority() throws {
    let low = try scheduled(1, start: 600, end: 780)
    let high = try scheduled(2, start: 720, end: 750)
    let shadowed = try scheduled(3, start: 660, end: 690)
    let result = try evaluate([low, high, shadowed], at: "2026-11-06T01:30:00Z", order: [2, 1, 3])
    #expect(result.nextBoundary == (try instant("2026-11-06T02:00:00Z")))
    #expect(result.targets[ref(1)]?.nextWinnerChange == (try instant("2026-11-06T03:00:00Z")))
    let switched = try evaluate([low, high], at: "2026-11-06T03:30:00Z", order: [2, 1])
    #expect(switched.targets[ref(1)]?.winner?.rule.id == low.id)
    #expect(switched.targets[ref(1)]?.nextWinnerChange == (try instant("2026-11-06T04:00:00Z")))
}

@Test(arguments: [
    ("America/New_York", "2026-03-08T06:00:00Z", 150, 240, "2026-03-08T07:00:00Z", "2026-03-08T08:00:00Z"),
    ("America/New_York", "2026-11-01T04:00:00Z", 90, 105, "2026-11-01T05:30:00Z", "2026-11-01T06:45:00Z"),
    ("Australia/Lord_Howe", "2026-10-03T14:00:00Z", 135, 180, "2026-10-03T15:30:00Z", "2026-10-03T16:00:00Z"),
    ("Australia/Lord_Howe", "2026-04-04T13:00:00Z", 105, 110, "2026-04-04T14:45:00Z", "2026-04-04T15:20:00Z"),
    ("America/Sao_Paulo", "2018-11-04T02:00:00Z", 30, 120, "2018-11-04T03:00:00Z", "2018-11-04T04:00:00Z"),
])
func R09DSTResolvesGapToNextValidAndFoldToEarliestStartLatestEnd(
    example: (String, String, Int, Int, String, String)
) throws {
    let rule = try scheduled(days: [.sunday], start: example.2, end: example.3)
    let result = try evaluate([rule], at: example.1, zone: example.0)
    let occurrence = try #require(result.occurrences.first)
    #expect(occurrence.startsAt == (try instant(example.4)))
    #expect(occurrence.endsAt == (try instant(example.5)))
    let ended = try evaluate([rule], at: example.5, zone: example.0)
    #expect(ended.desiredTargets.isEmpty)
}

@Test func R09CollapsedGapIsReportedRatherThanRoundedTo24Hours() throws {
    let rule = try scheduled(days: [.sunday], start: 130, end: 170)
    let result = try evaluate([rule], at: "2026-03-08T06:00:00Z", zone: "America/New_York")
    let invalid = try #require(result.invalidOccurrences.first)
    #expect(invalid.key.resolvedStart == (try instant("2026-03-08T07:00:00Z")))
    #expect(invalid.resolvedEnd == invalid.key.resolvedStart)
    #expect(result.activeOccurrences.isEmpty)
    #expect(!result.occurrences.contains { $0.key.startDay == invalid.key.startDay })
}

@Test(arguments: [("2026-03-08T05:00:00Z", 23), ("2026-11-01T04:00:00Z", 25)])
func fullCivilDayIsNotAlways24ElapsedHours(example: (String, Int)) throws {
    let rule = try scheduled(start: 0, end: 0, offset: .nextDay)
    let result = try evaluate([rule], at: example.0, zone: "America/New_York")
    let winner = try #require(result.targets[ref(1)]?.winner)
    #expect(winner.endsAt.secondsSince1970 - winner.startsAt.secondsSince1970 == Double(example.1 * 3600))
}

@Test func R09SkippedCivilDayAndOvernightIntoNextValidDay() throws {
    let empty = try scheduled(days: [.friday], start: 600, end: 720)
    let result = try evaluate([empty], at: "2011-12-29T20:00:00Z", zone: "Pacific/Apia")
    #expect(result.invalidOccurrences.first?.key.startDay == (try LocalDate(year: 2011, month: 12, day: 30)))
    #expect(result.invalidOccurrences.first?.resolvedEnd == (try instant("2011-12-30T10:00:00Z")))
    let overnight = try scheduled(days: [.friday], start: 1260, end: 120, offset: .nextDay)
    let active = try evaluate([overnight], at: "2011-12-30T10:30:00Z", zone: "Pacific/Apia")
    #expect(active.targets[ref(1)]?.winner?.key.startDay == (try LocalDate(year: 2011, month: 12, day: 30)))
    #expect(active.targets[ref(1)]?.winner?.endsAt == (try instant("2011-12-30T12:00:00Z")))
}

@Test func repeatedHourDailyOccurrencesPreferNewStartAndDoNotRevertAtOldEnd() throws {
    let daily = try scheduled(start: 90, end: 90, offset: .nextDay)
    let result = try evaluate([daily], at: "2026-11-01T05:45:00Z", zone: "America/New_York")
    #expect(result.activeOccurrences.count == 2)
    #expect(result.targets[ref(1)]?.winner?.key.startDay == (try LocalDate(year: 2026, month: 11, day: 1)))
    #expect(result.nextBoundary == (try instant("2026-11-01T06:30:00Z")))
    #expect(result.targets[ref(1)]?.nextWinnerChange == (try instant("2026-11-02T06:30:00Z")))
    #expect(result.overlaps.isEmpty) // self overlap does not ask for rule priority
}

@Test func resolvedDSTOverlapIsReportedEvenWhenWallIntervalsOnlyTouch() throws {
    let a = try scheduled(1, days: [.sunday], start: 60, end: 90)
    let b = try scheduled(2, days: [.sunday], start: 90, end: 120)
    let result = try evaluate([a, b], at: "2026-11-01T04:00:00Z", zone: "America/New_York")
    let overlap = try #require(result.overlaps.first)
    #expect(overlap.startsAt == (try instant("2026-11-01T05:30:00Z")))
    #expect(overlap.endsAt == (try instant("2026-11-01T06:30:00Z")))
    let utc = try evaluate([a, b], at: "2026-11-01T00:00:00Z", zone: "UTC")
    #expect(utc.overlaps.isEmpty)
    let disjoint = try evaluate([a, b], at: "2026-11-01T04:00:00Z", zone: "America/New_York",
                                selections: [Selection(ref: ref(1), targets: [ref(1)]),
                                             Selection(ref: ref(2), targets: [ref(2)])])
    #expect(disjoint.overlaps.isEmpty)
}

@Test(arguments: [Activation.paused, .awaitingReauthorizationConfirmation])
func activationDoesNotResumeOnAnApprovedObservation(value: Activation) throws {
    let result = try evaluate([scheduled()], at: "2026-11-06T03:00:00Z", activation: value)
    #expect(result.targets[ref(1)]?.winner != nil) // explain configured schedule independently
    #expect(result.desiredTargets.isEmpty)
}

@Test(arguments: [AuthorizationStatus.unknown, .denied])
func missingAuthorizationDoesNotProduceAnEnforcementPlan(value: AuthorizationStatus) throws {
    let result = try evaluate([scheduled()], at: "2026-11-06T03:00:00Z", authorization: value)
    #expect(result.targets[ref(1)]?.winner != nil)
    #expect(result.desiredTargets.isEmpty)
}

@Test func R10TimezoneReevaluatesSameUTCInstantAndOccurrenceIdentity() throws {
    let rule = try scheduled(start: 1260, end: 120, offset: .nextDay)
    let tokyo = try evaluate([rule], at: "2026-11-06T14:00:00Z")
    let utc = try evaluate([rule], at: "2026-11-06T14:00:00Z", zone: "UTC")
    #expect(!tokyo.desiredTargets.isEmpty)
    #expect(utc.desiredTargets.isEmpty)
    let fullDay = try scheduled(start: 0, end: 0, offset: .nextDay)
    let a = try evaluate([fullDay], at: "2026-11-06T14:00:00Z")
    let b = try evaluate([fullDay], at: "2026-11-06T14:00:00Z", zone: "UTC")
    #expect(a.targets[ref(1)]?.winner?.key != b.targets[ref(1)]?.winner?.key)
    let edited = try evaluate([scheduled(start: 0, end: 0, offset: .nextDay, version: 2)], at: "2026-11-06T14:00:00Z")
    #expect(a.targets[ref(1)]?.winner?.key != edited.targets[ref(1)]?.winner?.key)
    // This evaluator has no grant input/output and cannot issue or revive a grant.
}

@Test func finiteCoverageRequiresRefreshAndIncludesAnEventExactlyAtTheLimit() throws {
    let rule = try scheduled(days: [.friday])
    let limited = try evaluate([rule], at: "2026-11-05T12:00:00Z", through: "2026-11-05T13:00:00Z")
    #expect(limited.nextBoundary == nil)
    #expect(limited.targets[ref(1)]?.nextWinnerChange == nil)
    #expect(limited.nextEvaluationAt == limited.evaluatedThrough)
    let boundary = try evaluate([rule], at: "2026-11-05T12:00:00Z", through: "2026-11-06T00:00:00Z")
    #expect(boundary.nextBoundary == boundary.evaluatedThrough)
    #expect(boundary.targets[ref(1)]?.nextWinnerChange == boundary.evaluatedThrough)
    let empty = try evaluate([], at: "2026-11-05T12:00:00Z")
    #expect(empty.desiredTargets.isEmpty && empty.targets.isEmpty && empty.nextBoundary == nil)
}

@Test func invalidInputsThrowInsteadOfSilentlyRemovingRestrictions() throws {
    let rule = try scheduled()
    #expect(throws: RuleEvaluationError.missingSelection) {
        try evaluate([rule], at: "2026-11-06T03:00:00Z", selections: [])
    }
    #expect(throws: RuleEvaluationError.duplicateSelection) {
        try evaluate([rule], at: "2026-11-06T03:00:00Z", selections: [
            Selection(ref: ref(1), targets: [ref(1)]), Selection(ref: ref(1), targets: [])])
    }
    #expect(throws: ModelError.invalidPriorityOrder) {
        try evaluate([rule], at: "2026-11-06T03:00:00Z", order: [])
    }
    #expect(throws: RuleEvaluationError.invalidEvaluationWindow) {
        try evaluate([rule], at: "2026-11-06T03:00:00Z", through: "2026-11-06T03:00:00Z")
    }
    #expect(throws: RuleEvaluationError.invalidEvaluationWindow) {
        try evaluate([rule], at: "2026-11-06T03:00:00Z", through: "2027-11-08T03:00:00Z")
    }
    let extreme = try Instant(secondsSince1970: 1e15)
    #expect(throws: RuleEvaluationError.unsupportedDateRange) {
        try RuleEvaluator.evaluate(policy: PolicySnapshot(revision: PolicyRevision(1), rules: [], priorityOrder: []),
                                   selections: [], context: EvaluationContext(now: extreme, timeZone: TimeZoneID("UTC"),
                                   authorization: AuthorizationObservation(status: .approved, observedAt: extreme),
                                   activation: .enabled), through: Instant(secondsSince1970: 1e15 + 1))
    }
    let emptySelection = try evaluate([rule], at: "2026-11-06T03:00:00Z",
                                     selections: [Selection(ref: ref(1), targets: [])])
    #expect(emptySelection.desiredTargets.isEmpty)
}
