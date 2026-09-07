import SwiftUI
import WebKit
import AVFoundation

/// AI 视频通话。Tavus 交付通话的方式是给一个网页房间地址（tavus.daily.co/...），
/// 所以这一屏内部是 WKWebView —— 这是 Tavus 官方推荐的接入方式。
/// 要做成纯原生需要接 Daily 的 iOS SDK，那是另一套工作量。
struct VideoCallView: View {
    @EnvironmentObject var app: AppState

    @State private var status: AvatarStatus?
    @State private var conversationURL: URL?
    @State private var loading = true
    @State private var starting = false
    @State private var secondsLeft = 0
    @State private var ended = false
    @State private var errorText: String?

    // 计时和心跳分开：计时是给用户看的，心跳是给后端算钱的
    @State private var countdownTask: Task<Void, Never>?
    @State private var heartbeatTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let url = conversationURL {
                CallWebView(url: url)
                    .ignoresSafeArea(edges: .bottom)
            } else {
                lobby
            }

            if conversationURL != nil {
                VStack {
                    HStack {
                        Text(timeText)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Color.black.opacity(0.55))
                            .clipShape(Capsule())
                        Spacer()
                        Button("结束通话") { Task { await end() } }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(Color.red.opacity(0.9))
                            .clipShape(Capsule())
                    }
                    .padding(.horizontal, 16).padding(.top, 8)
                    Spacer()
                }
            }
        }
        .task { await load() }
        // 用户切后台或直接杀掉 App 时也要把会话关掉，否则那边一直在计费
        .onDisappear { stopTimers() }
    }

    // MARK: - 未开始时的说明页

    private var lobby: some View {
        VStack(spacing: 0) {
            HStack {
                Button { app.route = .home } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 44, height: 44)
                }
                Spacer()
            }
            .padding(.horizontal, 6)

            Spacer()

            if loading {
                ProgressView().tint(.white)
            } else if ended {
                Text("📞").font(.system(size: 50))
                Text("通话已结束").font(.system(size: 20, weight: .bold)).foregroundColor(.white)
                    .padding(.top, 12)
                Text(remainText).font(.system(size: 14)).foregroundColor(.white.opacity(0.7))
                    .padding(.top, 4)
            } else {
                Text("🧑‍🏫").font(.system(size: 54))
                Text("和 AI 私教面对面").font(.system(size: 22, weight: .bold)).foregroundColor(.white)
                    .padding(.top, 14)
                Text(subtitleText)
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.75))
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 40).padding(.top, 10)

                if let e = errorText {
                    Text(e)
                        .font(.system(size: 14)).foregroundColor(.orange)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40).padding(.top, 14)
                }
            }

            Spacer()

            VStack(spacing: 10) {
                if ended {
                    Button("回首页") { app.route = .home }
                        .buttonStyle(PrimaryButtonStyle())
                } else if status?.canStart == true {
                    Button(starting ? "接通中…" : "开始通话") { Task { await start() } }
                        .buttonStyle(PrimaryButtonStyle(enabled: !starting))
                        .disabled(starting)
                    Text("通话按分钟计费，用完当月额度会自动停止")
                        .font(.system(size: 12)).foregroundColor(.white.opacity(0.5))
                } else if !loading {
                    Button("回首页") { app.route = .home }
                        .buttonStyle(PrimaryButtonStyle())
                }
            }
            .padding(.horizontal, 22).padding(.bottom, 20)
        }
    }

    private var subtitleText: String {
        guard let s = status else { return "" }
        if !s.enabled { return "这个功能还没开启" }
        if s.isMember != true { return "视频通话是会员功能\n请先开通会员" }
        if s.globalExhausted == true { return "本月体验名额已满\n下月 1 日恢复" }
        if s.isUnlimited { return "管理员账号，不限时长" }
        let left = s.remainingSeconds ?? 0
        if left <= 0 { return "本月体验额度已用完\n下月 1 日重置" }
        return "本月还可通话 \(fmt(left))\n说英语就行，AI 会按你的水平回应"
    }

    private var remainText: String {
        guard let s = status, !s.isUnlimited else { return "" }
        return "本月剩余 \(fmt(max(0, s.remainingSeconds ?? 0)))"
    }

    private var timeText: String {
        secondsLeft > 0 ? "剩余 \(fmt(secondsLeft))" : "即将结束"
    }

    private func fmt(_ sec: Int) -> String {
        sec >= 60 ? "\(sec / 60) 分 \(sec % 60) 秒" : "\(sec) 秒"
    }

    // MARK: - 流程

    private func load() async {
        do { status = try await API.shared.avatarStatus() }
        catch { errorText = error.localizedDescription }
        loading = false
    }

    private func start() async {
        starting = true
        defer { starting = false }

        // 先要到麦克风和摄像头权限再进房间，否则进去是黑屏还不知道为什么
        let granted = await requestMedia()
        guard granted else {
            errorText = "需要摄像头和麦克风权限才能通话，请到 设置 → LangBuddy 里打开"
            return
        }

        do {
            let c = try await API.shared.startAvatarCall()
            guard let url = URL(string: c.conversationUrl) else {
                errorText = "通话地址无效"; return
            }
            secondsLeft = c.maxSeconds
            conversationURL = url
            startTimers()
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func requestMedia() async -> Bool {
        let mic = await AVCaptureDevice.requestAccess(for: .audio)
        let cam = await AVCaptureDevice.requestAccess(for: .video)
        return mic && cam
    }

    private func startTimers() {
        countdownTask?.cancel()
        countdownTask = Task {
            while !Task.isCancelled && secondsLeft > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                secondsLeft -= 1
            }
            if !Task.isCancelled { await end() }   // 时间到自动挂断
        }
        heartbeatTask?.cancel()
        heartbeatTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                if Task.isCancelled { return }
                try? await API.shared.pingAvatar()
            }
        }
    }

    private func stopTimers() {
        countdownTask?.cancel(); countdownTask = nil
        heartbeatTask?.cancel(); heartbeatTask = nil
    }

    private func end() async {
        stopTimers()
        conversationURL = nil
        ended = true
        try? await API.shared.endAvatarCall()
        status = try? await API.shared.avatarStatus()
    }
}

// MARK: - WKWebView 包装

/// Tavus 的通话房间。要点：
/// - allowsInlineMediaPlayback：否则 iOS 会把视频顶成全屏播放器
/// - mediaTypesRequiringUserActionForPlayback = []：视频要能自动播
/// - requestMediaCapturePermissionFor：iOS 15+ 网页请求摄像头/麦克风时必须显式放行，
///   不实现这个回调默认是拒绝，表现就是接通了却一片黑
struct CallWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = context.coordinator
        web.scrollView.isScrollEnabled = false
        web.isOpaque = false
        web.backgroundColor = .black
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate {
        func webView(_ webView: WKWebView,
                     requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            // App 层已经问过系统权限了，这里直接放行，不再弹第二次
            decisionHandler(.grant)
        }
    }
}
