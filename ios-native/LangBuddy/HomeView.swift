import SwiftUI

struct HomeView: View {
    @EnvironmentObject var app: AppState
    @State private var showSignOut = false

    private struct PathItem: Identifiable {
        let id = UUID()
        let icon: String
        let title: String
        let subtitle: String
        var featured = false
        /// 已经做好的功能给一个目标路由；为 nil 表示还没做，点了给提示
        var route: AppState.Route?
        /// 星球入口要先跟后端要一个随机词才知道去哪，不能写死路由
        var isOrbit = false
    }

    @State private var pickingOrbit = false

    // 按"今天学什么"的顺序排，做好一个接一个
    private let items: [PathItem] = [
        .init(icon: "bubble.left.and.bubble.right.fill", title: "AI 对话练习",
              subtitle: "打字或按住说话，AI 会朗读回复", featured: true, route: .chat(nil)),
        .init(icon: "theatermasks.fill", title: "情景练习",
              subtitle: "每天三个场景，练到能用出来", route: .scenarios),
        .init(icon: "video.fill", title: "AI 视频通话",
              subtitle: "和 AI 私教面对面练口语", route: .videoCall),
        .init(icon: "books.vertical.fill", title: "今日单词",
              subtitle: "卡片式复习，看词根记得更牢", route: .vocab),
        .init(icon: "text.book.closed.fill", title: "语法精讲",
              subtitle: "一次讲透一个知识点，带 AI 批改", route: .grammar),
        .init(icon: "circle.hexagongrid.fill", title: "词根星球",
              subtitle: "顺着词根一次记住一串词", isOrbit: true),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("你好，\(app.user?.displayName ?? "同学")")
                            .font(.system(size: 24, weight: .heavy))
                        Text(levelLine)
                            .font(.system(size: 14))
                            .foregroundColor(Theme.muted)
                    }
                    Spacer()
                    Button {
                        showSignOut = true
                    } label: {
                        // prefix(1) 返回 Substring，直接 ?? "我" 类型对不上，
                        // 用 first + map(String.init) 明确转成 String
                        Text(app.user?.displayName.first.map(String.init) ?? "我")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(Theme.primaryDark)
                            .frame(width: 42, height: 42)
                            .background(Theme.primaryLight)
                            .clipShape(Circle())
                    }
                }
                .padding(.bottom, 22)

                VStack(spacing: 12) {
                    ForEach(items) { item in
                        Button {
                            if item.isOrbit { Task { await openOrbit() } }
                            else if let r = item.route { app.route = r }
                            else { app.showToast("这个功能正在做，敬请期待") }
                        } label: {
                            card(item)
                        }
                        .buttonStyle(.plain)
                        .disabled(item.isOrbit && pickingOrbit)
                    }
                }
            }
            .padding(.horizontal, 22).padding(.top, 20)
        }
        .confirmationDialog("账号", isPresented: $showSignOut, titleVisibility: .visible) {
            Button("重新测评") { app.route = .placementIntro }
            Button("退出登录", role: .destructive) { Task { await app.signOut() } }
            Button("取消", role: .cancel) {}
        }
    }

    /// 星球没有固定入口词，先跟后端随机要一个词根够常见的词再进
    private func openOrbit() async {
        pickingOrbit = true
        defer { pickingOrbit = false }
        do {
            let p = try await API.shared.rootPick()
            if let w = p.word, !w.isEmpty {
                app.route = .orbit(word: w, fromHome: true)
            } else {
                app.showToast("词库里暂时没有合适的词根")
            }
        } catch {
            app.showToast(error.localizedDescription)
        }
    }

    private var levelLine: String {
        let lv = app.user?.levelText ?? "初级"
        if let cefr = app.placement?.cefr, !cefr.isEmpty {
            return "当前水平：\(lv)（\(cefr)）"
        }
        return "当前水平：\(lv)"
    }

    @ViewBuilder
    private func card(_ item: PathItem) -> some View {
        HStack(spacing: 14) {
            Image(systemName: item.icon)
                .font(.system(size: 22))
                .frame(width: 30)
                .foregroundColor(item.featured ? .white : Theme.primary)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(item.featured ? .white : Theme.text)
                Text(item.subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(item.featured ? .white.opacity(0.85) : Theme.muted)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(item.featured ? .white.opacity(0.85) : Theme.muted)
        }
        .padding(18)
        .background(
            Group {
                if item.featured { Theme.brandGradient } else { Color.white }
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(item.featured ? Color.clear : Theme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
