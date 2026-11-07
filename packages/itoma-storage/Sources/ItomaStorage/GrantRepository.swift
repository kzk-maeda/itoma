import Foundation
import ItomaSQLite
import ItomaCore

extension ControlTransaction {
    public func grantForCommand(_ id: CommandID) throws -> StoredGrant? {
        try checked { try repository.loadGrantForCommand(id) }
    }

    public func latestRegistration(grantID: GrantID) throws -> DeadlineRegistration? {
        try checked { try repository.latestRegistration(grantID) }
    }

    public func registrations(grantID: GrantID) throws -> [DeadlineRegistration] {
        try checked { try repository.loadRegistrations(grantID) }
    }

    public func activatedCandidateRevision(commandID: CommandID) throws -> PolicyRevision? {
        try checked {
            let rows = try repository.database.rows("SELECT activated_revision FROM policy_candidates WHERE command_id=?", [.text(commandID.rawValue.uuidString)])
            guard let row = rows.first else { return nil }
            if row[0] == .null { return nil }
            guard case let .integer(value) = row[0] else { throw StorageError.corrupt }
            return try PolicyRevision(value)
        }
    }

    public func grant(_ id: GrantID) throws -> StoredGrant? {
        try checked { try repository.loadGrant(id) }
    }

    public func unfinishedGrants() throws -> [StoredGrant] {
        try checked { try repository.loadReservedGrants() }
    }

    /// Includes logically ended records until their current-store reconciliation is confirmed.
    public func unreconciledGrants() throws -> [StoredGrant] {
        try checked { try repository.loadAllGrants().filter { $0.grant.status != .reconciled } }
    }

    /// A failed cancellation remains eligible on the next successful reconciliation.
    public func endedGrantRegistrations() throws -> [DeadlineRegistration] {
        try checked {
            let ended = Set(try repository.loadAllGrants().filter(\.hasEnded).map(\.grant.id))
            return try ended.sorted { $0.rawValue.uuidString < $1.rawValue.uuidString }
                .flatMap { try repository.loadRegistrations($0) }.filter { $0.status != .obsolete }
        }
    }

    public func registration(_ id: RegistrationID) throws -> DeadlineRegistration? {
        try checked { try repository.loadRegistration(id) }
    }

    public func setActivation(_ activation: Activation, expectedSequence: SnapshotSequence) throws -> ControlSnapshot {
        try checked { try repository.updateActivation(activation, expectedSequence: expectedSequence) }
    }

    public func acceptGrant(
        command: Command, request: GrantRequest, context: EvaluationContext, expectedSequence: SnapshotSequence
    ) throws -> GrantAcceptance {
        try checked {
            let current = try repository.loadSnapshot()
            guard command.kind == .requestTemporaryGrant, command.id == request.commandID,
                  command.expectedPolicyRevision == request.expectedPolicyRevision, command.candidatePolicyRevision == nil,
                  request.condition.mode != .reason || command.reasonRef != nil else { throw StorageError.invalidCommand }
            let intent = CommandIntent(command: command, request: request)
            if let existing = try repository.loadCommand(command.id) {
                guard existing.intent == intent else { throw StorageError.conflict }
                guard let stored = try repository.loadGrantForCommand(command.id) else { throw StorageError.corrupt }
                return GrantAcceptance(command: existing.command, grant: stored.grant, alreadyAccepted: true, snapshot: current)
            }
            guard current.snapshotSequence == expectedSequence, current.activation == context.activation else { throw StorageError.conflict }
            guard command.status == .pending, command.attempt.rawValue == 0 else { throw StorageError.invalidCommand }
            guard try repository.loadGrant(request.grantID) == nil else { throw StorageError.conflict }
            let result = try GrantEvaluator.propose(request, policy: current.policy, selections: current.selections.map(\.selection),
                                                    context: context, existingGrants: repository.loadReservedGrants().map(\.grant))
            switch result {
            case let .existing(grant):
                let joined = try Command(id: command.id, kind: command.kind, status: .superseded,
                                         expectedPolicyRevision: command.expectedPolicyRevision,
                                         candidatePolicyRevision: nil, attempt: command.attempt, reasonRef: command.reasonRef)
                try repository.insertCommand(joined, intent: intent)
                try repository.storeGrantResult(commandID: command.id, grantID: grant.id)
                try repository.advanceSequence()
                return GrantAcceptance(command: joined, grant: grant, alreadyAccepted: true, snapshot: try repository.loadSnapshot())
            case let .proposed(grant):
                try repository.insertCommand(command, intent: intent)
                try repository.database.execute("INSERT INTO grants VALUES (?,?,?,?,?,?)", [
                    .text(grant.id.rawValue.uuidString), .text(grant.commandID.rawValue.uuidString), .text(grant.targetRef.rawValue.uuidString),
                    .integer(grant.reservesTarget ? 1 : 0), .integer(0), .blob(try JSONEncoder().encode(GrantDTO(grant)))
                ])
                try repository.storeGrantResult(commandID: command.id, grantID: grant.id)
                try repository.advanceSequence()
                return GrantAcceptance(command: command, grant: grant, alreadyAccepted: false, snapshot: try repository.loadSnapshot())
            }
        }
    }

