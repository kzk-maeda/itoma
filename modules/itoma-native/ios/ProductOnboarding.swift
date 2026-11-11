import Foundation
import ItomaHistory

struct ProductOnboardingInput: Decodable, Sendable {
    let expectedRevision: String
    let draft: Draft?
    struct Draft: Decodable, Sendable {
        let id: UUID
        let step: OnboardingStep
        let title: String
        let goal: String
        let weekdays: [Int]
        let start: String
        let end: String
        let nextDay: Bool
        let selectionRef: UUID?
        func applying(to existing: OnboardingDraft) throws -> OnboardingDraft {
            guard existing.id == id, existing.binding == nil else { throw RuleDetailsError.changed }
            var value = existing
            value.step = step; value.title = title; value.goal = goal; value.weekdays = weekdays
            value.start = start; value.end = end; value.nextDay = nextDay; value.selectionRef = selectionRef
            try value.validate()
            return value
        }
    }
}
struct ProductOnboardingDTO: Encodable, Sendable {
    let revision: String
    let seenIntro: Bool
    let completed: Bool
    let draft: Draft?
    let selectionReady: Bool
    let commandState: String?
    let canEdit: Bool
    struct Draft: Encodable, Sendable {
        let id: UUID
        let step: OnboardingStep
        let title: String
        let goal: String
        let weekdays: [Int]
        let start: String
        let end: String
        let nextDay: Bool
        let selectionRef: UUID?
        let commandID: UUID?
        let submitted: Bool
        init(_ value: OnboardingDraft) {
            id = value.id; step = value.step; title = value.title; goal = value.goal; weekdays = value.weekdays
            start = value.start; end = value.end; nextDay = value.nextDay; selectionRef = value.selectionRef
            commandID = value.binding?.commandID; submitted = value.binding?.submitted ?? false
        }
    }
}
