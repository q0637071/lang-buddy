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

    @StateObject private var speaker = Speaker.shared
    @AppStorage("lb_tts_voice") private var voice = "hannah"
    @AppStorage("lb_tts_auto") private var autoSpeak = true

    // 按住说话
    @StateObject private var recorder = Recorder()
    @State private var voiceMode = false        // 输入栏切成"按住说话"
    @State private var willCancel = false       // 手指上滑到取消区
    @State private var transcribing = false
    // nil = 还没问过。权限必须在切到语音模式时就问，不能等按下去才问——
    // 系统权限框是模态的，会把那一次按压的手势整个打断，表现就是"按住没反应"。
    @State private var micGranted: Bool?
    @State private var holding = false          // 防止 onChanged 连续触发时重复启动

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
        // 离开对话页要停掉朗读，否则声音会跟着人跑到别的页面
        .onDisappear { speaker.stop() }
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
                    Toggle("自动朗读 AI 回复", isOn: $autoSpeak)
                    Picker("朗读音色", selection: $voice) {
                        ForEach(Speaker.voices, id: \.id) { v in
                            Text(v.label).tag(v.id)
                        }
                    }
                    Divider()
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
            VStack(alignment: .leading, spacing: 5) {
                Text(m.content)
                    .font(.system(size: 16))
                    .foregroundColor(m.isUser ? .white : Theme.text)
                    .textSelection(.enabled)

                // 朗读按钮只给 AI 那侧——用户自己写的句子没必要读
                if !m.isUser {
                    Button {
                        Task { await speaker.speak(m.content, voice: voice, id: m.id) }
                    } label: {
                        HStack(spacing: 4) {
                            if speaker.loadingID == m.id {
                                ProgressView().scaleEffect(0.6).frame(width: 14, height: 14)
                            } else {
                                Image(systemName: speaker.speakingID == m.id
                                      ? "speaker.wave.2.fill" : "speaker.wave.2")
                                    .font(.system(size: 12))
                            }
                            Text(speaker.speakingID == m.id ? "停止" : "朗读")
                                .font(.system(size: 12))
                        }
                        .foregroundColor(Theme.primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(m.isUser ? Theme.primary : Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
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
                // 键盘 / 语音 切换
                Button {
                    voiceMode.toggle()
                    inputFocused = false
                    // 切到语音模式就先把权限问掉，别等用户按下去才弹
                    if voiceMode && micGranted == nil {
                        Task { micGranted = await recorder.requestPermission() }
                    }
                } label: {
                    Image(systemName: voiceMode ? "keyboard" : "mic")
                        .font(.system(size: 19))
                        .foregroundColor(Theme.primary)
                        .frame(width: 34, height: 38)
                }

                if voiceMode {
                    holdToTalkButton
                } else {
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
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Color.white)
        }
    }

    private var holdToTalkButton: some View {
        Text(holdLabel)
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(recorder.isRecording ? .white : Theme.text)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(
                recorder.isRecording
                    ? (willCancel ? Theme.danger : Theme.primary)
                    : Color(red: 0.95, green: 0.95, blue: 0.97)
            )
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .contentShape(Rectangle())
            .gesture(
                // minimumDistance 必须是 0，否则手指按下去要挪一下才触发，
                // "按住说话"就变成"按住并挪一下才说话"
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        // onChanged 在按住期间会连续触发几十次，holding 保证只启动一次
                        if !holding { holding = true; beginHold() }
                        // 上滑超过 60pt 进入取消区，和微信一致
                        willCancel = v.translation.height < -60
                    }
                    .onEnded { _ in Task { await endHold() } }
            )
            .disabled(transcribing || micGranted == false)
    }

    private var holdLabel: String {
        if transcribing { return "识别中…" }
        if micGranted == false { return "麦克风权限未开启，去设置里打开" }
        if micGranted == nil { return "正在获取麦克风权限…" }
        guard recorder.isRecording else { return "按住说话" }
        return willCancel ? "松开取消" : "松开发送 · 上滑取消 \(recorder.seconds)s"
    }

    /// 同步启动：权限已经在切模式时问过了，这里不再 await，
    /// 否则按下到真正开始录之间会有一段听不见的空档
    private func beginHold() {
        guard micGranted == true else {
            app.showToast(micGranted == false
                ? "请到 设置 → LangBuddy 里打开麦克风权限"
                : "正在获取麦克风权限，请稍候再试")
            return
        }
        speaker.stop()          // 录音前先停掉朗读，否则会把AI的声音一起录进去
        if !recorder.start(), let e = recorder.lastError {
            app.showToast(e)    // 起不来要说明原因，不能按了没反应
        }
    }

    private func endHold() async {
        holding = false
        let cancelled = willCancel
        willCancel = false
        guard recorder.isRecording else { return }
        if cancelled { recorder.cancel(); return }

        guard let url = recorder.stop() else {
            app.showToast("说话时间太短")
            return
        }
        transcribing = true
        defer { transcribing = false; recorder.discard() }
        do {
            let text = try await API.shared.transcribe(fileURL: url, language: inputLang)
            guard !text.isEmpty else {
                app.showToast("没听清，再说一次")
                return
            }
            await sendText(text)
        } catch {
            app.showToast(error.localizedDescription)
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
        await sendText(text)
    }

    /// 打字和语音走同一条发送路径，免得两边逻辑各写一遍慢慢长歪
    private func sendText(_ text: String) async {
        messages.append(ChatMessage(role: "user", content: text))
        sending = true
        defer { sending = false }
        do {
            let reply = try await API.shared.sendChat(
                message: text,
                history: messages.dropLast().map { $0 },   // 不含刚发出的这条
                inputLang: inputLang, replyLang: replyLang
            )
            let aiMsg = ChatMessage(role: "ai", content: reply)
            messages.append(aiMsg)
            // 口语练习的核心就是听，默认回复完直接读出来，不用每条都手动点
            if autoSpeak {
                Task { await speaker.speak(reply, voice: voice, id: aiMsg.id) }
            }
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
