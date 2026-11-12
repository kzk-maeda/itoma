import Foundation
import ItomaCore
import ItomaStorage

/// Host input only. Private rule names/goals never participate in policy equality.
public struct RulePreviewInput: Decodable, Sendable {
    public let id: String?
    public let expectedRevision: String
    public let selectionRef: String
    public let weekdays: [Int]
    public let startMinute: Int
    public let endMinute: Int
    public let nextDay: Bool
    public let enabled: Bool
    public let remove: Bool?

    public init(id: String?, expectedRevision: String, selectionRef: String, weekdays: [Int],
                startMinute: Int, endMinute: Int, nextDay: Bool, enabled: Bool, remove: Bool? = nil) {
        self.id = id; self.expectedRevision = expectedRevision; self.selectionRef = selectionRef
        self.weekdays = weekdays; self.startMinute = startMinute; self.endMinute = endMinute
        self.nextDay = nextDay; self.enabled = enabled; self.remove = remove
    }
}

public enum RulePreviewError: Error, Equatable, Sendable { case invalidSelection, invalidInput }

public enum RulePreviewResult: Sendable {
    /// The complete old Rule remains active, including its selection reference and version.
    case unchanged(selectionRef: SelectionRef)
    case confirmation(PolicyCandidate, PolicyEditAssessment)
}

/// The production host entrance for rule validation, comparison and candidate acceptance.
/// No Apple UI, singleton or scheduler is needed. Only a changed policy calls the assessment
/// port; unchanged input cannot refresh grants, create a command, or apply/register anything.
@ItomaControlActor public final class RulePreviewService {
    /// A post-accept assessment failure must not hide the new, still-unsubmitted intent from
    /// its owner. The host returns this ref for a subsequent explicit re-preview/discard.
    public private(set) var acceptedCandidate: PolicyCandidate?
    private let repository: ControlRepository
    private let contexts: any EvaluationContextProvider
    private let makeRuleID: @ItomaControlActor () -> RuleID
    private let makeCommandID: @ItomaControlActor () -> CommandID

    public init(repository: ControlRepository, contexts: any EvaluationContextProvider,
                makeRuleID: @escaping @ItomaControlActor () -> RuleID = { RuleID(UUID()) },
                makeCommandID: @escaping @ItomaControlActor () -> CommandID = { CommandID(UUID()) }) {
        self.repository = repository; self.contexts = contexts
        self.makeRuleID = makeRuleID; self.makeCommandID = makeCommandID
    }

