import Foundation
import ItomaCore
import ItomaSQLite

/// Latest attempted plan and its bounded observation. Never system-wide blocking proof.
public struct StoredApplication: Equatable, Sendable {
    public let evaluation: Evaluation
    public let observation: ApplicationObservation
    public init(evaluation: Evaluation, observation: ApplicationObservation) throws {
        guard observation.evaluationID == evaluation.id,
              let boundary = evaluation.nextBoundary, evaluation.evaluatedAt < boundary else { throw StorageError.conflict }
        if observation.status == .applied {
            guard observation.error == nil, let until = observation.validUntil, until <= boundary,
                  evaluation.evaluatedAt <= observation.observedAt, observation.observedAt < until else { throw StorageError.conflict }
        }
        self.evaluation = evaluation; self.observation = observation
    }
}

extension ControlTransaction {
    public func recordApplication(_ application: StoredApplication, expectedSequence: SnapshotSequence) throws -> ControlSnapshot {
        try checked {
            let current = try repository.loadSnapshot()
            guard current.snapshotSequence == expectedSequence,
                  application.evaluation.policyRevision <= current.policy.revision,
                  application.observation.status != .applied || application.evaluation.policyRevision == current.policy.revision,
                  application.evaluation.snapshotSequence <= expectedSequence else { throw StorageError.conflict }
            if current.application == application { return current }
            try repository.database.execute("UPDATE application_state SET record=? WHERE singleton=1", [
                .blob(try JSONEncoder().encode(ApplicationDTO(application)))
            ])
            try repository.advanceSequence()
            return try repository.loadSnapshot()
        }
    }
}

extension ControlRepository {
    func createApplicationTable() throws {
        try database.execute("CREATE TABLE application_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),record BLOB)")
        try database.execute("INSERT INTO application_state VALUES (1,NULL)")
    }

    func loadApplication() throws -> StoredApplication? {
        let rows = try database.rows("SELECT record FROM application_state WHERE singleton=1")
        guard rows.count == 1, rows[0].count == 1 else { throw StorageError.corrupt }
        if rows[0][0] == .null { return nil }
        guard case let .blob(data) = rows[0][0] else { throw StorageError.corrupt }
        do { return try JSONDecoder().decode(ApplicationDTO.self, from: data).model() }
        catch { throw StorageError.corrupt }
    }
}

private struct ApplicationDTO: Codable {
    var version = 1
    let evaluationID: EvaluationID
    let policyRevision: PolicyRevision
    let snapshotSequence: SnapshotSequence
    let evaluatedAt: Instant
    let timeZone: String
    let nextBoundary: Instant?
    let desiredTargets: [TargetRef]
    let status: ApplicationStatus
    let evidence: ApplicationEvidence?
    let observedAt: Instant
    let validUntil: Instant?
    let error: OperationFailure?
    init(_ value: StoredApplication) {
        let evaluation = value.evaluation, observation = value.observation
        evaluationID = evaluation.id; policyRevision = evaluation.policyRevision; snapshotSequence = evaluation.snapshotSequence
        evaluatedAt = evaluation.evaluatedAt; timeZone = evaluation.timeZone.identifier; nextBoundary = evaluation.nextBoundary
        desiredTargets = evaluation.desiredTargets.sorted { $0.rawValue.uuidString < $1.rawValue.uuidString }
        status = observation.status; evidence = observation.evidence; observedAt = observation.observedAt
        validUntil = observation.validUntil; error = observation.error
    }
    func model() throws -> StoredApplication {
        guard version == 1, Set(desiredTargets).count == desiredTargets.count else { throw StorageError.corrupt }
        return try StoredApplication(evaluation: Evaluation(id: evaluationID, policyRevision: policyRevision,
            snapshotSequence: snapshotSequence, evaluatedAt: evaluatedAt, timeZone: TimeZoneID(timeZone),
            nextBoundary: nextBoundary, desiredTargets: Set(desiredTargets)),
            observation: ApplicationObservation(evaluationID: evaluationID, status: status, evidence: evidence,
                observedAt: observedAt, validUntil: validUntil, error: error))
    }
}
