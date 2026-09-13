import SwiftUI

/// AI 对话。原生版和网页版的区别就在这一屏：全屏气泡、键盘跟随、自动滚到底。
struct ChatView: View {
    @EnvironmentObject var app: AppState
    /// nil = 自由聊天；有值 = 情景练习，AI 会按这个角色和目标推进
    var scenario: Scenario? = nil

    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var loading = true
    @State private var languages: [LanguageOption] = []
    @State private var inputLang = "zh"
    @State private var replyLang = "en"
    @FocusState private var inputFocused: Bool

    @StateObject private var speaker = Speaker.shared
    // 存的是"跟谁聊"。音色不再单独设——选了人就等于选了声音，
    // 分两处设置只会让用户困惑（选了严格教练却配着甜美女声）。
    @AppStorage("lb_persona") private var personaId = "hannah"
    @State private var personas: [Persona] = []
    /// 当前人设对应的音色；人设还没加载出来时退回默认
    private var voice: String {
        personas.first(where: { $0.id == personaId })?.voice ?? "hannah"
    }
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
        // 微信那块浮在中间的录音提示。按住时才出现，盖在整个页面上方，
        // 让人一眼确认"确实在录"，而不是盯着一个变了色的按钮猜。
        .overlay { if recorder.isRecording { recordingOverlay } }
        // 开始录、进入取消区、松手发送各给一次震动反馈，和微信一致
        .sensoryFeedback(.impact(weight: .medium), trigger: recorder.isRecording)
        .sensoryFeedback(.warning, trigger: willCancel)
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea(edges: .bottom))
        .task { await load() }
        // 离开对话页要停掉朗读，否则声音会跟着人跑到别的页面
        .onDisappear { speaker.stop() }
        // 朗读失败要说出来。之前是静默失败，用户只看到"没声音"，无从下手
        .onChange(of: speaker.lastError) { _, e in
            if let e { app.showToast("朗读失败：\(e)"); speaker.lastError = nil }
        }
    }

    // MARK: - 顶部

    private var header: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    // 从场景进来的就退回场景列表，否则回首页
                    app.route = scenario == nil ? .home : .scenarios
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .frame(width: 44, height: 44)
                }
                Spacer()
                VStack(spacing: 1) {
                    Text(scenario == nil ? "AI 对话练习" : scenario!.title)
                        .font(.system(size: 16, weight: .semibold))
                    if let s = scenario {
                        Text(s.emoji + " 情景练习")
                            .font(.system(size: 11)).foregroundColor(Theme.muted)
                    }
                }
                Spacer()
                Menu {
                    // 音色不再单独选：选了人就等于选了声音。分两处设置只会让人困惑
                    Toggle("自动朗读 AI 回复", isOn: $autoSpeak)
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

            // 情景练习里 AI 要扮演店员/面试官这些固定角色，再叠一层人设只会打架，
            // 所以只有自由聊天才给选"跟谁聊"
            if scenario == nil, !personas.isEmpty {
                Divider()
                PersonaPicker(selected: $personaId, personas: personas)
            }

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
            Text(scenario.map { "目标：\($0.goal ?? $0.brief)" }
                 ?? "AI 会按你的水平（\(app.user?.levelText ?? "初级")）调整难度")
                .font(.system(size: 13)).foregroundColor(Theme.muted.opacity(0.8))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 30)
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
                        Task {
                            micGranted = await recorder.requestPermission()
                            // 配置问题要说得足够具体，否则用户只能看到一个按不动的按钮
                            if micGranted == false, let e = recorder.lastError {
                                app.showToast(e)
                            }
                        }
                    }
                    if !voiceMode { recorder.cancel() }   // 切回键盘时别让录音悬着
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

    // MARK: - 录音浮层

    private var recordingOverlay: some View {
        ZStack {
            // 半透明背景既是视觉焦点，也顺带挡住误触
            Color.black.opacity(0.12).ignoresSafeArea()

            VStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(willCancel ? Theme.danger : Color(red: 0.35, green: 0.78, blue: 0.55))
                        .frame(width: 190, height: 96)

                    if willCancel {
                        Image(systemName: "xmark")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundColor(.white)
                    } else {
                        waveform
                    }
                }

                Text(willCancel ? "松开手指，取消发送" : "手指上滑，取消发送")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(willCancel ? Theme.danger : Color.black.opacity(0.55))
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

                // 快到上限时开始倒数，别让人说到一半被静默截断
                if recorder.maxSeconds - recorder.seconds <= 10 {
                    Text("还可以说 \(max(0, recorder.maxSeconds - recorder.seconds)) 秒")
                        .font(.system(size: 12))
                        .foregroundColor(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.black.opacity(0.45))
                        .clipShape(Capsule())
                }
            }
        }
        .transition(.opacity)
        .animation(.easeOut(duration: 0.15), value: willCancel)
    }

    /// 实时音量条。取最近若干次采样从左往右排，说话时会跟着起伏。
    private var waveform: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(Array(recorder.levels.enumerated()), id: \.offset) { _, lv in
                Capsule()
                    .fill(Color.white.opacity(0.9))
                    // 给个最小高度，安静时也留一条细线，不然中间会空掉显得像卡死
                    .frame(width: 3, height: max(4, lv * 52))
            }
        }
        .frame(height: 56)
        .animation(.linear(duration: 0.06), value: recorder.levels.count)
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
        // 录音时按钮本身只显示"松开发送"，细节都交给中间那块浮层，
        // 手指压在按钮上本来也看不见按钮上的字
        if recorder.isRecording { return willCancel ? "松开手指取消" : "松开发送" }
        if micGranted == false {
            // 三种失败要分开说，因为要做的事完全不同
            if !recorder.hasUsageDescription { return "工程缺麦克风用途说明，见下方提示" }
            return recorder.isPermissionDenied
                ? "麦克风被拒绝，去 设置 → LangBuddy 打开"
                : "拿不到麦克风权限，请重试"
        }
        if micGranted == nil { return "正在获取麦克风权限…" }
        return "按住 说话"
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
        async let l = try? await API.shared.languages()
        // 情景练习每次都是一场新对话，不该把自由聊天的历史拉进来，
        // 否则 AI 会被上一场的话题带跑
        if scenario == nil {
            messages = (try? await API.shared.chatHistory()) ?? []
        } else {
            messages = []
        }
        languages = await l ?? []
        if let target = app.user?.targetLang, !target.isEmpty { replyLang = target }
        // 拿不到人设列表不影响聊天，后端会退回默认，所以失败就当没有，不打断
        if let list = try? await API.shared.personas() {
            personas = list.personas
            // 存着的 id 在列表里找不到了（比如后端改了人设），退回第一个，
            // 否则音色会一直取不到、朗读永远是默认声音
            if !personas.contains(where: { $0.id == personaId }) {
                personaId = list.defaultId ?? personas.first?.id ?? personaId
            }
        }
        loading = false

        // 场景由 AI 先开口，学生才知道该接什么——不然进来面对空白页会愣住
        if let s = scenario, let opener = s.opener, !opener.isEmpty, messages.isEmpty {
            let m = ChatMessage(role: "ai", content: opener)
            messages = [m]
            if autoSpeak { Task { await speaker.speak(opener, voice: voice, id: m.id) } }
        }
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
                inputLang: inputLang, replyLang: replyLang,
                scenarioId: scenario?.id,
                personaId: personaId
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

