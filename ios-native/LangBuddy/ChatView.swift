import SwiftUI

/// AI 对话。原生版和网页版的区别就在这一屏：全屏气泡、键盘跟随、自动滚到底。
struct ChatView: View {
    @EnvironmentObject var app: AppState

    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var loading = true
    @State private var languages: [LanguageOption] = []
    @State private var inputLang = "zh"
    @State private var replyLang = "en"
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else {
                messageList
            }

            inputBar
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea(edges: .bottom))
        .task { await load() }
    }

    // MARK: - 顶部

    private var header: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    app.route = .home
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .frame(width: 44, height: 44)
                }
                Spacer()
                Text("AI 对话练习").font(.system(size: 16, weight: .semibold))
                Spacer()
                Menu {
                    Button("清空对话", role: .destructive) { Task { await clear() } }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .frame(width: 44, height: 44)
                }
            }
            .padding(.horizontal, 6)

            // 语言选择：说什么语言、AI 用什么语言回，是这个功能最关键的两个设置
            HStack(spacing: 10) {
                langPicker(title: "我说", selection: $inputLang)
                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Theme.muted)
                langPicker(title: "AI 回", selection: $replyLang)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)

            Divider()
        }
        .background(Color.white)
    }

    private func langPicker(title: String, selection: Binding<String>) -> some View {
        Menu {
            ForEach(languages) { l in
                Button(l.name) { selection.wrappedValue = l.code }
            }
        } label: {
            HStack(spacing: 4) {
                Text(title).font(.system(size: 12)).foregroundColor(Theme.muted)
                Text(langName(selection.wrappedValue))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.primary)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(Theme.primary)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.primaryLight)
            .clipShape(Capsule())
        }
    }

    private func langName(_ code: String) -> String {
        languages.first { $0.code == code }?.name ?? code
    }

    // MARK: - 消息列表

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if messages.isEmpty {
                        emptyHint.padding(.top, 40)
                    }
                    ForEach(messages) { m in
                        bubble(m).id(m.id)
                    }
                    if sending {
                        typingBubble.id("typing")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            // 新消息进来自动滚到底，不用用户自己拖
            .onChange(of: messages.count) { _, _ in scrollToEnd(proxy) }
            .onChange(of: sending) { _, _ in scrollToEnd(proxy) }
            .onTapGesture { inputFocused = false }
        }
    }

    private func scrollToEnd(_ proxy: ScrollViewProxy) {
        let target = sending ? "typing" : messages.last?.id
        guard let target else { return }
        withAnimation(.easeOut(duration: 0.25)) {
            proxy.scrollTo(target, anchor: .bottom)
        }
    }

    private var emptyHint: some View {
        VStack(spacing: 10) {
            Text("👋").font(.system(size: 40))
            Text("说点什么，开始练习吧")
                .font(.system(size: 15)).foregroundColor(Theme.muted)
            Text("AI 会按你的水平（\(app.user?.levelText ?? "初级")）调整难度")
                .font(.system(size: 13)).foregroundColor(Theme.muted.opacity(0.8))
        }
    }

    private func bubble(_ m: ChatMessage) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            if m.isUser { Spacer(minLength: 50) }
            if !m.isUser {
                Text("🐣")
                    .font(.system(size: 17))
                    .frame(width: 32, height: 32)
                    .background(Color.white)
                    .clipShape(Circle())
            }
            Text(m.content)
                .font(.system(size: 16))
                .foregroundColor(m.isUser ? .white : Theme.text)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(m.isUser ? Theme.primary : Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .textSelection(.enabled)
            if !m.isUser { Spacer(minLength: 50) }
        }
    }

    private var typingBubble: some View {
        HStack(spacing: 8) {
            Text("🐣").font(.system(size: 17))
                .frame(width: 32, height: 32).background(Color.white).clipShape(Circle())
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle().fill(Theme.muted.opacity(0.5)).frame(width: 6, height: 6)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            Spacer(minLength: 50)
        }
    }

    // MARK: - 输入栏

    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                TextField("说点什么…", text: $draft, axis: .vertical)
                    .font(.system(size: 16))
                    .lineLimit(1...4)
                    .focused($inputFocused)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Color(red: 0.95, green: 0.95, blue: 0.97))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 38, height: 38)
                        .background(canSend ? Theme.primary : Theme.muted.opacity(0.4))
                        .clipShape(Circle())
                }
                .disabled(!canSend)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Color.white)
        }
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending
    }

    // MARK: - 数据

    private func load() async {
        async let h = try? await API.shared.chatHistory()
        async let l = try? await API.shared.languages()
        messages = await h ?? []
        languages = await l ?? []
        if let target = app.user?.targetLang, !target.isEmpty { replyLang = target }
        loading = false
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        inputFocused = false
        messages.append(ChatMessage(role: "user", content: text))
        sending = true
        defer { sending = false }
        do {
            let reply = try await API.shared.sendChat(
                message: text,
                history: messages.dropLast().map { $0 },   // 不含刚发出的这条
                inputLang: inputLang, replyLang: replyLang
            )
            messages.append(ChatMessage(role: "ai", content: reply))
        } catch {
            app.showToast(error.localizedDescription)
            // 失败时把用户那条留在界面上，方便他直接复制重发，不要凭空消失
        }
    }

    private func clear() async {
        do {
            try await API.shared.clearChat()
            messages = []
        } catch {
            app.showToast(error.localizedDescription)
        }
    }
}