    public func preview(
        _ input: RulePreviewInput, confirmedSelections: Set<SelectionRef>,
        previousCandidate: PolicyCandidate? = nil, previousRef: String? = nil,
        anotherFlowOwnsCandidate: Bool = false,
        assess: @ItomaControlActor (PolicyCandidate) throws -> PolicyEditAssessment
    ) throws -> RulePreviewResult {
        acceptedCandidate = nil
        let prepared: (PolicyCandidate?, SelectionRef) = try repository.write { tx in
            let before = try tx.snapshot()
            guard input.expectedRevision == String(before.policy.revision.rawValue) else { throw StorageError.conflict }
            let old: Rule?
            if let rawID = input.id {
                guard let uuid = UUID(uuidString: rawID), let existing = before.policy.rules.first(where: { $0.id.rawValue == uuid }) else {
                    throw StorageError.conflict
                }
                old = existing
            } else { old = nil }
            guard input.remove != true || old != nil else { throw RulePreviewError.invalidInput }
            guard let uuid = UUID(uuidString: input.selectionRef),
                  let selection = before.selections.first(where: { $0.selection.ref.rawValue == uuid })?.selection,
                  !selection.targets.isEmpty, selection.targets.count <= 50 else { throw RulePreviewError.invalidSelection }
            let weekdays = input.weekdays.compactMap(Weekday.init(rawValue:))
            guard weekdays.count == input.weekdays.count else { throw ModelError.emptyWeekdays }
            let schedule = try WeeklySchedule(weekdays: Set(weekdays), startMinute: input.startMinute,
                endMinute: input.endMinute, endDayOffset: input.nextDay ? .nextDay : .sameDay)
            let context = contexts.context(activation: before.activation)
            // Fresh picker confirmation cannot be inferred from equal counts or old approval.
            if before.activation == .awaitingReauthorizationConfirmation,
               context.authorization.status == .approved, !confirmedSelections.contains(selection.ref) {
                throw RulePreviewError.invalidSelection
            }
            let previous = try checkedPrevious(previousCandidate, ref: previousRef, transaction: tx)
            let same = old.map { rule in
                rule.enabled == input.enabled && rule.schedule == schedule && rule.unlockMode == .reason
                    && before.selections.first(where: { $0.selection.ref == rule.selectionRef })?.selection.targets == selection.targets
            } ?? false
            if same && input.remove != true {
                // Without current approval, never claim a no-op validated the saved selection.
                guard context.authorization.status == .approved else { throw CommandServiceError.authorizationRequired }
                if let previous { try cancel(previous, transaction: tx) }
                return (nil, old!.selectionRef)
            }
            guard !anotherFlowOwnsCandidate else { throw StorageError.conflict }
            let rule = Rule(id: old?.id ?? makeRuleID(), version: try old?.version.next() ?? RuleVersion(0),
                enabled: input.enabled, selectionRef: selection.ref, schedule: schedule, unlockMode: .reason)
            var rules = before.policy.rules, order = before.policy.priorityOrder
            if input.remove == true { rules.removeAll { $0.id == rule.id }; order.removeAll { $0 == rule.id } }
            else if let index = rules.firstIndex(where: { $0.id == rule.id }) { rules[index] = rule }
            else { rules.append(rule); order.append(rule.id) }
            let selected = Set(rules.filter(\.enabled).flatMap { rule in
                before.selections.first { $0.selection.ref == rule.selectionRef }?.selection.targets ?? []
            })
            guard selected.count <= 50 else { throw RulePreviewError.invalidSelection }
            let proposed = try PolicySnapshot(revision: before.policy.revision.next(), rules: rules,
                priorityOrder: order, defaultUnlockDuration: before.policy.defaultUnlockDuration)
            let command = try Command(id: makeCommandID(), kind: .commitPolicy, status: .pending,
                expectedPolicyRevision: before.policy.revision, candidatePolicyRevision: proposed.revision, attempt: AttemptNumber(0))
            let candidate = try PolicyCandidate(commandID: command.id, expectedRevision: before.policy.revision, proposedPolicy: proposed)
            try candidate.validate(against: before.policy)
            // All input and ownership checks precede cancellation. Both mutations roll back
            // together if candidate acceptance fails its sequence/revision/selection checks.
            if let previous { try cancel(previous, transaction: tx) }
            _ = try tx.acceptCandidate(command: command, candidate: candidate, expectedSequence: tx.snapshot().snapshotSequence)
            return (candidate, selection.ref)
        }
        guard let accepted = prepared.0 else { return .unchanged(selectionRef: prepared.1) }
        acceptedCandidate = accepted
        return .confirmation(accepted, try assess(accepted))
    }

    public func cancel(_ candidate: PolicyCandidate, ref: String) throws {
        try repository.write { tx in
            guard let previous = try checkedPrevious(candidate, ref: ref, transaction: tx) else { throw StorageError.conflict }
            try cancel(previous, transaction: tx)
        }
    }

    /// Release only a completed local confirmation cache. This never changes the durable
    /// command/candidate, and cannot discard an operation still scheduling or applying.
    public func canReleaseOwnership(of candidate: PolicyCandidate) throws -> Bool {
        try repository.write { tx in
            guard try tx.candidate(commandID: candidate.commandID) == candidate,
                  let command = try tx.command(candidate.commandID), command.kind == .commitPolicy else {
                throw StorageError.conflict
            }
            switch command.status {
            case .scheduling, .applying: return false
            case .succeeded, .cancelled, .expired, .superseded: return true
            case .pending, .failed, .uncertain:
                return try tx.activatedCandidateRevision(commandID: candidate.commandID) != nil
            }
        }
    }

    private func checkedPrevious(_ candidate: PolicyCandidate?, ref: String?, transaction tx: ControlTransaction) throws -> Command? {
        guard let ref else { return nil }
        guard let candidate, UUID(uuidString: ref) == candidate.commandID.rawValue,
              try tx.candidate(commandID: candidate.commandID) == candidate,
              let command = try tx.command(candidate.commandID), command.kind == .commitPolicy,
              [.pending, .failed, .uncertain].contains(command.status),
              try tx.activatedCandidateRevision(commandID: candidate.commandID) == nil else {
            throw StorageError.conflict
        }
        return command
    }

    private func cancel(_ command: Command, transaction tx: ControlTransaction) throws {
        let cancelled = try Command(id: command.id, kind: command.kind, status: .cancelled,
            expectedPolicyRevision: command.expectedPolicyRevision, candidatePolicyRevision: command.candidatePolicyRevision,
            attempt: command.attempt, reasonRef: command.reasonRef)
        _ = try tx.recordCommand(cancelled, expected: command)
    }
}