/// 选"跟谁聊"。文字对话和视频通话共用这一个组件——选一次到处生效，
/// 不然用户要在两个地方各选一遍人。
///
/// 放在 ChatView.swift 里而不是新开文件：新文件要手动拖进 Xcode，
/// 那一步已经出过两次岔子，能省则省。
struct PersonaPicker: View {
    @Binding var selected: String
    var personas: [Persona]
    /// 视频通话场景下，如果几位老师共用同一张脸，要如实说明，别让用户以为选了长相
    var showFaceHint: Bool = false
    var sameFaceForAll: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(personas) { p in
                        let on = p.id == selected
                        Button {
                            selected = p.id
                        } label: {
                            VStack(spacing: 3) {
                                // 有照片显示照片，没有退回 emoji；加载中先占位，别让整排跳动
                                if let url = p.photoURL {
                                    AsyncImage(url: url) { img in
                                        img.resizable().scaledToFill()
                                    } placeholder: {
                                        Color(white: 0.90)
                                    }
                                    .frame(width: 34, height: 34)
                                    .clipShape(Circle())
                                    .overlay(Circle().stroke(on ? Theme.primary : .clear, lineWidth: 2))
                                } else {
                                    Text(p.emoji).font(.system(size: 20))
                                }
                                Text(p.name).font(.system(size: 11, weight: on ? .bold : .medium))
                                Text(p.title).font(.system(size: 9.5))
                                    .foregroundColor(on ? Theme.primaryDark : Theme.muted)
                            }
                            .frame(width: 62)
                            .padding(.vertical, 8)
                            .background(on ? Theme.primaryLight : Color(white: 0.96))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(on ? Theme.primary : Color.clear, lineWidth: 1.5)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .foregroundColor(Theme.text)
                    }
                }
                .padding(.horizontal, 16)
            }
            if let p = personas.first(where: { $0.id == selected }) {
                Text(p.brief)
                    .font(.system(size: 11.5))
                    .foregroundColor(Theme.muted)
                    .padding(.horizontal, 16)
            }
            if showFaceHint && sameFaceForAll {
                Text("几位老师目前共用同一个数字人形象，性格和说话方式不同")
                    .font(.system(size: 10.5))
                    .foregroundColor(Theme.muted.opacity(0.8))
                    .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 8)
    }
}
