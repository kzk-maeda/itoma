import Foundation
import Glibc
import CSQLiteBench
import ItomaCore
import ItomaSQLite
import ItomaStorage
import ItomaControl

enum BenchError: Error { case invalidArguments, invariant(String) }
func id<Kind>(_ n: Int) -> EntityID<Kind> {
    EntityID(UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!)
}
func raw(_ n: Int) -> String { let value: CommandID = id(n); return value.rawValue.uuidString }
func demand(_ value: Bool, _ message: String) throws { if !value { throw BenchError.invariant(message) } }

@ItomaControlActor final class Contexts: EvaluationContextProvider {
    let now = try! Instant(secondsSince1970: 43_200)
    let zone = try! TimeZoneID("UTC")
    func context(activation: Activation) -> EvaluationContext {
        EvaluationContext(now: now, timeZone: zone,
            authorization: AuthorizationObservation(status: .approved, observedAt: now), activation: activation)
    }
}
@ItomaControlActor final class Scheduler: DeadlineScheduler {
    var registerCount = 0
    func register(_ registration: DeadlineRegistration) async -> DeadlineScheduleResult {
        registerCount += 1
        return .accepted(DeadlineReceipt(registrationID: registration.id, generation: registration.generation,
            scheduledFor: registration.scheduledFor, acceptedAt: try! Instant(secondsSince1970: 43_200)))
    }
    func cancel(_ registration: DeadlineRegistration) async -> DeadlineCancellationResult { .accepted }
}
@ItomaControlActor final class Restriction: RestrictionAdapter {
    var applyCount = 0
    func apply(_ evaluation: Evaluation) -> RestrictionApplicationResult {
        applyCount += 1; return .accepted(.writeAttempt)
    }
}
@ItomaControlActor func makeService(_ repository: ControlRepository, _ restriction: Restriction,
                                   _ scheduler: Scheduler = Scheduler()) throws -> CommandService {
    try CommandService(repository: repository, scheduler: scheduler, restriction: restriction,
        contexts: Contexts(), historyCapacity: HistoryOutboxCapacity(maximumPendingEvents: 100), identifiers: RandomControlIdentifiers())
}

@ItomaControlActor func accept(_ repository: ControlRepository, number: Int) throws -> TemporaryGrant {
    let snapshot = try repository.readSnapshot(), context = Contexts().context(activation: snapshot.activation)
    let evaluation = try GrantEvaluator.evaluate(policy: snapshot.policy, selections: snapshot.selections.map(\.selection),
                                                  context: context, grants: [])
    guard let occurrence = evaluation.rules.targets[id(1)]?.winner?.key else { throw BenchError.invariant("occurrence") }
    let command = try Command(id: id(number), kind: .requestTemporaryGrant, status: .pending,
        expectedPolicyRevision: snapshot.policy.revision, attempt: AttemptNumber(0), reasonRef: id(100 + number))
    let request = try GrantRequest(grantID: id(number), commandID: id(number), targetRef: id(1),
        expectedPolicyRevision: snapshot.policy.revision, expectedOccurrence: occurrence,
        condition: UnlockCondition.reason("synthetic fixture"))
    return try repository.write {
        try $0.acceptGrant(command: command, request: request, context: context, expectedSequence: snapshot.snapshotSequence)
    }.grant
}

func blob(_ row: [SQLValue], _ n: Int) throws -> Data {
    guard case let .blob(value) = row[n] else { throw BenchError.invariant("blob") }; return value
}
func replacingIDs(_ data: Data, _ replacements: [(String, String)]) throws -> Data {
    guard var value = String(data: data, encoding: .utf8) else { throw BenchError.invariant("UTF8") }
    for (old, new) in replacements { value = value.replacingOccurrences(of: old, with: new) }
    return Data(value.utf8)
}

