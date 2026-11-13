import Foundation
import FamilyControls
import ItomaCore
import ItomaStorage
import ItomaControl
import ItomaHistory
import ItomaScreenTime

typealias ProductRuleInput = RulePreviewInput
struct ProductRequest: Decodable, Sendable {
    var rule: ProductRuleInput?
    var details: ProductRuleDetailsInput?
    var onboarding: ProductOnboardingInput?
    var ref: String?
    var targetRef: String?
    var reason: String?
    var minutes: Int?
}

struct ProductRuleDTO: Encodable, Sendable {
    let id: String; let selectionRef: String; let weekdays: [Int]
    let startMinute: Int; let endMinute: Int; let nextDay: Bool; let enabled: Bool
    var title: String?
    var goal: String?
}
struct ProductTargetDTO: Encodable, Sendable {
    let ref: String; let selectionRef: String; let restricted: Bool
    let unlockable: Bool; let grantEndsAt: Double?; let grantCommandID: String?
    let ruleID: String?
    let grantStatus: String?
}
struct ProductSelectionDTO: Encodable, Sendable { let ref: String; let count: Int }
struct ProductPeriodDTO: Encodable, Sendable { let ruleID: String; let startsAt: Double; let endsAt: Double }
struct ProductSnapshotDTO: Encodable, Sendable {
    var availability = "device"
    var storage = "not-created"
    var authorization = "unknown"
    var activation = "enabled"
    var revision = "0"
    var sequence = "0"
    var rules: [ProductRuleDTO] = []
    var selections: [ProductSelectionDTO] = []
    var targets: [ProductTargetDTO] = []
    var period: ProductPeriodDTO?
    var periods: [ProductPeriodDTO] = []
    var nextPeriod: ProductPeriodDTO?
    var observation = "unknown"
    var validUntil: Double?
    var evaluatedAt: Double?
    var schedulesReady = false
    var needsSelectionReview = false
    var defaultMinutes = 5
    var historyIncomplete = false
    var ruleDetailsStatus = "ready"
    var ruleDetailsRevision = "0"
}
struct ProductImpactDTO: Encodable, Sendable {
    let kind: String; let endsAt: Double?
}
struct ProductResponse: Encodable, Sendable {
    var status = "ok"
    var code: String?
    var ref: String?
    var impacts: [ProductImpactDTO] = []
    var minutes: Int?
    var previewEndsAt: Double?
    var shortened: Bool?
    var snapshot: ProductSnapshotDTO?
    var legacyActive: Bool?
    var retryable: Bool?
    var onboarding: ProductOnboardingDTO?
    func json() -> String { (try? String(data: JSONEncoder().encode(self), encoding: .utf8)) ?? #"{"status":"error","code":"unavailable"}"# }
}

/// Native intent outlives React views. It owns no UIKit and never sends raw errors/reasons/tokens
/// to logs/events/URLs. Only the confirmed reason reaches app-private HistoryRepository.
@ItomaControlActor final class ProductController {
    static let shared = ProductController()
    private var runtime: ScreenTimeRuntime?
    private var busy = false
    private var confirmedSelections: Set<SelectionRef> = []
    private var denialEpoch = 0
    private var reviewGateActive = false
    private var candidate: (PolicyCandidate, PolicyEditAssessment?)?
    private enum CandidateOwner { case rule, onboarding, recovery }
    private var candidateOwner: CandidateOwner?
    private struct GrantPreview {
        let id: UUID; let request: GrantRequest; let reasonRef: ReasonRef; let reason: String; let expiresAt: Instant
    }
    private var grantPreview: GrantPreview?

    private func open(create: Bool = false) throws -> ScreenTimeRuntime {
        if let runtime { return runtime }
        let opened = try ScreenTimeRuntime(createIfMissing: create, allowMonitorCreation: true)
        runtime = opened
        return opened
    }

    func selectionSaved(_ data: Data, authorizationEpoch: Int) throws -> String {
        guard !busy else { throw ScreenTimeRuntimeError.busy }
        let runtime = try open(create: true)
        try observeEpoch(authorizationEpoch, in: runtime)
        guard authorizationEpoch == denialEpoch else { throw ScreenTimeRuntimeError.invalidSelection }
        checkReviewGate(try runtime.repository.readSnapshot(), in: runtime)
        let ref = try runtime.saveSelection(tokensData: data)
        confirmedSelections.insert(ref)
        return ref.rawValue.uuidString.lowercased()
    }

    func labelData(ref: String, target: String?) throws -> Data? {
        guard let uuid = UUID(uuidString: ref) else { return nil }
        let runtime = try open(), snapshot = try runtime.repository.readSnapshot(), ref = SelectionRef(uuid)
        if snapshot.activation == .awaitingReauthorizationConfirmation, !confirmedSelections.contains(ref) { return nil }
        return try runtime.selectionData(ref: ref, target: target.flatMap(UUID.init(uuidString:)).map(TargetRef.init))
    }

