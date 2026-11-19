import Foundation

@main struct DirectRecordTests {
    static func main() throws {
        var checks = 0
        func check(_ value: @autoclosure () -> Bool) { precondition(value()); checks += 1 }
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = DirectProbeFile(directory: directory)
        var first = try DirectProbeRecord(startsAt: 1000, tokenData: Data([1]))
        check(first.decision(activity: first.activityName, now: 1000) == .ignore) // Preparation never shields.
        first.phase = .registering
        check(first.decision(activity: first.activityName, now: 1001) == .ignore)
        first.phase = .armed
        check(first.decision(activity: first.activityName, now: 999) == .ignore)
        check(first.decision(activity: first.activityName, now: 1000) == .apply)
        check(first.decision(activity: first.activityName, now: 2199) == .apply)
        check(first.decision(activity: first.activityName, now: 2200) == .clear)
        check(first.decision(activity: first.activityName, now: .nan) == .ignore)
        let oldName = first.activityName
        first.stop(); first.id = UUID()
        check(first.tokenData == nil)
        check(first.decision(activity: oldName, now: 1001) == .ignore) // Manual stop fences queued callbacks.
        let second = try DirectProbeRecord(startsAt: 2000, tokenData: Data([2]))
        check(second.decision(activity: oldName, now: 2100) == .ignore) // Old end cannot clear the new run.
        try file.withLock { f in
            try f.write(first)
            check(try! f.read()?.phase == .stopped)
            do { _ = try file.withLock { _ in false }; preconditionFailure("recursive lock accepted") }
            catch DirectProbeFailure.busy { checks += 1 }
        }
        try file.withLock { f in try f.write(second); check(try! f.read()?.id == second.id) }
        try Data(repeating: 0, count: 32769).write(to: file.recordURL)
        do { _ = try file.withLock { try $0.read() }; preconditionFailure("oversized record accepted") }
        catch DirectProbeFailure.invalid { checks += 1 }
        var invalid = second; invalid.endsAt += 1
        do { try file.withLock { try $0.write(invalid) }; preconditionFailure("nonfixed duration accepted") }
        catch DirectProbeFailure.invalid { checks += 1 }
        do { _ = try DirectProbeRecord(startsAt: .infinity, tokenData: Data([1])); preconditionFailure("infinite date accepted") }
        catch DirectProbeFailure.invalid { checks += 1 }
        do { _ = try DirectProbeRecord(startsAt: 1, tokenData: Data()); preconditionFailure("empty selection accepted") }
        catch DirectProbeFailure.invalid { checks += 1 }
        print("Direct probe record/lock: \(checks) assertions PASS (fake token bytes; no OS Shield)")
    }
}