    /// Logical metadata update only; Active/Applying requires matching current registration facts.
    public func recordGrant(
        _ updated: TemporaryGrant, expected: TemporaryGrant,
        registrationID: RegistrationID? = nil, context: EvaluationContext? = nil
    ) throws -> StoredGrant {
        try checked {
            guard let stored = try repository.loadGrant(updated.id), stored.grant == expected else { throw StorageError.conflict }
            if updated == expected { return stored }
            guard expected.status != .reconciled else { throw StorageError.conflict }
            try repository.validateGrantIdentity(updated, previous: expected)
            // Nonterminal shortening is a proposal until the candidate/receipt commit path accepts it.
            guard updated.effectiveExpiresAt == expected.effectiveExpiresAt || ControlRepository.endedStatus(updated.status) else {
                throw StorageError.conflict
            }
            if stored.hasEnded {
                guard [.expired, .invalidated, .reblockPending, .reconciled, .uncertain, .failed].contains(updated.status) else {
                    throw StorageError.conflict
                }
            }
            if updated.status == .active || updated.status == .applying {
                guard !stored.hasEnded, let context, let registrationID else { throw StorageError.conflict }
                let current = try repository.loadSnapshot()
                guard context.activation == current.activation else { throw StorageError.conflict }
                try repository.checkRegistration(registrationID, grant: updated, context: context, candidate: nil,
                                                  uncommittedReceipts: receiptsWrittenHere)
                let all = try repository.loadReservedGrants().filter { $0.grant.id != updated.id && !$0.hasEnded }.map(\.grant)
                let evaluation = try GrantEvaluator.evaluate(policy: current.policy, selections: current.selections.map(\.selection),
                                                             context: context, grants: all + [replacingStatus(updated, .active)])
                guard evaluation.assessments.first(where: { $0.grant.id == updated.id })?.disposition == .effective else {
                    throw StorageError.conflict
                }
            }
            try repository.storeGrant(updated, previouslyEnded: stored.hasEnded)
            try repository.advanceSequence()
            return try repository.loadGrant(updated.id)!
        }
    }

