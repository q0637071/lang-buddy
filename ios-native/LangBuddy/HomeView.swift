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
    }

    // 第一版先把入口按"今天学什么"的顺序排出来，各功能页后面逐个做
    private let items: [PathItem] = [
        .init(icon: "video.fill", title: "AI 视频通话", subtitle: "和 AI 私教面对面练口语", featured: true),
        .init(icon: "bubble.left.and.bubble.right.fill", title: "AI 对话练习", subtitle: "打字或语音，随时开口"),
        .init(icon: "books.vertical.fill", title: "今日单词", subtitle: "按遗忘曲线安排复习"),
        .init(icon: "text.book.closed.fill", title: "语法精讲", subtitle: "一次讲透一个知识点"),
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
                            app.showToast("这个功能正在做，敬请期待")
                        } label: {
                            card(item)
                        }
                        .buttonStyle(.plain)
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