    func perform(_ action: String, request: ProductRequest, authorizationEpoch: Int = 0) async -> ProductResponse {
        if busy, action != "snapshot", action != "stop", action != "onboardingRead" { return ProductResponse(status: "error", code: "busy") }
        let mutates = action != "snapshot" && action != "stop" && action != "onboardingRead"
        if mutates { busy = true }
        defer { if mutates { busy = false } }
        do {
            if action.hasPrefix("onboarding") { return try await performOnboarding(action, request: request, authorizationEpoch: authorizationEpoch) }
            if action == "snapshot" {
                do { let r = try open(); try observeEpoch(authorizationEpoch, in: r); if !busy { try await refresh(r) }; return ProductResponse(snapshot: try snapshot(r)) }
                catch StorageError.missingDatabase { return ProductResponse(snapshot: ProductSnapshotDTO(authorization: authorization())) }
            }
            let r = try open(create: action == "initialize")
            if action == "stop" { try? observeEpoch(authorizationEpoch, in: r) }
            else { try observeEpoch(authorizationEpoch, in: r) }
            switch action {
            case "initialize": try await refresh(r)
            case "saveRuleDetails":
                let current = try r.repository.readSnapshot()
                guard let details = request.details, details.expectedPolicyRevision == String(current.policy.revision.rawValue) else { throw RuleDetailsError.changed }
                try ProductRuleDetailsStore.save(details, activeRuleIDs: Set(current.policy.rules.map { $0.id.rawValue }))
            case "previewRule":
                guard let input = request.rule else { throw ScreenTimeRuntimeError.invalidSelection }
                checkReviewGate(try r.repository.readSnapshot(), in: r)
                let service = RulePreviewService(repository: r.repository, contexts: r.contexts)
                // A completed cache can survive a failed response/read. It no longer owns a
                // live operation and must not block a later flow that has no preview ref.
                if request.ref == nil, candidateOwner != .onboarding, let cached = candidate?.0,
                   try service.canReleaseOwnership(of: cached) { candidate = nil; candidateOwner = nil }
                let owned = candidateOwner == .rule ? candidate?.0 : nil
                let preview: RulePreviewResult
                do {
                    preview = try service.preview(input, confirmedSelections: confirmedSelections,
                        previousCandidate: owned, previousRef: request.ref,
                        anotherFlowOwnsCandidate: candidate != nil && (owned == nil || request.ref == nil)) { pending in
                            try r.makeService(additionalPolicy: pending.proposedPolicy).previewCandidate(commandID: pending.commandID)
                        }
                } catch {
                    if let accepted = service.acceptedCandidate {
                        // Acceptance can succeed before a later read/assessment fails. Preserve
                        // this flow's ownership without manufacturing a usable confirmation.
                        candidate = (accepted, nil); candidateOwner = .rule
                        return ProductResponse(status: "error", code: failureCode(error),
                            ref: accepted.commandID.rawValue.uuidString.lowercased(), snapshot: try? snapshot(r))
                    }
                    throw error
                }
                switch preview {
                case let .unchanged(selectionRef):
                    // Equal immutable targets after an explicit fresh picker selection also prove
                    // the retained old selection. Resume remains a separate explicit operation.
                    if let uuid = UUID(uuidString: input.selectionRef), confirmedSelections.contains(SelectionRef(uuid)) {
                        confirmedSelections.insert(selectionRef)
                    }
                    if request.ref != nil { candidate = nil; candidateOwner = nil }
                    // The comparison/cancellation already completed. Projection failure cannot
                    // turn it into an ambiguous error carrying the now-cancelled previous ref.
                    return ProductResponse(snapshot: try? snapshot(r))
                case let .confirmation(pending, assessment):
                    candidate = (pending, assessment); candidateOwner = .rule
                    return ProductResponse(status: "confirmation-required", ref: pending.commandID.rawValue.uuidString.lowercased(),
                        impacts: assessment.impacts.filter { $0.kind != .unchanged }.map { ProductImpactDTO(kind: String(describing: $0.kind), endsAt: $0.proposedExpiresAt?.secondsSince1970) }, snapshot: try? snapshot(r))
                }
            case "reviewCandidate":
                guard let id = request.ref.flatMap(UUID.init(uuidString:)),
                      let pending = try r.repository.candidate(commandID: CommandID(id)) else { throw StorageError.conflict }
                let assessment = try r.makeService(additionalPolicy: pending.proposedPolicy).previewCandidate(commandID: pending.commandID)
                if candidate?.0.commandID != pending.commandID { candidateOwner = .recovery }
                candidate = (pending, assessment)
                let command = try r.repository.command(pending.commandID)
                return ProductResponse(status: "confirmation-required", ref: pending.commandID.rawValue.uuidString.lowercased(),
                    impacts: assessment.impacts.filter { $0.kind != .unchanged }.map { ProductImpactDTO(kind: String(describing: $0.kind), endsAt: $0.proposedExpiresAt?.secondsSince1970) },
                    snapshot: try snapshot(r), retryable: command?.status == .failed || command?.status == .uncertain)
            case "commitRule", "retryRule":
                guard candidateOwner != .onboarding, let (pending, assessment) = candidate, let confirmation = assessment,
                      request.ref?.lowercased() == pending.commandID.rawValue.uuidString.lowercased() else { throw StorageError.conflict }
                _ = try r.monitors.prepare(pending.proposedPolicy)
                let service = try r.makeService(additionalPolicy: pending.proposedPolicy)
                let result: CommandRunResult
                if action == "retryRule" { result = try await service.retryCandidate(commandID: pending.commandID, confirmation: confirmation) }
                else { result = try await service.executeAcceptedCandidate(commandID: pending.commandID, confirmation: confirmation) }
                let current = try r.repository.readSnapshot()
                let completed = try RulePreviewService(repository: r.repository, contexts: r.contexts).canReleaseOwnership(of: pending)
                if completed {
                    candidate = nil; candidateOwner = nil
                }
                if result.failure == nil, let ready = try r.monitors.readyPlan(for: current.policy) { try? r.monitors.cleanup(keeping: ready) }
                return try commandResponse(result, in: r)
            case "cancelCandidate":
                // Check protection before cancellation. Once cancelled, a fallible display
                // projection must not hide the acknowledgement and strand the caller's ref.
                try r.protectFiles()
                try cancelCandidate(r, ref: request.ref)
                return ProductResponse(snapshot: try? snapshot(r))
            case "previewUnlock":
                guard let targetUUID = request.targetRef.flatMap(UUID.init(uuidString:)) else { throw ScreenTimeRuntimeError.invalidSelection }
                let before = try r.repository.readSnapshot(), context = r.contexts.context(activation: before.activation)
                let evaluated = try GrantEvaluator.evaluate(policy: before.policy, selections: before.selections.map(\.selection),
                    context: context, grants: r.repository.unfinishedGrants().map(\.grant))
                let target = TargetRef(targetUUID)
                guard context.authorization.status == .approved, before.activation == .enabled,
                      let winner = evaluated.rules.targets[target]?.winner, winner.rule.unlockMode == .reason,
                      try r.monitors.readyPlan(for: before.policy) != nil else { throw CommandServiceError.authorizationRequired }
                let duration = try UnlockDuration(minutes: request.minutes ?? before.policy.defaultUnlockDuration.minutes)
                let condition = try UnlockCondition.reason(request.reason ?? "")
                let previewRequest = GrantRequest(grantID: GrantID(UUID()), commandID: CommandID(UUID()), targetRef: target,
                    expectedPolicyRevision: before.policy.revision, expectedOccurrence: winner.key, condition: condition, duration: duration)
                let proposed = try GrantEvaluator.propose(previewRequest, policy: before.policy, selections: before.selections.map(\.selection),
                    context: context, existingGrants: r.repository.unfinishedGrants().map(\.grant))
                guard case let .proposed(previewGrant) = proposed else { throw ScreenTimeRuntimeError.busy }
                let id = UUID()
                let confirmedRequest = GrantRequest(grantID: previewRequest.grantID, commandID: previewRequest.commandID, targetRef: target,
                    expectedPolicyRevision: before.policy.revision, expectedOccurrence: winner.key, condition: condition, duration: duration,
                    confirmedExpiresAt: previewGrant.effectiveExpiresAt)
                grantPreview = GrantPreview(id: id, request: confirmedRequest, reasonRef: ReasonRef(UUID()),
                    reason: request.reason ?? "", expiresAt: previewGrant.effectiveExpiresAt)
                return ProductResponse(status: "confirmation-required", ref: id.uuidString.lowercased(), minutes: duration.minutes,
                    previewEndsAt: previewGrant.effectiveExpiresAt.secondsSince1970,
                    shortened: previewGrant.effectiveExpiresAt.secondsSince1970 < context.now.secondsSince1970 + Double(duration.minutes * 60), snapshot: try snapshot(r))
            case "unlock":
                guard let preview = grantPreview, request.ref?.lowercased() == preview.id.uuidString.lowercased(),
                      let reason = request.reason, reason == preview.reason else { throw StorageError.conflict }
                let before = try r.repository.readSnapshot()
                guard try r.monitors.readyPlan(for: before.policy) != nil else { throw ScreenTimeRuntimeError.scheduleUnavailable }
                let context = r.contexts.context(activation: before.activation)
                guard context.now < preview.expiresAt else { throw GrantEvaluationError.confirmationChanged }
                let command = try Command(id: preview.request.commandID, kind: .requestTemporaryGrant, status: .pending,
                    expectedPolicyRevision: preview.request.expectedPolicyRevision, attempt: AttemptNumber(0), reasonRef: preview.reasonRef)
                try await ProductHistoryController.shared.acceptReasonGrant(command: command, request: preview.request,
                    body: reason, context: context, expectedSequence: before.snapshotSequence)
                grantPreview = nil
                let result = try await r.makeService().executeAcceptedGrant(commandID: command.id)
                return try commandResponse(result, in: r)
            case "cancelUnlock":
                let hadPreview = grantPreview != nil
                grantPreview = nil
                if hadPreview {
                    do { try await ProductHistoryController.shared.recordCancellation(eventID: EventID(UUID()), at: NativeScheduleClock.instant(Date())) }
                    catch { try? r.repository.markHistoryIncomplete() }
                }
            case "retryGrant":
                guard let id = request.ref.flatMap(UUID.init(uuidString:)) else { throw StorageError.conflict }
                let before = try r.repository.readSnapshot()
                guard try r.monitors.readyPlan(for: before.policy) != nil else { throw ScreenTimeRuntimeError.scheduleUnavailable }
                let result = try await r.makeService().retryGrant(commandID: CommandID(id))
                return try commandResponse(result, in: r)
            case "stop":
                let result = try await r.makeService(stopping: true).stop(commandID: CommandID(UUID()))
                return try commandResponse(result, in: r)
            case "endGrant":
                guard let id = request.ref.flatMap(UUID.init(uuidString:)) else { throw ScreenTimeRuntimeError.invalidSelection }
                let result = try await r.makeService().endTemporaryGrant(commandID: CommandID(id))
                return ProductResponse(status: result.failure == nil && result.disposition == .committed ? "ok" : "error",
                    code: result.failure.map(code) ?? (result.disposition == .committed ? nil : "application-uncertain"), snapshot: try snapshot(r))
            case "resume":
                let before = try r.repository.readSnapshot()
                checkReviewGate(before, in: r)
                if before.activation == .awaitingReauthorizationConfirmation {
                    guard Set(before.policy.rules.filter(\.enabled).map(\.selectionRef)).isSubset(of: confirmedSelections) else { throw ScreenTimeRuntimeError.invalidSelection }
                }
                _ = try r.monitors.prepare(before.policy)
                let result = try await r.makeService().resume(commandID: CommandID(UUID()))
                return try commandResponse(result, in: r)
            case "reconcile": try await refresh(r)
            case "deleteReasons": try await ProductHistoryController.shared.deleteReasonsForSettings()
            default: throw ScreenTimeRuntimeError.unavailable
            }
            try r.protectFiles()
            return ProductResponse(snapshot: try snapshot(r))
        } catch {
            // Fixed codes only. Never stringify Error (SQL/token/path/reason may be embedded).
            var response = ProductResponse(status: "error", code: failureCode(error), snapshot: runtime.flatMap { try? snapshot($0) })
            if action.hasPrefix("onboarding"), let saved = try? ProductRuleDetailsStore.readOnboarding() {
                response.onboarding = try? onboardingResponse(saved, in: runtime).onboarding
            }
            return response
        }
    }