@ItomaControlActor func seed(_ url: URL, terminalCount: Int) async throws {
    let rule = try Rule(id: id(1), version: RuleVersion(0), enabled: true, selectionRef: id(1),
        schedule: WeeklySchedule(weekdays: Set(Weekday.allCases), startMinute: 540, endMinute: 1020, endDayOffset: .sameDay), unlockMode: .reason)
    let repository = try ControlRepository.create(at: url,
        initialPolicy: PolicySnapshot(revision: PolicyRevision(0), rules: [rule], priorityOrder: [id(1)]),
        selections: [StoredSelection(selection: Selection(ref: id(1), targets: [id(1), id(2)]), opaquePayload: Data([1]))], activation: .enabled)
    try repository.installReflectionCapture(capacity: HistoryOutboxCapacity(maximumPendingEvents: 100))
    let service = try makeService(repository, Restriction())
    _ = try accept(repository, number: 101)
    _ = try await service.executeAcceptedGrant(commandID: id(101))
    _ = try await service.endTemporaryGrant(commandID: id(101))
    _ = try accept(repository, number: 102)
    _ = try await service.executeAcceptedGrant(commandID: id(102))
    try demand(try repository.unfinishedGrants().count == 1, "one live grant")
    let rawDB = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
    let command = try rawDB.rows("SELECT kind,expected_revision,record,intent FROM commands WHERE command_id=?", [.text(raw(101))])[0]
    let grant = try rawDB.rows("SELECT target_ref,reserved,retired,record FROM grants WHERE grant_id=?", [.text(raw(101))])[0]
    let registration = try rawDB.rows("SELECT registration_id,generation,record FROM registrations WHERE grant_id=?", [.text(raw(101))])[0]
    guard case let .text(oldRegistration) = registration[0] else { throw BenchError.invariant("registration") }
    // Bulk fixture construction only: clone rows produced by real public APIs; no copied evaluator.
    try rawDB.transaction(writer: true) {
        for n in 1..<terminalCount {
            let key = raw(1_000_000 + n), reg = raw(2_000_000 + n)
            let replacements = [(oldRegistration, reg), (raw(101), key), (raw(201), raw(3_000_000 + n))]
            try rawDB.execute("INSERT INTO commands VALUES (?,?,?,?,?)", [
                .text(key), command[0], command[1], .blob(try replacingIDs(blob(command, 2), replacements)),
                .blob(try replacingIDs(blob(command, 3), replacements))])
            try rawDB.execute("INSERT INTO command_attempts VALUES (?,0,?)", [
                .text(key), .blob(try replacingIDs(blob(command, 2), replacements))])
            try rawDB.execute("INSERT INTO grants VALUES (?,?,?,?,?,?)", [
                .text(key), .text(key), grant[0], grant[1], grant[2], .blob(try replacingIDs(blob(grant, 3), replacements))])
            try rawDB.execute("INSERT INTO command_grant_results VALUES (?,?)", [.text(key), .text(key)])
            try rawDB.execute("INSERT INTO registrations VALUES (?,?,?,?,?)", [
                .text(reg), .text(key), .text(key), registration[1], .blob(try replacingIDs(blob(registration, 2), replacements))])
        }
    }
    // A separate prototype DB keeps experimental tombstones out of current open/quick_check measurements.
    // The real SQLite wrapper deliberately opens without CREATE, including ATTACH inheritance.
    var ledgerHandle: OpaquePointer?
    let ledgerCode = sqlite3_open_v2(url.path + ".ledger.sqlite", &ledgerHandle,
                                    SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil)
    if let ledgerHandle { sqlite3_close(ledgerHandle) }
    try demand(ledgerCode == SQLITE_OK, "create synthetic prototype ledger")
    try rawDB.execute("ATTACH DATABASE ? AS experiment", [.text(url.path + ".ledger.sqlite")])
    try rawDB.execute("CREATE TABLE experiment.terminal_ids(command_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, ended INTEGER NOT NULL)")
    try rawDB.execute("INSERT INTO experiment.terminal_ids SELECT command_id,grant_id,1 FROM grants WHERE reserved=0")
    try rawDB.execute("DETACH DATABASE experiment")
    try rawDB.close()
    // Validate all cloned rows with the actual repository decoder before measuring anything.
    try demand(try repository.unfinishedGrants().count == 1, "clone validation")
    try demand(try repository.grant(id(102))?.grant.status == .active, "active live fixture")
    try repository.close()
    let checkpoint = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
    try checkpoint.execute("PRAGMA wal_checkpoint(TRUNCATE)"); try checkpoint.close()
    print("{\"seed_terminal_count\":\(terminalCount),\"live_grants\":1,\"live_targets\":2,\"rules\":1}")
}

func probeReset() throws {
    guard let symbol = dlsym(dlopen(nil, RTLD_NOW), "itoma_probe_reset") else { throw BenchError.invariant("LD_PRELOAD probe required") }
    unsafeBitCast(symbol, to: (@convention(c) () -> Void).self)()
}
func probeReport() throws -> [String: Any] {
    guard let symbol = dlsym(dlopen(nil, RTLD_NOW), "itoma_probe_snapshot") else { throw BenchError.invariant("probe") }
    let pointer = unsafeBitCast(symbol, to: (@convention(c) () -> UnsafePointer<CChar>).self)()
    return try JSONSerialization.jsonObject(with: Data(String(cString: pointer).utf8)) as! [String: Any]
}
func memory(_ key: String) -> Int {
    let status = (try? String(contentsOfFile: "/proc/self/status", encoding: .utf8)) ?? ""
    return status.split(separator: "\n").first(where: { $0.hasPrefix(key + ":") })?
        .split(whereSeparator: { $0 == " " || $0 == "\t" }).dropFirst().first.flatMap { Int($0) } ?? 0
}

