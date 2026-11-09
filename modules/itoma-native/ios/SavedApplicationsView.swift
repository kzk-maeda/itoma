import ExpoModulesCore
import Combine
import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit

/// Only Apple-rendered activity labels are visible; tokens/names never become RN props or events.
final class SavedApplicationsView: ExpoView {
    let onContentSize = EventDispatcher()
    let onSelect = EventDispatcher()
    var selectable = false { didSet { if oldValue != selectable, window != nil { show(applications: cachedApplications) } } }
    var selected = false { didSet { if oldValue != selected, window != nil { show(applications: cachedApplications) } } }
    var selectionRef = "" { didSet { if oldValue != selectionRef { reload() } } }
    var refreshKey = 0 { didSet { if oldValue != refreshKey { reload() } } }
    var source = "poc" { didSet { if oldValue != source { reload() } } }
    var targetRef = "" { didSet { if oldValue != targetRef { reload() } } }
    private var host: UIHostingController<AnyView>?
    private var subscriptions: Set<AnyCancellable> = []
    private var lastHeight: CGFloat = 0
    private var productTask: Task<Void, Never>?
    private var generation = 0
    private var cachedApplications: [ApplicationToken]?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        clipsToBounds = true
        isAccessibilityElement = false
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil {
            cachedApplications = nil
            generation &+= 1; productTask?.cancel(); productTask = nil
            subscriptions.removeAll()
            host?.willMove(toParent: nil)
            host?.view.removeFromSuperview()
            host?.removeFromParent()
            host = nil
            lastHeight = 0
        } else {
            subscriptions.removeAll()
            if #available(iOS 16.0, *) {
                NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
                    .receive(on: DispatchQueue.main).sink { [weak self] _ in
                        MainActor.assumeIsolated { self?.reload() }
                    }.store(in: &subscriptions)
                AuthorizationCenter.shared.$authorizationStatus.receive(on: DispatchQueue.main)
                    .sink { [weak self] _ in MainActor.assumeIsolated { self?.reload() } }
                    .store(in: &subscriptions)
            }
            reload()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        host?.view.frame = bounds
        attachControllerIfNeeded()
    }

    private func attachControllerIfNeeded() {
        guard let host, host.parent == nil, window != nil else { return }
        var responder: UIResponder? = next
        while let current = responder {
            if let parent = current as? UIViewController {
                parent.addChild(host)
                if host.view.superview == nil { addSubview(host.view) }
                host.didMove(toParent: parent)
                return
            }
            responder = current.next
        }
    }

    private func reload() {
        guard window != nil else { return }
        cachedApplications = nil
        generation &+= 1; productTask?.cancel(); productTask = nil
        if source == "product", #available(iOS 16.0, *) {
            let current = generation, ref = selectionRef, target = targetRef.isEmpty ? nil : targetRef
            show(applications: nil)
            productTask = Task { @MainActor [weak self] in
                let data = try? await ProductController.shared.labelData(ref: ref, target: target)
                guard let self, !Task.isCancelled, self.window != nil, self.generation == current else { return }
                let applications = data.flatMap { try? JSONDecoder().decode([ApplicationToken].self, from: $0) }
                self.show(applications: AuthorizationCenter.shared.authorizationStatus == .approved ? applications : nil)
            }
            return
        }
        if #available(iOS 16.0, *) { show(applications: ScreenTimePoC.shared.applicationsForDisplay(ref: selectionRef)) }
        else { show(applications: nil) }
    }

    private func show(applications: [ApplicationToken]?) {
        cachedApplications = applications
        let content: AnyView
        if #available(iOS 16.0, *) {
            content = AnyView(SavedApplicationsContent(applications: applications,
                selectable: source == "product" && selectable, selected: selected,
                onSelect: { [weak self] in self?.onSelect(["selected": true]) }) { [weak self] height in
                Task { @MainActor [weak self] in
                    guard let self, self.window != nil, height.isFinite, height > 0, abs(height - self.lastHeight) > 0.5 else { return }
                    self.lastHeight = height
                    self.onContentSize(["height": Double(height)])
                }
            })
        } else {
            content = AnyView(Text("このiOSでは保存した対象を表示できません。"))
        }
        if let host { host.rootView = content }
        else {
            let controller = UIHostingController(rootView: content)
            controller.view.backgroundColor = .clear
            controller.view.isOpaque = false
            host = controller
            addSubview(controller.view)
        }
        host?.view.frame = bounds
        attachControllerIfNeeded()
        setNeedsLayout()
    }
}

private struct SavedApplicationsHeight: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

@available(iOS 16.0, *)
private struct SavedApplicationsContent: View {
    let applications: [ApplicationToken]?
    let selectable: Bool
    let selected: Bool
    let onSelect: () -> Void
    let onHeight: (CGFloat) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let applications, !applications.isEmpty {
                ForEach(Array(applications.enumerated()), id: \.offset) { _, token in
                    if selectable {
                        Button(action: onSelect) {
                            HStack {
                                Label(token).labelStyle(.titleAndIcon)
                                Spacer()
                                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                            }.font(.body).frame(minHeight: 44)
                        }.buttonStyle(.plain).accessibilityValue(selected ? "選択中" : "未選択")
                            .accessibilityHint("一時解除の対象に選びます")
                    } else {
                        Label(token).labelStyle(.titleAndIcon).font(.body)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } else {
                Text("保存したアプリを表示できません。認可・保存状態を確認するか、対象を選び直してください。")
                    .font(.body).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .background(GeometryReader { geometry in
            Color.clear.preference(key: SavedApplicationsHeight.self, value: geometry.size.height)
        })
        .onPreferenceChange(SavedApplicationsHeight.self, perform: onHeight)
    }
}