    /// Draft saves work before Screen Time/control storage exists. Bound IDs are durable BEFORE
    /// candidate acceptance; final consent is durable BEFORE any OS application. Reads never
    /// execute an unsubmitted candidate, and recovery never creates a second rule.
    private func performOnboarding(_ action: String, request: ProductRequest, authorizationEpoch: Int) async throws -> ProductResponse {
        var saved = try ProductRuleDetailsStore.readOnboarding()
        var progress = saved.progress
        if action != "onboardingRead" {
            guard let input = request.onboarding, input.expectedRevision == String(saved.revision) else { throw RuleDetailsError.changed }
        }
        var control: ScreenTimeRuntime?
        if ["onboardingPrepare", "onboardingCommit", "onboardingEdit", "onboardingDiscard", "onboardingAdopt"].contains(action) || progress.draft?.selectionRef != nil {
            do { control = try open(); if let control { try observeEpoch(authorizationEpoch, in: control) } }
            catch StorageError.missingDatabase { /* A draft can exist before permission/selection. */ }
        }
        // A crash after policy commit but before private completion needs only bookkeeping.
        if !(action == "onboardingRead" && busy), let draft = progress.draft, let binding = draft.binding, binding.submitted, let control,
           try control.repository.write({ try $0.activatedCandidateRevision(commandID: CommandID(binding.commandID)) }) != nil {
            let current = try control.repository.readSnapshot()
            if current.policy.rules.contains(where: { $0.id.rawValue == draft.id }) {
                saved = try ProductRuleDetailsStore.finishOnboarding(expectedRevision: saved.revision, activeRuleIDs: Set(current.policy.rules.map { $0.id.rawValue }))
                progress = saved.progress
                if candidateOwner == .onboarding, candidate?.0.commandID.rawValue == binding.commandID {
                    candidate = nil; candidateOwner = nil
                }
                return try onboardingResponse(saved, in: control)
            }
            // The bound policy committed, and the user subsequently removed that rule. Do not
            // recreate it from a lingering private draft after a failed completion acknowledgement.
            progress.draft = nil; progress.seenIntro = true; progress.completed = true
            saved = try ProductRuleDetailsStore.saveOnboarding(progress, expectedRevision: saved.revision)
            if candidateOwner == .onboarding, candidate?.0.commandID.rawValue == binding.commandID {
                candidate = nil; candidateOwner = nil
            }
            return try onboardingResponse(saved, in: control)
        }
        func persist() throws {
            saved = try ProductRuleDetailsStore.saveOnboarding(progress, expectedRevision: saved.revision)
        }
        switch action {
        case "onboardingRead": break
        case "onboardingAdopt":
            guard progress.draft == nil, let control, try !control.repository.readSnapshot().policy.rules.isEmpty else { throw RuleDetailsError.changed }
            progress.seenIntro = true; progress.completed = true; try persist()
        case "onboardingBegin":
            guard !progress.completed, progress.draft == nil else { throw RuleDetailsError.changed }
            progress.seenIntro = true; progress.draft = OnboardingDraft(); try persist()
        case "onboardingDefer":
            progress.seenIntro = true; try persist()
        case "onboardingSave":
            guard let draft = progress.draft, let input = request.onboarding?.draft else { throw RuleDetailsError.invalidInput }
            progress.draft = try input.applying(to: draft); try persist()
        case "onboardingEdit", "onboardingDiscard":
            if let binding = progress.draft?.binding, let control {
                guard try onboardingCanEdit(binding, ruleID: progress.draft!.id, in: control) else { throw RuleDetailsError.changed }
                try control.repository.write { tx in
                    if let command = try tx.command(CommandID(binding.commandID)), command.status == .pending {
                        let cancelled = try Command(id: command.id, kind: command.kind, status: .cancelled,
                            expectedPolicyRevision: command.expectedPolicyRevision, candidatePolicyRevision: command.candidatePolicyRevision,
                            attempt: command.attempt, reasonRef: command.reasonRef)
                        _ = try tx.recordCommand(cancelled, expected: command)
                    }
                }
                if candidate?.0.commandID.rawValue == binding.commandID { candidate = nil; candidateOwner = nil }
            }
            progress.seenIntro = true
            if action == "onboardingDiscard" { progress.draft = nil }
            else { progress.draft?.binding = nil; progress.draft?.step = .apps }
            try persist()
        case "onboardingPrepare":
            guard var draft = progress.draft, let control else { throw RuleDetailsError.invalidInput }
            try requireOnboardingSelection(draft, in: control)
            let before = try control.repository.readSnapshot()
            if draft.binding == nil {
                _ = try draft.schedule()
                draft.binding = OnboardingBinding(commandID: UUID(), policyRevision: before.policy.revision.rawValue)
                draft.step = .review; progress.draft = draft; try persist()
            }
            guard let binding = draft.binding, binding.policyRevision == before.policy.revision.rawValue else { throw RuleDetailsError.changed }
            let commandID = CommandID(binding.commandID)
            let pending: PolicyCandidate
            if let existing = try control.repository.candidate(commandID: commandID) { pending = existing }
            else {
                guard !binding.submitted, !before.policy.rules.contains(where: { $0.id.rawValue == draft.id }), let ref = draft.selectionRef else { throw RuleDetailsError.changed }
                let rule = try Rule(id: RuleID(draft.id), version: RuleVersion(0), enabled: true,
                    selectionRef: SelectionRef(ref), schedule: draft.schedule(), unlockMode: .reason)
                let proposed = try PolicySnapshot(revision: before.policy.revision.next(), rules: before.policy.rules + [rule],
                    priorityOrder: before.policy.priorityOrder + [rule.id], defaultUnlockDuration: before.policy.defaultUnlockDuration)
                let selected = Set(proposed.rules.filter(\.enabled).flatMap { rule in before.selections.first { $0.selection.ref == rule.selectionRef }?.selection.targets ?? [] })
                guard selected.count <= 50 else { throw ScreenTimeRuntimeError.invalidSelection }
                let command = try Command(id: commandID, kind: .commitPolicy, status: .pending,
                    expectedPolicyRevision: before.policy.revision, candidatePolicyRevision: proposed.revision, attempt: AttemptNumber(0))
                pending = try PolicyCandidate(commandID: commandID, expectedRevision: before.policy.revision, proposedPolicy: proposed)
                _ = try control.repository.write { try $0.acceptCandidate(command: command, candidate: pending, expectedSequence: before.snapshotSequence) }
            }
            let assessment = try control.makeService(additionalPolicy: pending.proposedPolicy).previewCandidate(commandID: pending.commandID)
            candidate = (pending, assessment); candidateOwner = .onboarding
            var response = try onboardingResponse(saved, in: control)
            response.status = "confirmation-required"; response.ref = binding.commandID.uuidString.lowercased()
            response.impacts = assessment.impacts.filter { $0.kind != .unchanged }.map { ProductImpactDTO(kind: String(describing: $0.kind), endsAt: $0.proposedExpiresAt?.secondsSince1970) }
            let status = try control.repository.command(commandID)?.status
            response.retryable = status == .failed || status == .uncertain
            return response
        case "onboardingCommit":
            guard var draft = progress.draft, var binding = draft.binding, let control,
                  let (pending, assessment) = candidate, let confirmation = assessment,
                  pending.commandID.rawValue == binding.commandID else { throw RuleDetailsError.changed }
            try requireOnboardingSelection(draft, in: control)
            binding.submitted = true; draft.binding = binding; progress.draft = draft; try persist()
            _ = try control.monitors.prepare(pending.proposedPolicy)
            let service = try control.makeService(additionalPolicy: pending.proposedPolicy)
            let status = try control.repository.command(pending.commandID)?.status
            let result: CommandRunResult
            if status == .failed || status == .uncertain { result = try await service.retryCandidate(commandID: pending.commandID, confirmation: confirmation) }
            else { result = try await service.executeAcceptedCandidate(commandID: pending.commandID, confirmation: confirmation) }
            let current = try control.repository.readSnapshot()
            if current.policy.rules.contains(where: { $0.id.rawValue == draft.id }),
               try control.repository.write({ try $0.activatedCandidateRevision(commandID: pending.commandID) }) != nil {
                saved = try ProductRuleDetailsStore.finishOnboarding(expectedRevision: saved.revision, activeRuleIDs: Set(current.policy.rules.map { $0.id.rawValue }))
                candidate = nil; candidateOwner = nil
            }
            if result.failure == nil, let ready = try control.monitors.readyPlan(for: current.policy) { try? control.monitors.cleanup(keeping: ready) }
            var response = try commandResponse(result, in: control)
            response.onboarding = try onboardingResponse(saved, in: control).onboarding
            return response
        default: throw RuleDetailsError.invalidInput
        }
        return try onboardingResponse(saved, in: control)
    }

