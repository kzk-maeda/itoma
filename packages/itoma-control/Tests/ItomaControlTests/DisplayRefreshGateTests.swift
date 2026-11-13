import Foundation
import ItomaCore
import ItomaStorage
@testable import ItomaControl
import Testing

private func at(_ value: Double) throws -> Instant { try Instant(secondsSince1970: value) }

@Test @ItomaControlActor func repeatedDisplayPollsDoNotApplyOrProduceControlFactsOrExtendEvidence() async throws {
    let f = try Fixture(); defer { f.remove() }
    try f.repository.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: 100))
    var gate = DisplayRefreshGate()
    let initial = try f.repository.readSnapshot()
    let reused1 = gate.canReuse(initial, context: f.contexts.context(activation: initial.activation), authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
    #expect(!reused1)
    #expect(await f.service.reconcile(recoverInterruptedCommands: true).failure == nil)
    let saved = try f.repository.readSnapshot(), boundary = try #require(f.repository.reflectionBatch()?.boundary)
    gate.remember(saved, context: f.contexts.context(activation: saved.activation), authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
    let originalTime = f.contexts.now, applications = f.restriction.plans.count
    for n in 1...10 {
        f.contexts.now = try at(originalTime.secondsSince1970 + Double(n * 15))
        let current = try f.repository.readSnapshot(), context = f.contexts.context(activation: current.activation)
        if !gate.canReuse(current, context: context, authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100 + Double(n * 15)) {
            _ = await f.service.reconcile(recoverInterruptedCommands: true)
        }
    }
    let after = try f.repository.readSnapshot()
    #expect(f.restriction.plans.count == applications)
    #expect(after.snapshotSequence == saved.snapshotSequence)
    #expect(after.application == saved.application)
    #expect(try f.repository.reflectionBatch()?.boundary == boundary)
    var restarted = DisplayRefreshGate()
    let reused2 = restarted.canReuse(after, context: f.contexts.context(activation: after.activation), authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 300)
    #expect(!reused2)
}

@Test @ItomaControlActor func displayReuseInvalidatesOnNativeFactsClockAndControlWrites() async throws {
    let f = try Fixture(); defer { f.remove() }
    #expect(await f.service.reconcile().failure == nil)
    let snapshot = try f.repository.readSnapshot(), context = f.contexts.context(activation: snapshot.activation)
    func gate() -> DisplayRefreshGate {
        var value = DisplayRefreshGate()
        value.remember(snapshot, context: context, authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
        return value
    }
    var value = gate()
    let reused3 = value.canReuse(snapshot, context: context, authorizationEpoch: 1, lifecycleGeneration: 0, uptime: 100)
    #expect(!reused3)
    value = gate()
    let reused4 = value.canReuse(snapshot, context: context, authorizationEpoch: 0, lifecycleGeneration: 1, uptime: 100)
    #expect(!reused4)
    for (wall, uptime) in [(context.now.secondsSince1970 - 1, 101.0), (context.now.secondsSince1970 + 30, 101.0), (context.now.secondsSince1970, 99.0)] {
        value = gate(); f.contexts.now = try at(wall)
        let reused5 = value.canReuse(snapshot, context: f.contexts.context(activation: snapshot.activation), authorizationEpoch: 0, lifecycleGeneration: 0, uptime: uptime)
        #expect(!reused5)
    }
    f.contexts.now = context.now
    value = gate(); f.contexts.zone = try TimeZoneID("Asia/Tokyo")
    let reused6 = value.canReuse(snapshot, context: f.contexts.context(activation: snapshot.activation), authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
    #expect(!reused6)
    f.contexts.zone = context.timeZone
    value = gate(); f.contexts.authorization = .denied
    let reused7 = value.canReuse(snapshot, context: f.contexts.context(activation: snapshot.activation), authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
    #expect(!reused7)
    f.contexts.authorization = .approved
    value = gate(); _ = try f.accept()
    let reused8 = value.canReuse(try f.repository.readSnapshot(), context: context, authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
    #expect(!reused8)
    value = gate(); value.invalidate() // Explicit refresh never uses cached evidence.
    let reused9 = value.canReuse(snapshot, context: context, authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
    #expect(!reused9)
}

@Test @ItomaControlActor func displayReuseEndsExactlyAtGrantDeadlineAndReconciliationReblocks() async throws {
    let f = try Fixture(); defer { f.remove() }
    let grant = try f.accept()
    #expect(try await f.service.executeAcceptedGrant(commandID: grant.commandID).failure == nil)
    let saved = try f.repository.readSnapshot(), deadline = try #require(saved.application?.observation.validUntil)
    var value = DisplayRefreshGate()
    value.remember(saved, context: f.contexts.context(activation: saved.activation), authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
    let elapsed = deadline.secondsSince1970 - f.contexts.now.secondsSince1970
    f.contexts.now = deadline
    let reused10 = value.canReuse(saved, context: f.contexts.context(activation: saved.activation), authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100 + elapsed)
    #expect(!reused10)
    #expect(await f.service.reconcile().failure == nil)
    #expect(f.restriction.plans.last?.desiredTargets.count == 2)
    #expect(try f.repository.grant(grant.id)?.grant.effectiveExpiresAt == grant.effectiveExpiresAt)
}

@Test @ItomaControlActor func uncertainObservationsAreNeverReusedForDisplay() async throws {
    let f = try Fixture(); defer { f.remove() }
    f.restriction.response = .uncertain(.osOperationFailure)
    #expect(await f.service.reconcile().failure != nil)
    let snapshot = try f.repository.readSnapshot(), context = f.contexts.context(activation: snapshot.activation)
    var gate = DisplayRefreshGate()
    gate.remember(snapshot, context: context, authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
    let reused11 = gate.canReuse(snapshot, context: context, authorizationEpoch: 0, lifecycleGeneration: 0, uptime: 100)
    #expect(!reused11)
}