@ItomaControlActor func measure(_ url: URL, operation: String) async throws {
    let warm = ["snapshot", "snapshot-repeat", "stop", "recovery", "callback-warm"].contains(operation)
    let repository = warm ? try ControlRepository.open(at: url) : nil
    let restriction = Restriction(), scheduler = Scheduler()
    let service = try repository.map { try makeService($0, restriction, scheduler) }
    if operation == "snapshot-repeat" {
        _ = try repository!.readSnapshot(); _ = try repository!.unfinishedGrants()
    }
    try probeReset()
    let rssBefore = memory("VmRSS"), peakBefore = memory("VmHWM")
    let start = DispatchTime.now().uptimeNanoseconds
    var outcome = "ok"
    switch operation {
    case "snapshot", "snapshot-repeat":
        _ = try repository!.readSnapshot(); try demand(try repository!.unfinishedGrants().count == 1, "snapshot live count")
    case "stop":
        let value = try await service!.stop(commandID: id(900_000_000)); outcome = String(describing: value.disposition)
        try demand(value.disposition == .committed && value.failure == nil, "stop committed")
    case "recovery":
        let value = await service!.reconcile(recoverInterruptedCommands: true); outcome = String(describing: value.disposition)
        try demand(value.disposition == .committed && value.failure == nil, "recovery committed")
    case "callback-warm":
        let value = service!.reconcileSynchronously(); outcome = String(describing: value.disposition)
        try demand(value.disposition == .committed && value.failure == nil, "callback committed")
    case "callback-cold", "open", "snapshot-cold":
        let fresh = try ControlRepository.open(at: url)
        if operation == "callback-cold" {
            _ = try fresh.readSnapshot() // ScreenTimeRuntime.makeService reads the snapshot.
            let value = try makeService(fresh, restriction, scheduler).reconcileSynchronously()
            outcome = String(describing: value.disposition)
            try demand(value.disposition == .committed && value.failure == nil, "cold callback committed")
        } else if operation == "snapshot-cold" {
            _ = try fresh.readSnapshot(); try demand(try fresh.unfinishedGrants().count == 1, "cold snapshot")
        }
        // Destruction/close is outside the timed operation, matching a live runtime after open.
        retained = fresh
    case "quick-check", "lightweight-sql-open", "indexed-live-slice":
        let db = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
        if operation == "quick-check" { try demand(try db.rows("PRAGMA quick_check(1)") == [[.text("ok")]], "quick check") }
        else if operation == "lightweight-sql-open" {
            _ = try db.rows("PRAGMA user_version"); _ = try db.rows("PRAGMA application_id"); _ = try db.rows("PRAGMA journal_mode")
        } else {
            // Existing partial index and compact tombstone point lookup only. Completeness is NOT proven by reserved=1.
            _ = try db.rows("SELECT grant_id,command_id,target_ref,record FROM grants WHERE reserved=1")
            let ledger = try SQLiteDatabase(path: url.path + ".ledger.sqlite", busyTimeoutMilliseconds: 100)
            _ = try ledger.rows("SELECT command_id,grant_id,ended FROM terminal_ids WHERE command_id=?", [.text(raw(101))])
            try ledger.close()
        }
        retainedSQL = db
    default: throw BenchError.invalidArguments
    }
    let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6
    var output = try probeReport()
    output["operation"] = operation; output["outcome"] = outcome; output["elapsed_ms"] = elapsed
    output["rss_before_kib"] = rssBefore; output["peak_rss_kib"] = memory("VmHWM")
    output["peak_growth_kib"] = max(0, memory("VmHWM") - peakBefore)
    output["restriction_calls"] = restriction.applyCount; output["scheduler_register_calls"] = scheduler.registerCount
    print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]), encoding: .utf8)!)
    try repository?.close(); try retained?.close(); retained = nil
    try retainedSQL?.close(); retainedSQL = nil
}
@ItomaControlActor var retained: ControlRepository?
@ItomaControlActor var retainedSQL: SQLiteDatabase?

