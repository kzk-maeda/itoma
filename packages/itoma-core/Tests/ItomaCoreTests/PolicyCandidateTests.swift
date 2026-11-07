import Foundation
import ItomaCore
import Testing

private let ruleID = RuleID(UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
private func snapshot(revision: Int64, version: Int64, mode: UnlockMode) throws -> PolicySnapshot {
    try PolicySnapshot(revision: PolicyRevision(revision), rules: [
        Rule(id: ruleID, version: RuleVersion(version), enabled: true,
             selectionRef: SelectionRef(UUID(uuidString: "00000000-0000-0000-0000-000000000002")!),
             schedule: WeeklySchedule(weekdays: [.monday], startMinute: 540, endMinute: 1020, endDayOffset: .sameDay), unlockMode: mode)
    ], priorityOrder: [ruleID])
}

@Test(arguments: [Int64(0), 1])
func changedCandidateRulesCannotReuseOrDecreaseTheirVersion(version: Int64) throws {
    let active = try snapshot(revision: 7, version: 1, mode: .reason)
    let candidate = try PolicyCandidate(commandID: CommandID(UUID(uuidString: "00000000-0000-0000-0000-000000000003")!),
                                        expectedRevision: PolicyRevision(7), proposedPolicy: snapshot(revision: 8, version: version, mode: .unavailable))
    #expect(throws: ModelError.invalidRuleVersion) { try candidate.validate(against: active) }
}

@Test func candidateValidationChecksTheCurrentPolicyAndAcceptsAnAdvancedRuleVersion() throws {
    let active = try snapshot(revision: 7, version: 1, mode: .reason)
    let candidate = try PolicyCandidate(commandID: CommandID(UUID(uuidString: "00000000-0000-0000-0000-000000000003")!),
                                        expectedRevision: PolicyRevision(7), proposedPolicy: snapshot(revision: 8, version: 2, mode: .unavailable))
    try candidate.validate(against: active)
    #expect(throws: ModelError.stalePolicyRevision) {
        try candidate.validate(against: snapshot(revision: 8, version: 1, mode: .reason))
    }
}