    private func requireOnboardingSelection(_ draft: OnboardingDraft, in r: ScreenTimeRuntime) throws {
        let current = try r.repository.readSnapshot(); checkReviewGate(current, in: r)
        guard authorization() == "approved" else { throw CommandServiceError.authorizationRequired }
        guard let ref = draft.selectionRef, confirmedSelections.contains(SelectionRef(ref)),
              current.selections.contains(where: { $0.selection.ref.rawValue == ref }) else { throw ScreenTimeRuntimeError.invalidSelection }
    }
    private func onboardingCanEdit(_ binding: OnboardingBinding, ruleID: UUID, in r: ScreenTimeRuntime) throws -> Bool {
        guard try !r.repository.readSnapshot().policy.rules.contains(where: { $0.id.rawValue == ruleID }),
              try r.repository.write({ try $0.activatedCandidateRevision(commandID: CommandID(binding.commandID)) }) == nil else { return false }
        let status = try r.repository.command(CommandID(binding.commandID))?.status
        return status != .scheduling && status != .applying
    }
    private func onboardingResponse(_ saved: OnboardingSnapshot, in r: ScreenTimeRuntime?) throws -> ProductResponse {
        try r?.protectFiles()
        let draft = saved.progress.draft
        let ready = draft?.selectionRef.map { authorization() == "approved" && confirmedSelections.contains(SelectionRef($0)) } ?? false
        let binding = draft?.binding
        let command = try binding.flatMap { binding in try r?.repository.command(CommandID(binding.commandID)) }
        let editable = try binding.map { binding in try r.map { try onboardingCanEdit(binding, ruleID: draft!.id, in: $0) } ?? true } ?? true
        return ProductResponse(snapshot: try r.map(snapshot), onboarding: ProductOnboardingDTO(revision: String(saved.revision),
            seenIntro: saved.progress.seenIntro, completed: saved.progress.completed, draft: draft.map(ProductOnboardingDTO.Draft.init),
            selectionReady: ready, commandState: command.map { $0.status.rawValue }, canEdit: editable))
    }