@ItomaControlActor func corruptions(_ url: URL, mode: String) async throws {
    let db = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
    switch mode {
    case "terminal-json": try db.execute("UPDATE grants SET record=X'00' WHERE grant_id=?", [.text(raw(101))])
    case "live-owner": try db.execute("UPDATE commands SET intent=X'00' WHERE command_id=?", [.text(raw(102))])
    case "live-reservation": try db.execute("UPDATE grants SET reserved=0 WHERE grant_id=?", [.text(raw(102))])
    case "live-receipt":
        let row = try db.rows("SELECT record FROM registrations WHERE grant_id=?", [.text(raw(102))])[0]
        var json = try JSONSerialization.jsonObject(with: blob(row, 0)) as! [String: Any]
        var receipt = json["receipt"] as! [String: Any]
        receipt["scheduledFor"] = 1 // Valid Instant encoding, wrong deadline.
        json["receipt"] = receipt
        try db.execute("UPDATE registrations SET record=? WHERE grant_id=?", [
            .blob(try JSONSerialization.data(withJSONObject: json)), .text(raw(102))])
    default: throw BenchError.invalidArguments
    }
    try db.close()
    let repo = try ControlRepository.open(at: url), restriction = Restriction(), scheduler = Scheduler()
    let service = try makeService(repo, restriction, scheduler)
    var snapshot = "ok", unfinished = "ok", stop = "ok"
    do { _ = try repo.readSnapshot() } catch { snapshot = String(describing: error) }
    do { _ = try repo.unfinishedGrants() } catch { unfinished = String(describing: error) }
    let callback = service.reconcileSynchronously()
    let callbackApplyCount = restriction.applyCount
    do {
        let result = try await service.stop(commandID: id(900_000_000))
        stop = "\(result.disposition):\(String(describing: result.failure))"
    } catch { stop = String(describing: error) }
    let output: [String: Any] = ["corruption": mode, "open": "ok", "snapshot": snapshot,
        "unfinished": unfinished, "callback": "\(callback.disposition):\(String(describing: callback.failure))",
        "callback_restriction_calls": callbackApplyCount, "stop": stop,
        "stop_restriction_calls": restriction.applyCount - callbackApplyCount,
        "scheduler_register_calls": scheduler.registerCount]
    print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]), encoding: .utf8)!)
    try repo.close()
}

@ItomaControlActor func replay(_ url: URL) async throws {
    let repo = try ControlRepository.open(at: url), restriction = Restriction(), scheduler = Scheduler()
    let service = try makeService(repo, restriction, scheduler)
    let registration = try repo.registrations(grantID: id(101))[0]
    let newer = try repo.grant(id(102))!.grant
    _ = service.reconcileSynchronously(registrationID: registration.id, generation: registration.generation)
    try demand(try repo.grant(id(102))?.grant == newer, "old callback changed newer grant")
    _ = try accept(repo, number: 101)
    _ = try await service.executeAcceptedGrant(commandID: id(101))
    try demand(scheduler.registerCount == 0, "terminal command registered again")
    try demand(try repo.grant(id(101))?.hasEnded == true, "terminal grant revived")
    _ = try await service.stop(commandID: id(900_000_000))
    _ = try await service.resume(commandID: id(900_000_001))
    let appliesBeforeReplay = restriction.applyCount
    _ = try await service.stop(commandID: id(900_000_000))
    try demand(try repo.readSnapshot().activation == .enabled, "old stop overrode resume")
    try demand(restriction.applyCount == appliesBeforeReplay, "old stop performed OS write")
    try demand(try repo.grant(id(102))?.hasEnded == true, "resume revived grant")
    print("{\"old_callback_preserves_newer_grant\":true,\"terminal_command_register_calls\":0,\"old_stop_overrides_resume\":false,\"resume_revives_grant\":false}")
    try repo.close()
}

@ItomaControlActor func contention(_ url: URL) throws {
    let repo = try ControlRepository.open(at: url), restriction = Restriction()
    let service = try makeService(repo, restriction)
    let competing = try SQLiteDatabase(path: url.path, busyTimeoutMilliseconds: 100)
    try competing.transaction(writer: true) {
        // The competing holder is deliberately outside this measurement window.
        try probeReset()
        let start = DispatchTime.now().uptimeNanoseconds
        let value = service.reconcileSynchronously()
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6
        try demand(value.disposition == .uncertain && value.failure == .storageFailure, "busy callback result")
        try demand(restriction.applyCount == 0, "busy callback performed OS-equivalent write")
        var result = try probeReport()
        result["callback_elapsed_ms"] = elapsed; result["restriction_calls"] = restriction.applyCount
        result["outcome"] = "uncertain:storageFailure"
        print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
    }
    try competing.close(); try repo.close()
}

@main struct Main {
    static func main() async { await run() }
    @ItomaControlActor static func run() async {
        do {
            let args = CommandLine.arguments
            guard args.count == 4 else { throw BenchError.invalidArguments }
            let url = URL(fileURLWithPath: args[2])
            if args[1] == "seed", let count = Int(args[3]), count >= 1 { try await seed(url, terminalCount: count) }
            else if args[1] == "measure" { try await measure(url, operation: args[3]) }
            else if args[1] == "corrupt" { try await corruptions(url, mode: args[3]) }
            else if args[1] == "replay" { try await replay(url) }
            else if args[1] == "contention" { try contention(url) }
            else { throw BenchError.invalidArguments }
        } catch {
            // Synthetic fixtures only; fixed failure class, never dump a payload or binding.
            FileHandle.standardError.write(Data("RetentionBench failed: \(String(describing: error))\n".utf8)); exit(1)
        }
    }
}