    public func recordRegistration(_ updated: DeadlineRegistration, expected: DeadlineRegistration? = nil) throws -> DeadlineRegistration {
        try checked {
            let current = try repository.loadSnapshot()
            guard let grant = try repository.loadGrant(updated.grantID) else { throw StorageError.conflict }
            let old = try repository.loadRegistration(updated.id)
            guard old == expected else { throw StorageError.conflict }
            if let old {
                guard old.grantID == updated.grantID, old.commandID == updated.commandID, old.generation == updated.generation,
                      old.policyRevision == updated.policyRevision, old.candidatePolicyRevision == updated.candidatePolicyRevision,
                      old.scheduledFor == updated.scheduledFor,
                      old.receipt == nil || old.receipt == updated.receipt,
                      old.firedAt == nil || old.firedAt == updated.firedAt,
                      old.status != .obsolete || updated.status == .obsolete,
                      updated.status != .preparing || old.status == .preparing else { throw StorageError.conflict }
                if old == updated { return old }
                let addsReceipt = old.receipt == nil && updated.receipt != nil
                let addsFire = old.firedAt == nil && updated.firedAt != nil
                if addsReceipt || addsFire {
                    guard !registrationsCreatedHere.contains(updated.id) else { throw StorageError.conflict }
                }
                if addsReceipt { receiptsWrittenHere.insert(updated.id) }
                if updated.status == .registered {
                    guard !registrationsCreatedHere.contains(updated.id) else { throw StorageError.conflict }
                    receiptsWrittenHere.insert(updated.id)
                }
                try repository.database.execute("UPDATE registrations SET record=? WHERE registration_id=?", [
                    .blob(try JSONEncoder().encode(RegistrationDTO(updated))), .text(updated.id.rawValue.uuidString)
                ])
            } else {
                guard updated.status == .preparing, updated.receipt == nil, updated.firedAt == nil,
                      !grant.hasEnded, updated.policyRevision == current.policy.revision,
                      let owner = try repository.loadCommand(updated.commandID)?.command,
                      [.pending, .scheduling, .applying].contains(owner.status) else { throw StorageError.conflict }
                let next = try repository.latestRegistration(updated.grantID).map { try $0.generation.next() } ?? RegistrationGeneration(0)
                guard updated.generation == next, grant.grant.acceptedAt < updated.scheduledFor,
                      updated.scheduledFor <= grant.grant.effectiveExpiresAt else { throw StorageError.conflict }
                if let candidateRevision = updated.candidatePolicyRevision {
                    guard owner.kind == .commitPolicy,
                          let candidate = try repository.loadCandidate(owner.id),
                          candidate.expectedRevision == current.policy.revision,
                          candidate.proposedPolicy.revision == candidateRevision else { throw StorageError.conflict }
                } else {
                    guard owner.kind == .requestTemporaryGrant, owner.id == grant.grant.commandID,
                          updated.scheduledFor == grant.grant.effectiveExpiresAt else { throw StorageError.conflict }
                }
                try repository.database.execute("INSERT INTO registrations VALUES (?,?,?,?,?)", [
                    .text(updated.id.rawValue.uuidString), .text(updated.grantID.rawValue.uuidString), .text(updated.commandID.rawValue.uuidString),
                    .integer(updated.generation.rawValue), .blob(try JSONEncoder().encode(RegistrationDTO(updated)))
                ])
                registrationsCreatedHere.insert(updated.id)
            }
            try repository.advanceSequence()
            return updated
        }
    }
}

extension ControlRepository {
    public func grant(_ id: GrantID) throws -> StoredGrant? {
        try serialized { try database.transaction(writer: false) { _ = try loadSnapshot(); return try loadGrant(id) } }
    }
    public func unfinishedGrants() throws -> [StoredGrant] {
        try serialized { try database.transaction(writer: false) { _ = try loadSnapshot(); return try loadReservedGrants() } }
    }
    public func grantForCommand(_ id: CommandID) throws -> StoredGrant? {
        try serialized { try database.transaction(writer: false) { _ = try loadSnapshot(); return try loadGrantForCommand(id) } }
    }
    public func registration(_ id: RegistrationID) throws -> DeadlineRegistration? {
        try serialized { try database.transaction(writer: false) { _ = try loadSnapshot(); return try loadRegistration(id) } }
    }
    public func registrations(grantID: GrantID) throws -> [DeadlineRegistration] {
        try serialized { try database.transaction(writer: false) {
            _ = try loadSnapshot()
            return try loadRegistrations(grantID)
        } }
    }

    func loadRegistrations(_ grantID: GrantID) throws -> [DeadlineRegistration] {
        try database.rows("SELECT registration_id,grant_id,command_id,generation,record FROM registrations WHERE grant_id=? ORDER BY generation", [
            .text(grantID.rawValue.uuidString)
        ]).map(decodeRegistration)
    }