    private func refresh(_ r: ScreenTimeRuntime) async throws {
        let before = try r.repository.readSnapshot(), context = r.contexts.context(activation: before.activation)
        if context.authorization.status == .approved, before.activation == .enabled {
            _ = try? r.monitors.prepare(before.policy)
        }
        // perform() skips refresh while any host command is in flight. At this serialized host
        // boundary, remaining Scheduling/Applying belongs to an operation that already ended.
        _ = await (try r.makeService(stopping: before.activation == .paused)).reconcile(recoverInterruptedCommands: true)
        if let ready = try? r.monitors.readyPlan(for: r.repository.readSnapshot().policy) { try? r.monitors.cleanup(keeping: ready) }
        // Best-effort bounded import after OS/control reconciliation. Sink failure is persisted
        // as HistoryIncomplete by Storage; it never rolls back a restriction or confirmed reason.
        try? await ProductHistoryController.shared.importForMaintenance()
        try r.protectFiles()
    }

    private func cancelCandidate(_ r: ScreenTimeRuntime, ref: String?) throws {
        // An absent ref owns nothing. A regular editor cannot cancel onboarding/recovery or
        // another flow merely because its accepted candidate is currently in this singleton.
        guard let ref else { return }
        let service = RulePreviewService(repository: r.repository, contexts: r.contexts)
        let acknowledged = try service.discard(ref: ref, ownedCandidate: candidateOwner == .rule ? candidate?.0 : nil)
        // An acknowledgement of an old completed ID cannot release a newer flow's cache.
        if candidateOwner == .rule, candidate?.0.commandID == acknowledged {
            candidate = nil; candidateOwner = nil
        }
    }

