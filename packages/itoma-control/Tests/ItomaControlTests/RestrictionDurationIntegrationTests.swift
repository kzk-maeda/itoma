import Foundation
import Testing
import ItomaCore
import ItomaHistory
@testable import ItomaStorage
@testable import ItomaControl

@Test @ItomaControlActor func twoTargetsAndOverlappingUnlocksExcludeTheWholeUnionUntilConfirmedReblock() async throws {
    let f = try Fixture(); defer { f.remove() }
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone.current
    let base = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 15, hour: 12))).timeIntervalSince1970
    f.contexts.zone = try TimeZoneID(TimeZone.current.identifier)
    func move(_ offset: Double) throws {
        let now = try Instant(secondsSince1970: base + offset)
        f.contexts.now = now
        f.repository.durationClock = { (now, 10_000 + offset) }
    }
    try move(0)
    try f.repository.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: 100))
    try f.repository.installDurationCapture()
    f.restriction.response = .accepted(.ownStoreReadback)
    #expect(await f.service.reconcile().failure == nil)
    try move(1_800)
    let a = try f.accept(1, target: 1)
    _ = try await f.service.executeAcceptedGrant(commandID: a.commandID)
    let partial = try #require(try f.repository.reflectionBatch()?.facts.last)
    #expect(partial.application?.desiredTargets.count == 1)
    #expect(partial.durationObservation?.state == .excluded) // B remaining blocked does not count.
    try move(1_920)
    let b = try f.accept(2, target: 2)
    _ = try await f.service.executeAcceptedGrant(commandID: b.commandID)
    try move(1_980)
    _ = try await f.service.endTemporaryGrant(commandID: a.commandID)
    #expect(try f.repository.reflectionBatch()?.facts.last?.durationObservation?.state == .excluded)
    try move(2_220)
    _ = try await f.service.endTemporaryGrant(commandID: b.commandID)
    #expect(try f.repository.reflectionBatch()?.facts.last?.durationObservation?.state == .restricted)
    try move(7_200)
    try f.repository.recordReflectionBaseline(durationConfirmed: true)
    let batch = try #require(try f.repository.reflectionBatch())
    let asOf = try Instant(secondsSince1970: base + 7_201)
    var builder = RestrictionTimelineBuilder()
    for fact in batch.facts { try builder.append(source: fact.sourceID, sequence: fact.sequence, sample: fact.durationObservation, asOf: asOf) }
    let input = try #require(try builder.dataset(sourceID: UUID(), revision: 1, asOf: asOf, timeZone: "UTC"))
    let view = try ReflectionPrototypeCalculator.snapshot(input, period: .week, day: "2026-11-15")
    #expect(view.total.knownSeconds == 6_780) // Seven-minute union.
}


@Test @ItomaControlActor func delegatedRuleWriteDoesNotFillUnknownAuthorizationTimeInReflection() async throws {
    let f = try Fixture(); defer { f.remove() }
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone.current
    let base = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 15, hour: 12))).timeIntervalSince1970
    f.contexts.zone = try TimeZoneID(TimeZone.current.identifier)
    f.contexts.now = try Instant(secondsSince1970: base)
    f.repository.durationClock = { (try Instant(secondsSince1970: base), 10_000) }
    try f.repository.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: 100))
    try f.repository.installDurationCapture()
    try f.repository.installRuleExecutionAuthorization()
    f.restriction.response = .accepted(.ownStoreReadback)
    #expect(await f.service.reconcile().failure == nil)
    #expect(try f.repository.reflectionBatch()?.facts.last?.durationObservation?.state == .restricted)
    f.contexts.authorization = .unknown
    f.contexts.now = try Instant(secondsSince1970: base + 600)
    f.repository.durationClock = { (try Instant(secondsSince1970: base + 600), 10_600) }
    let callback = try CommandService(repository: f.repository, scheduler: f.scheduler, restriction: f.restriction,
        contexts: f.contexts, historyCapacity: HistoryOutboxCapacity(maximumPendingEvents: 100), origin: .activityExtension)
    #expect(callback.reconcileSynchronously().failure == nil) // Own store applied, raw OS status still unknown.
    #expect(try f.repository.readSnapshot().application?.observation.status == .applied)
    #expect(try f.repository.reflectionBatch()?.facts.last?.durationObservation?.state == .unknown)
    try f.repository.recordReflectionBaseline() // A derived read cannot qualify it.
    #expect(try f.repository.reflectionBatch()?.facts.last?.durationObservation?.state == .unknown)
    try f.repository.recordReflectionBaseline(durationConfirmed: true) // Fresh native host check only.
    #expect(try f.repository.reflectionBatch()?.facts.last?.durationObservation?.state == .restricted)
    let batch = try #require(try f.repository.reflectionBatch())
    var builder = RestrictionTimelineBuilder()
    for fact in batch.facts { try builder.append(source: fact.sourceID, sequence: fact.sequence, sample: fact.durationObservation,
        asOf: Instant(secondsSince1970: base + 601)) }
    #expect(try builder.dataset(sourceID: UUID(), revision: 1,
        asOf: Instant(secondsSince1970: base + 601), timeZone: "UTC") == nil)
    // No measured interval was produced; the unknown span was not reconstructed from the rule.
}

@Test @ItomaControlActor func ruleLogsRecalculateFourHoursWithAnExpiredUnlockWithoutAReblockCheckpoint() async throws {
    let f = try Fixture(); defer { f.remove() }
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone.current
    let base = try #require(calendar.date(from: DateComponents(year: 2026, month: 11, day: 16, hour: 12))).timeIntervalSince1970
    f.contexts.zone = try TimeZoneID(TimeZone.current.identifier)
    func move(_ offset: Double) throws {
        let now = try Instant(secondsSince1970: base + offset)
        f.contexts.now = now
        f.repository.durationClock = { (now, 10000 + offset) }
    }
    try move(0)
    try f.repository.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: 100))
    try f.repository.installDurationCapture()
    f.restriction.response = .accepted(.ownStoreReadback)
    #expect(await f.service.reconcile().failure == nil)
    try move(3600)
    let grant = try f.accept(1)
    #expect(try await f.service.executeAcceptedGrant(commandID: grant.commandID).failure == nil)
    let history = try HistoryRepository.create(at: f.directory.appendingPathComponent("history.sqlite"),
        capacity: HistoryCapacityPolicy(warningBytes: 500000, maximumBytes: 1000000))
    defer { try? history.close() }
    try f.repository.transferReflection(to: history)
    f.contexts.authorization = .unknown
    let writes = f.restriction.plans.count, registrations = f.scheduler.requests.count
    let view = try history.readReflection(period: .week, day: "2026-11-16", timeZone: TimeZone.current.identifier,
        now: Instant(secondsSince1970: base + 14400))
    #expect(view.proofScope == "ruleScheduleLogs" && view.total.knownSeconds == 14100)
    #expect(view.selected.knownSeconds == 14100)
    #expect(f.restriction.plans.count == writes && f.scheduler.requests.count == registrations)
}