    func createGrantTables() throws {
        try database.execute("ALTER TABLE policy_candidates ADD COLUMN activated_revision INTEGER")
        try database.execute("""
            CREATE TABLE grants (grant_id TEXT PRIMARY KEY NOT NULL,command_id TEXT UNIQUE NOT NULL REFERENCES commands(command_id),
              target_ref TEXT NOT NULL,reserved INTEGER NOT NULL CHECK(reserved IN (0,1)),
              retired INTEGER NOT NULL CHECK(retired IN (0,1)),record BLOB NOT NULL)
            """)
        try database.execute("CREATE UNIQUE INDEX grants_one_reserved_target ON grants(target_ref) WHERE reserved=1")
        try database.execute("""
            CREATE TABLE command_grant_results (command_id TEXT PRIMARY KEY NOT NULL REFERENCES commands(command_id),
              grant_id TEXT NOT NULL REFERENCES grants(grant_id))
            """)
        try database.execute("""
            CREATE TABLE registrations (registration_id TEXT PRIMARY KEY NOT NULL,grant_id TEXT NOT NULL REFERENCES grants(grant_id),
              command_id TEXT NOT NULL REFERENCES commands(command_id),generation INTEGER NOT NULL CHECK(generation>=0),
              record BLOB NOT NULL,UNIQUE(grant_id,generation))
            """)
    }

    func loadGrant(_ id: GrantID) throws -> StoredGrant? {
        try database.rows("SELECT grant_id,command_id,target_ref,reserved,retired,record FROM grants WHERE grant_id=?", [
            .text(id.rawValue.uuidString)
        ]).first.map(decodeGrant)
    }
    func loadGrantForCommand(_ id: CommandID) throws -> StoredGrant? {
        guard let grantID = try loadGrantResultID(id) else {
            if try loadCommand(id)?.command.kind == .requestTemporaryGrant { throw StorageError.corrupt }
            return nil
        }
        guard let grant = try loadGrant(grantID), let intent = try loadCommand(id)?.intent.grant,
              intent.target == grant.grant.targetRef else { throw StorageError.corrupt }
        return grant
    }
    func loadGrantResultID(_ id: CommandID) throws -> GrantID? {
        guard let row = try database.rows("SELECT grant_id FROM command_grant_results WHERE command_id=?", [.text(id.rawValue.uuidString)]).first else { return nil }
        guard case let .text(raw) = row[0], let uuid = UUID(uuidString: raw) else { throw StorageError.corrupt }
        return GrantID(uuid)
    }
    func storeGrantResult(commandID: CommandID, grantID: GrantID) throws {
        try database.execute("INSERT INTO command_grant_results VALUES (?,?)", [
            .text(commandID.rawValue.uuidString), .text(grantID.rawValue.uuidString)
        ])
    }
    func loadReservedGrants() throws -> [StoredGrant] {
        // Validate the denormalized reservation flag even on rows claiming to be terminal.
        try loadAllGrants().filter { $0.grant.reservesTarget }
    }
    func loadAllGrants() throws -> [StoredGrant] {
        try database.rows("SELECT grant_id,command_id,target_ref,reserved,retired,record FROM grants ORDER BY grant_id")
            .map(decodeGrant)
    }
    private func decodeGrant(_ row: [SQLValue]) throws -> StoredGrant {
        guard case let .text(id) = row[0], case let .text(command) = row[1], case let .text(target) = row[2],
              case let .integer(reserved) = row[3], case let .integer(retired) = row[4], case let .blob(data) = row[5] else { throw StorageError.corrupt }
        do {
            let grant = try JSONDecoder().decode(GrantDTO.self, from: data).model()
            guard grant.id.rawValue.uuidString == id, grant.commandID.rawValue.uuidString == command, grant.targetRef.rawValue.uuidString == target,
                  reserved == (grant.reservesTarget ? 1 : 0), retired == 0 || retired == 1,
                  !Self.endedStatus(grant.status) || retired == 1,
                  retired == 0 || ![GrantStatus.pending, .scheduling, .applying, .active].contains(grant.status) else { throw StorageError.corrupt }
            guard let owner = try loadCommand(grant.commandID), let intent = owner.intent.grant,
                  intent.target == grant.targetRef, intent.occurrence == OccurrenceDTO(grant.occurrence),
                  try loadGrantResultID(grant.commandID) == grant.id else { throw StorageError.corrupt }
            return StoredGrant(grant: grant, hasEnded: retired == 1)
        } catch { throw StorageError.corrupt }
    }
    func storeGrant(_ grant: TemporaryGrant, previouslyEnded: Bool) throws {
        try database.execute("UPDATE grants SET reserved=?,retired=?,record=? WHERE grant_id=?", [
            .integer(grant.reservesTarget ? 1 : 0), .integer(previouslyEnded || Self.endedStatus(grant.status) ? 1 : 0),
            .blob(try JSONEncoder().encode(GrantDTO(grant))), .text(grant.id.rawValue.uuidString)
        ])
    }
    static func endedStatus(_ status: GrantStatus) -> Bool { [.expired, .invalidated, .reblockPending, .reconciled].contains(status) }
    func validateGrantIdentity(_ updated: TemporaryGrant, previous: TemporaryGrant) throws {
        guard updated.id == previous.id, updated.commandID == previous.commandID, updated.targetRef == previous.targetRef,
              updated.occurrence == previous.occurrence, updated.acceptedAt == previous.acceptedAt,
              updated.initialExpiresAt == previous.initialExpiresAt, updated.effectiveExpiresAt <= previous.effectiveExpiresAt else {
            throw StorageError.conflict
        }
    }