    private func snapshot(_ r: ScreenTimeRuntime) throws -> ProductSnapshotDTO {
        let stored = try r.repository.readSnapshot(), context = r.contexts.context(activation: stored.activation)
        checkReviewGate(stored, in: r)
        let reservations = try r.repository.unfinishedGrants().filter { !$0.hasEnded }
        let grants = reservations.map(\.grant)
        let rules = try RuleEvaluator.evaluate(policy: stored.policy, selections: stored.selections.map(\.selection), context: context,
            through: Instant(secondsSince1970: context.now.secondsSince1970 + 8 * 86400))
        let evaluated = try GrantEvaluator.evaluate(policy: stored.policy, selections: stored.selections.map(\.selection), context: context, grants: grants)
        var result = ProductSnapshotDTO()
        result.storage = "ready"; result.authorization = context.authorization.status.rawValue
        result.activation = stored.activation.rawValue; result.revision = String(stored.policy.revision.rawValue)
        result.sequence = String(stored.snapshotSequence.rawValue)
        result.schedulesReady = (try? r.monitors.readyPlan(for: stored.policy)) != nil
        result.needsSelectionReview = stored.activation == .awaitingReauthorizationConfirmation
            && !Set(stored.policy.rules.filter(\.enabled).map(\.selectionRef)).isSubset(of: confirmedSelections)
        result.defaultMinutes = stored.policy.defaultUnlockDuration.minutes
        result.historyIncomplete = try r.repository.historyBoundary().historyIncomplete
        result.selections = stored.selections.map { ProductSelectionDTO(ref: $0.selection.ref.rawValue.uuidString.lowercased(), count: $0.selection.targets.count) }
        var details = RuleDetailsSnapshot()
        do { details = try ProductRuleDetailsStore.read(activeRuleIDs: Set(stored.policy.rules.map { $0.id.rawValue })); result.ruleDetailsRevision = String(details.revision) }
        catch { result.ruleDetailsStatus = "unavailable" }
        result.rules = stored.policy.priorityOrder.compactMap { id in stored.policy.rules.first { $0.id == id } }.map { rule in
            ProductRuleDTO(id: rule.id.rawValue.uuidString.lowercased(), selectionRef: rule.selectionRef.rawValue.uuidString.lowercased(),
                weekdays: rule.schedule.weekdays.map(\.rawValue).sorted(), startMinute: rule.schedule.startMinute,
                endMinute: rule.schedule.endMinute, nextDay: rule.schedule.endDayOffset == .nextDay, enabled: rule.enabled,
                title: details.rules[rule.id.rawValue]?.title, goal: details.rules[rule.id.rawValue]?.goal)
        }
        let used = Set(stored.policy.rules.map(\.selectionRef))
        let targets = Set(stored.selections.filter { used.contains($0.selection.ref) }.flatMap { $0.selection.targets })
        result.targets = targets.sorted { $0.rawValue.uuidString < $1.rawValue.uuidString }.map { ref in
            let selected = stored.selections.first { used.contains($0.selection.ref) && $0.selection.targets.contains(ref) }!
            let winner = evaluated.rules.targets[ref]?.winner
            let active = grants.first { $0.targetRef == ref && $0.reservesTarget }
            return ProductTargetDTO(ref: ref.rawValue.uuidString.lowercased(), selectionRef: selected.selection.ref.rawValue.uuidString.lowercased(),
                restricted: evaluated.desiredTargets.contains(ref), unlockable: stored.activation == .enabled && context.authorization.status == .approved
                    && winner?.rule.unlockMode == .reason && result.schedulesReady && active == nil,
                grantEndsAt: active?.effectiveExpiresAt.secondsSince1970, grantCommandID: active?.commandID.rawValue.uuidString.lowercased(),
                ruleID: winner?.rule.id.rawValue.uuidString.lowercased(), grantStatus: active?.status.rawValue)
        }
        let order = Dictionary(uniqueKeysWithValues: stored.policy.priorityOrder.enumerated().map { ($1, $0) })
        let active = rules.activeOccurrences.sorted { order[$0.rule.id, default: 0] < order[$1.rule.id, default: 0] }.first
        result.period = active.map { ProductPeriodDTO(ruleID: $0.rule.id.rawValue.uuidString.lowercased(), startsAt: $0.startsAt.secondsSince1970, endsAt: $0.endsAt.secondsSince1970) }
        result.periods = rules.activeOccurrences.sorted {
            if $0.startsAt != $1.startsAt { return $0.startsAt < $1.startsAt }
            return $0.rule.id.rawValue.uuidString < $1.rule.id.rawValue.uuidString
        }.map { ProductPeriodDTO(ruleID: $0.rule.id.rawValue.uuidString.lowercased(), startsAt: $0.startsAt.secondsSince1970, endsAt: $0.endsAt.secondsSince1970) }
        result.nextPeriod = rules.occurrences.filter { $0.startsAt > context.now }.min { $0.startsAt < $1.startsAt }.map {
            ProductPeriodDTO(ruleID: $0.rule.id.rawValue.uuidString.lowercased(), startsAt: $0.startsAt.secondsSince1970, endsAt: $0.endsAt.secondsSince1970)
        }
        if let application = stored.application,
           application.evaluation.policyRevision == stored.policy.revision, application.evaluation.timeZone == context.timeZone,
           let valid = application.observation.validUntil, valid > context.now, application.observation.observedAt <= context.now {
            result.observation = application.observation.status.rawValue
            result.validUntil = valid.secondsSince1970; result.evaluatedAt = application.observation.observedAt.secondsSince1970
        }
        return result
    }

