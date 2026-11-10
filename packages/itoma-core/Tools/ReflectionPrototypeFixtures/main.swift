import Foundation
import ItomaCore

// Explicit synthetic fixture exporter. Not included by the app Pod's source glob.
func instant(_ text: String) throws -> Instant { try Instant(ISO8601DateFormatter().date(from: text)!) }
func interval(_ start: String, _ end: String) throws -> ReflectionPrototypeInterval { try .init(from: instant(start), until: instant(end)) }
struct Clip: Encodable { let from: Double; let until: Double }
struct Request: Encodable { let period: ReflectionPrototypePeriod; let day: String; let clippedTo: Clip? }
struct Entry: Encodable { let request: Request; let response: ReflectionPrototypeSnapshot }
var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
let range = try interval("2026-10-26T00:00:00Z", "2026-11-10T00:00:00Z")
let asOf = try instant("2026-11-10T00:00:00Z")
var restricted: [ReflectionPrototypeInterval] = []
for day in 0..<15 {
    let start = calendar.date(byAdding: .day, value: day, to: range.from.date)!.addingTimeInterval(21 * 3600)
    restricted.append(try .init(from: Instant(start), until: Instant(start.addingTimeInterval(7200))))
}
var output: [String: [Entry]] = [:]
for (index, scenario) in ["recorded", "partial", "observed", "notRecorded", "deleted", "zero"].enumerated() {
    let pointOnly = ["observed", "notRecorded", "deleted"].contains(scenario)
    let coverage: ReflectionPrototypeCoverage = scenario == "notRecorded" ? .notRecorded : scenario == "deleted" ? .deleted : ["partial", "observed"].contains(scenario) ? .partial : .recorded
    let input = try ReflectionPrototypeDataset(sourceID: UUID(uuidString: "00000000-0000-0000-0000-000000000136")!,
        revision: Int64(index + 1), asOf: asOf, timeZone: "UTC", scope: pointOnly ? .pointObservations : .syntheticFixture,
        coverage: coverage, recordedRange: ["notRecorded", "deleted"].contains(scenario) ? nil : range,
        restricted: pointOnly || scenario == "zero" ? [] : restricted,
        unlocked: pointOnly || scenario == "zero" ? [] : [interval("2026-11-09T21:30:00Z", "2026-11-09T21:35:00Z")],
        gaps: scenario == "partial" ? [interval("2026-11-08T21:30:00Z", "2026-11-08T22:15:00Z")] : [])
    var entries: [Entry] = []
    for period in [ReflectionPrototypePeriod.week, .month] {
        for day in ["2026-10-01", "2026-10-26", "2026-11-01", "2026-11-02", "2026-11-09", "2026-11-16", "2026-12-01"] {
            let result = try ReflectionPrototypeCalculator.snapshot(input, period: period, day: day)
            entries.append(Entry(request: Request(period: period, day: day, clippedTo: nil), response: result))
        }
    }
    let month = try ReflectionPrototypeCalculator.snapshot(input, period: .month, day: "2026-11-01")
    for bucket in month.buckets {
        let clip = try ReflectionPrototypeInterval(from: Instant(secondsSince1970: bucket.from), until: Instant(secondsSince1970: bucket.until))
        let result = try ReflectionPrototypeCalculator.snapshot(input, period: .week, day: bucket.day, clippedTo: clip)
        entries.append(Entry(request: Request(period: .week, day: bucket.day, clippedTo: Clip(from: bucket.from, until: bucket.until)), response: result))
    }
    output[scenario] = CommandLine.arguments.contains("--ui") && scenario != "recorded"
        ? entries.filter { $0.request.period == .week && $0.request.day == "2026-11-09" && $0.request.clippedTo == nil }
        : entries
}
let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
FileHandle.standardOutput.write(try encoder.encode(output))
FileHandle.standardOutput.write(Data([10]))
