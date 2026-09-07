import SwiftUI

@main
struct LangBuddyApp: App {
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .task { await app.bootstrap() }
        }
    }
}

/// 按 AppState.route 决定显示哪一屏。App 是流程式的，不用 NavigationStack——
/// 注册→测评→结果这条链路不应该允许用户往回滑。
struct RootView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()

            switch app.route {
            case .launching:
                ProgressView()
            case .welcome:
                WelcomeView().transition(.opacity)
            case .login:
                LoginView().transition(.move(edge: .trailing).combined(with: .opacity))
            case .register:
                RegisterView().transition(.move(edge: .trailing).combined(with: .opacity))
            case .placementIntro:
                PlacementIntroView().transition(.opacity)
            case .placement:
                PlacementTestView().transition(.move(edge: .trailing).combined(with: .opacity))
            case .result(let r):
                PlacementResultView(result: r).transition(.opacity)
            case .home:
                HomeView().transition(.opacity)
            case .chat:
                ChatView().transition(.move(edge: .trailing).combined(with: .opacity))
            case .vocab:
                VocabView().transition(.move(edge: .trailing).combined(with: .opacity))
            case .grammar:
                GrammarListView().transition(.move(edge: .trailing).combined(with: .opacity))
            case .grammarDetail(let id):
                GrammarDetailView(lessonId: id)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            case .videoCall:
                VideoCallView().transition(.opacity)
            case .orbit(let w):
                OrbitView(centerWord: w).transition(.opacity)
            }

            if let toast = app.toast {
                VStack {
                    Spacer()
                    Text(toast)
                        .font(.system(size: 14))
                        .foregroundColor(.white)
                        .padding(.horizontal, 18).padding(.vertical, 11)
                        .background(Color.black.opacity(0.85))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .padding(.bottom, 40)
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: routeKey)
        .animation(.easeInOut(duration: 0.2), value: app.toast)
    }

    /// switch 里的 route 带关联值，不能直接参与 animation 比较，转成字符串做 key
    private var routeKey: String {
        switch app.route {
        case .launching: return "launching"
        case .welcome: return "welcome"
        case .login: return "login"
        case .register: return "register"
        case .placementIntro: return "placementIntro"
        case .placement: return "placement"
        case .result: return "result"
        case .home: return "home"
        case .chat: return "chat"
        case .vocab: return "vocab"
        case .grammar: return "grammar"
        // 详情带上 id，切换不同课程时才会触发过渡动画
        case .grammarDetail(let id): return "grammarDetail-" + id
        case .videoCall: return "videoCall"
        case .orbit(let w): return "orbit-" + w
        }
    }
}