    func loadRegistration(_ id: RegistrationID) throws -> DeadlineRegistration? {
        try database.rows("SELECT registration_id,grant_id,command_id,generation,record FROM registrations WHERE registration_id=?", [
            .text(id.rawValue.uuidString)
        ]).first.map(decodeRegistration)
    }
    func latestRegistration(_ grant: GrantID) throws -> DeadlineRegistration? {
        try database.rows("SELECT registration_id,grant_id,command_id,generation,record FROM registrations WHERE grant_id=? ORDER BY generation DESC LIMIT 1", [
            .text(grant.rawValue.uuidString)
        ]).first.map(decodeRegistration)
    }
    private func decodeRegistration(_ row: [SQLValue]) throws -> DeadlineRegistration {
        guard case let .text(id) = row[0], case let .text(grant) = row[1], case let .text(command) = row[2],
              case let .integer(generation) = row[3], case let .blob(data) = row[4] else { throw StorageError.corrupt }
        do {
            let value = try JSONDecoder().decode(RegistrationDTO.self, from: data).model()
            guard value.id.rawValue.uuidString == id, value.grantID.rawValue.uuidString == grant,
                  value.commandID.rawValue.uuidString == command, value.generation.rawValue == generation else { throw StorageError.corrupt }
            guard let stored = try loadGrant(value.grantID), let owner = try loadCommand(value.commandID)?.command else { throw StorageError.corrupt }
            if let revision = value.candidatePolicyRevision {
                guard owner.kind == .commitPolicy, owner.expectedPolicyRevision == value.policyRevision,
                      owner.candidatePolicyRevision == revision else { throw StorageError.corrupt }
            } else {
                guard owner.kind == .requestTemporaryGrant, owner.id == stored.grant.commandID else { throw StorageError.corrupt }
            }
            return value
        } catch { throw StorageError.corrupt }
    }