    private func authorization() -> String {
        switch AuthorizationCenter.shared.authorizationStatus { case .approved: return "approved"; case .denied: return "denied"; default: return "unknown" }
    }
    private func commandResponse(_ result: CommandRunResult, in r: ScreenTimeRuntime) throws -> ProductResponse {
        let status = try r.repository.command(result.commandID)?.status
        let succeeded = result.failure == nil && result.disposition == .committed && status == .succeeded
        let retryable = status == .failed || status == .uncertain
        return ProductResponse(status: succeeded ? "ok" : "error",
            code: succeeded ? nil : result.failure.map(code) ?? (retryable ? "retry-required" : "application-uncertain"),
            ref: result.commandID.rawValue.uuidString.lowercased(), snapshot: try snapshot(r), retryable: retryable)
    }
    private func checkReviewGate(_ snapshot: ControlSnapshot, in r: ScreenTimeRuntime) {
        let approved = r.contexts.context(activation: snapshot.activation).authorization.status == .approved
        if !approved || (snapshot.activation == .awaitingReauthorizationConfirmation && !reviewGateActive) { confirmedSelections.removeAll() }
        reviewGateActive = snapshot.activation == .awaitingReauthorizationConfirmation
    }
    private func observeEpoch(_ epoch: Int, in r: ScreenTimeRuntime) throws {
        guard epoch > denialEpoch else { return }
        confirmedSelections.removeAll(); grantPreview = nil
        try r.makeService(stopping: true).recordAuthorizationDenial(observedAt: NativeScheduleClock.instant(Date()))
        denialEpoch = epoch
    }
    private func code(_ failure: OperationFailure) -> String {
        switch failure { case .authorizationRequired: return "authorization-required"; case .registrationFailure: return "schedule-failed"
        case .storageFailure: return "storage-failed"; case .busy: return "busy"; case .interrupted: return "changed"
        default: return "application-uncertain" }
    }
    private func failureCode(_ error: any Error) -> String {
        switch error {
        case RuleDetailsError.changed: return "changed"
        case RuleDetailsError.invalidInput: return "invalid-input"
        case is RuleDetailsError: return "storage-failed"
        case CommandServiceError.confirmationChanged, CommandServiceError.confirmationRequired, StorageError.conflict,
             GrantEvaluationError.stalePolicy, GrantEvaluationError.staleOccurrence, GrantEvaluationError.confirmationChanged: return "changed"
        case CommandServiceError.authorizationRequired, GrantEvaluationError.authorizationRequired: return "authorization-required"
        case ScreenTimeRuntimeError.busy, StorageError.busy: return "busy"
        case ScreenTimeRuntimeError.scheduleUnavailable: return "schedule-failed"
        case ScreenTimeRuntimeError.invalidSelection, RulePreviewError.invalidSelection: return "selection-required"
        case RulePreviewError.invalidInput: return "invalid-input"
        case HistoryError.capacityExceeded: return "reason-storage-full"
        case HistoryError.invalidCapacity: return "unavailable"
        case GrantEvaluationError.emptyReason: return "reason-required"
        case is ModelError: return "invalid-input"
        case is StorageError, is HistoryError: return "storage-failed"
        default: return "unavailable"
        }
    }
}