    func checkRegistration(
        _ id: RegistrationID, grant: TemporaryGrant, context: EvaluationContext, candidate: PolicyCandidate?,
        uncommittedReceipts: Set<RegistrationID>
    ) throws {
        guard !uncommittedReceipts.contains(id), let registration = try loadRegistration(id), registration.grantID == grant.id,
              try latestRegistration(grant.id)?.id == id, registration.status == .registered, registration.firedAt == nil,
              registration.scheduledFor == grant.effectiveExpiresAt, let receipt = registration.receipt,
              receipt.acceptedAt <= context.now, context.now < registration.scheduledFor,
              let owner = try loadCommand(registration.commandID)?.command, owner.status == .applying else { throw StorageError.conflict }
        if let candidate {
            guard registration.commandID == candidate.commandID, registration.policyRevision == candidate.expectedRevision,
                  registration.candidatePolicyRevision == candidate.proposedPolicy.revision else { throw StorageError.conflict }
        } else {
            let current = try loadSnapshot()
            guard registration.policyRevision <= current.policy.revision else { throw StorageError.conflict }
            if let revision = registration.candidatePolicyRevision {
                let rows = try database.rows("SELECT activated_revision FROM policy_candidates WHERE command_id=?", [.text(registration.commandID.rawValue.uuidString)])
                guard rows == [[.integer(revision.rawValue)]], revision <= current.policy.revision else { throw StorageError.conflict }
            } else {
                guard registration.commandID == grant.commandID else { throw StorageError.conflict }
            }
        }
    }

    func updateActivation(_ activation: Activation, expectedSequence: SnapshotSequence) throws -> ControlSnapshot {
        let current = try loadSnapshot()
        guard current.snapshotSequence == expectedSequence else { throw StorageError.conflict }
        if current.activation != activation {
            let next = try current.snapshotSequence.next()
            for stored in try loadReservedGrants() where !stored.hasEnded {
                try storeGrant(replacingStatus(stored.grant, .invalidated), previouslyEnded: true)
            }
            try database.execute("UPDATE control_state SET activation=?,snapshot_sequence=? WHERE singleton=1", [
                .text(activation.rawValue), .integer(next.rawValue)
            ])
        }
        return try loadSnapshot()
    }

    func applyCandidateGrantChanges(
        candidate: PolicyCandidate, current: ControlSnapshot, context: EvaluationContext?,
        confirmation: PolicyEditAssessment?, changes: [RegisteredGrantChange], uncommittedReceipts: Set<RegistrationID>
    ) throws {
        let live = try loadReservedGrants().filter { !$0.hasEnded }.map(\.grant)
        if live.isEmpty {
            guard changes.isEmpty else { throw StorageError.conflict }
            return
        }
        guard let context, context.activation == current.activation else { throw StorageError.conflict }
        let selections = current.selections.map(\.selection)
        let preview = try GrantEditEvaluator.preview(candidate: candidate, activePolicy: current.policy, selections: selections,
                                                     context: context, snapshotSequence: current.snapshotSequence, grants: live)
        if let confirmation {
            do {
                try GrantEditEvaluator.checkConfirmation(confirmation, candidate: candidate, activePolicy: current.policy,
                                                         selections: selections, context: context, snapshotSequence: current.snapshotSequence, grants: live)
            } catch GrantEvaluationError.confirmationChanged { throw StorageError.conflict }
        } else if preview.requiresConfirmation { throw StorageError.conflict }
        let impacts = preview.impacts.filter { $0.kind != .unchanged }
        guard Set(changes.map(\.expected.id)).count == changes.count,
              Set(changes.map(\.expected.id)) == Set(impacts.map(\.grantID)) else { throw StorageError.conflict }
        for impact in impacts {
            let change = changes.first { $0.expected.id == impact.grantID }!
            guard let stored = try loadGrant(impact.grantID), !stored.hasEnded, stored.grant == change.expected else { throw StorageError.conflict }
            let expected: TemporaryGrant
            switch impact.kind {
            case .shorten:
                guard let expiry = impact.proposedExpiresAt, let registration = change.registrationID else { throw StorageError.conflict }
                expected = try change.expected.shortened(to: expiry)
                try checkRegistration(registration, grant: expected, context: context, candidate: candidate,
                                      uncommittedReceipts: uncommittedReceipts)
            case .invalidate: expected = try replacingStatus(change.expected, .invalidated)
            case .expire: expected = try replacingStatus(change.expected, .expired)
            case .uncertain: expected = try replacingStatus(change.expected, .uncertain)
            case .unchanged: throw StorageError.conflict
            }
            guard change.updated == expected else { throw StorageError.conflict }
            try storeGrant(change.updated, previouslyEnded: false)
        }
    }
}
