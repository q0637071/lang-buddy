import SwiftUI

// 美式口语 / 作文批改 / 错题本 / 我的。
// 四个页面写在同一个文件里是有意的：新文件要手动拖进 Xcode，那一步已经出过两次岔子
// （勾了 Copy items 生成 "xxx 2.swift"，报 Invalid redeclaration）。一次拖一个文件，
// 比拖四个稳。

// MARK: - 美式口语

struct ColloquialView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var speaker = Speaker.shared

    @State private var phrases: [Phrase] = []
    @State private var categories: [String] = []
    @State private var picked: String? = nil      // nil = 全部
    @State private var loading = true

    private var shown: [Phrase] {
        guard let picked else { return phrases }
        return phrases.filter { $0.category == picked }
    }

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: "美式口语") { app.route = .home }
            Divider()

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else if phrases.isEmpty {
                Spacer()
                Text("暂时没有内容").font(.system(size: 15)).foregroundColor(Theme.muted)
                Spacer()
            } else {
                categoryBar
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(shown) { card($0) }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                }
            }
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea())
        .task { await load() }
        .onDisappear { speaker.stop() }
    }

    private var categoryBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("全部", on: picked == nil) { picked = nil }
                ForEach(categories, id: \.self) { c in
                    chip(c, on: picked == c) { picked = c }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .background(Color.white)
    }

    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(.system(size: 13, weight: on ? .bold : .medium))
                .foregroundColor(on ? .white : Theme.text)
                .padding(.horizontal, 13).padding(.vertical, 7)
                .background(on ? Theme.primary : Color(white: 0.94))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func card(_ p: Phrase) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(p.phrase).font(.system(size: 17, weight: .bold))
                if let r = p.register, !r.isEmpty {
                    Text(r)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(Theme.primaryDark)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Theme.primaryLight).clipShape(Capsule())
                }
                Spacer()
                Button {
                    Task { await speaker.speak(p.phrase, voice: "hannah", id: p.id) }
                } label: {
                    Image(systemName: "speaker.wave.2.fill")
                        .font(.system(size: 14))
                        .foregroundColor(Theme.primary)
                        .frame(width: 32, height: 32)
                }
            }
            Text(p.meaning).font(.system(size: 14)).foregroundColor(Theme.text)
            if let e = p.example, !e.isEmpty {
                Text(e).font(.system(size: 13.5)).foregroundColor(Theme.muted).italic()
            }
            if let z = p.exampleZh, !z.isEmpty {
                Text(z).font(.system(size: 12.5)).foregroundColor(Theme.muted.opacity(0.85))
            }
            if let n = p.note, !n.isEmpty {
                Text(n)
                    .font(.system(size: 12.5)).foregroundColor(Theme.primaryDark)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.primaryLight)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func load() async {
        if let d = try? await API.shared.colloquial() {
            phrases = d.phrases
            categories = d.categories
        }
        loading = false
    }
}

// MARK: - 作文批改

struct EssayView: View {
    @EnvironmentObject var app: AppState

    @State private var text = ""
    @State private var mode = "english"          // english = 按考试标准评分
    @State private var examType = "CET-4"
    @State private var result: EssayResult?
    @State private var busy = false
    @State private var error: String?

    private let exams = ["CET-4", "CET-6", "考研", "雅思", "托福", "高考", "其他"]

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: "作文批改") { app.route = .home }
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if result == nil { editor } else { report(result!) }
                }
                .padding(.horizontal, 16).padding(.vertical, 16)
            }
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea())
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("按考试标准评分")
                .font(.system(size: 13, weight: .bold)).foregroundColor(Theme.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(exams, id: \.self) { e in
                        Button { examType = e } label: {
                            Text(e)
                                .font(.system(size: 13, weight: examType == e ? .bold : .medium))
                                .foregroundColor(examType == e ? .white : Theme.text)
                                .padding(.horizontal, 13).padding(.vertical, 7)
                                .background(examType == e ? Theme.primary : Color.white)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            TextEditor(text: $text)
                .font(.system(size: 15))
                .frame(minHeight: 240)
                .padding(8)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("把作文粘贴或输入到这里…")
                            .font(.system(size: 15)).foregroundColor(Theme.muted)
                            .padding(.horizontal, 13).padding(.vertical, 16)
                            .allowsHitTesting(false)
                    }
                }

            HStack {
                Text("\(text.count) / 3000")
                    .font(.system(size: 12))
                    .foregroundColor(text.count > 3000 ? Theme.danger : Theme.muted)
                Spacer()
            }

            if let error {
                Text(error).font(.system(size: 13.5)).foregroundColor(Theme.danger)
            }

            Button(busy ? "批改中…（可能要十几秒）" : "开始批改") {
                Task { await submit() }
            }
            .buttonStyle(PrimaryButtonStyle(enabled: canSubmit))
            .disabled(!canSubmit)
        }
    }

    private var canSubmit: Bool {
        !busy && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.count <= 3000
    }

    private func report(_ r: EssayResult) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let s = r.scoreEstimate, !s.isEmpty {
                VStack(spacing: 4) {
                    Text(s).font(.system(size: 19, weight: .heavy)).foregroundColor(.white)
                    if !r.estimatedLevel.isEmpty {
                        Text(r.estimatedLevel)
                            .font(.system(size: 13)).foregroundColor(.white.opacity(0.85))
                            .multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(18)
                .background(Theme.brandGradient)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }

            if let rb = r.rubric {
                block("分项点评") {
                    line("内容", rb.content)
                    line("结构", rb.organization)
                    line("语言", rb.language)
                }
            }

            if !r.overallComment.isEmpty {
                block("总评") { Text(r.overallComment).font(.system(size: 14)).lineSpacing(4) }
            }

            if !r.corrections.isEmpty {
                block("逐句修改（\(r.corrections.count) 处）") {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(r.corrections) { c in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(c.original)
                                    .font(.system(size: 13.5))
                                    .foregroundColor(Theme.danger)
                                    .strikethrough()
                                Text(c.corrected)
                                    .font(.system(size: 13.5, weight: .semibold))
                                    .foregroundColor(Theme.primaryDark)
                                if !c.explanation.isEmpty {
                                    Text(c.explanation)
                                        .font(.system(size: 12.5)).foregroundColor(Theme.muted)
                                }
                            }
                        }
                    }
                }
            }

            if !r.correctedEssay.isEmpty {
                block("修改后全文") {
                    Text(r.correctedEssay).font(.system(size: 14)).lineSpacing(5)
                }
            }

            Button("再批改一篇") { result = nil; text = "" }
                .buttonStyle(OutlineButtonStyle())
                .frame(maxWidth: .infinity)
        }
    }

    private func line(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.system(size: 12, weight: .bold)).foregroundColor(Theme.primaryDark)
            Text(v).font(.system(size: 13.5)).lineSpacing(3)
        }
    }

    @ViewBuilder
    private func block<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.system(size: 14, weight: .bold))
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func submit() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            result = try await API.shared.checkEssay(text: text, mode: mode, examType: examType)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - 错题本

struct MistakesView: View {
    @EnvironmentObject var app: AppState

    @State private var mistakes: [Mistake] = []
    @State private var stats: MistakeStatsBlock?
    @State private var loading = true
    @State private var adding = false
    @State private var draft = ""
    @State private var busy = false
    @State private var error: String?
    @State private var expanded: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            // NavHeader 的 trailing 是 AnyView? 不是 ViewBuilder 闭包，
            // 所以不能写成第二个尾随闭包，得自己包一层 AnyView
            NavHeader(title: "错题本", trailing: AnyView(
                Button { adding.toggle() } label: {
                    Image(systemName: adding ? "xmark" : "plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Theme.primary)
                        .frame(width: 44, height: 44)
                }
            )) {
                app.route = .home
            }
            Divider()

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 12) {
                        if adding { addBox }
                        if let s = stats, s.total > 0 { statsBar(s) }
                        if mistakes.isEmpty && !adding {
                            emptyHint.padding(.top, 50)
                        }
                        ForEach(mistakes) { card($0) }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                }
            }
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea())
        .task { await load() }
    }

    private var emptyHint: some View {
        VStack(spacing: 8) {
            Text("📝").font(.system(size: 40))
            Text("还没有错题").font(.system(size: 15)).foregroundColor(Theme.muted)
            Text("点右上角 + 把做错的题录进来，AI 会讲清楚错在哪")
                .font(.system(size: 13)).foregroundColor(Theme.muted.opacity(0.8))
                .multilineTextAlignment(.center).padding(.horizontal, 40)
        }
    }

    private func statsBar(_ s: MistakeStatsBlock) -> some View {
        HStack(spacing: 0) {
            stat("共收录", "\(s.total)")
            Divider().frame(height: 28)
            stat("已掌握", "\(s.mastered)")
            Divider().frame(height: 28)
            stat("待复习", "\(max(0, s.total - s.mastered))")
        }
        .padding(.vertical, 12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func stat(_ k: String, _ v: String) -> some View {
        VStack(spacing: 2) {
            Text(v).font(.system(size: 19, weight: .heavy)).foregroundColor(Theme.primary)
            Text(k).font(.system(size: 11)).foregroundColor(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }

    private var addBox: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("把题目连同你的答案一起贴进来")
                .font(.system(size: 13, weight: .bold)).foregroundColor(Theme.muted)
            TextEditor(text: $draft)
                .font(.system(size: 15))
                .frame(minHeight: 120)
                .padding(6)
                .background(Color(white: 0.97))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            if let error {
                Text(error).font(.system(size: 13)).foregroundColor(Theme.danger)
            }
            Button(busy ? "分析中…" : "让 AI 分析") { Task { await add() } }
                .buttonStyle(PrimaryButtonStyle(enabled: !busy && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                .disabled(busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func card(_ m: Mistake) -> some View {
        let open = expanded.contains(m.id)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(m.category)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Theme.primaryDark)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Theme.primaryLight).clipShape(Capsule())
                if let e = m.examType, !e.isEmpty {
                    Text(e).font(.system(size: 10)).foregroundColor(Theme.muted)
                }
                Spacer()
                Button {
                    Task { await remove(m) }
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 12)).foregroundColor(Theme.muted)
                        .frame(width: 30, height: 30)
                }
            }
            Text(m.questionText)
                .font(.system(size: 14))
                .lineLimit(open ? nil : 3)

            if open {
                if let ua = m.userAnswer, !ua.isEmpty {
                    labeled("你的答案", ua, color: Theme.danger)
                }
                labeled("正确答案", m.correctAnswer, color: Theme.primaryDark)
                if !m.explanation.isEmpty {
                    Text(m.explanation)
                        .font(.system(size: 13)).foregroundColor(Theme.muted).lineSpacing(3)
                }
            }

            Button(open ? "收起" : "看解析") {
                if open { expanded.remove(m.id) } else { expanded.insert(m.id) }
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundColor(Theme.primary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func labeled(_ k: String, _ v: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(k + "：").font(.system(size: 13, weight: .bold)).foregroundColor(Theme.muted)
            Text(v).font(.system(size: 13, weight: .semibold)).foregroundColor(color)
        }
    }

    private func load() async {
        if let d = try? await API.shared.mistakes() {
            mistakes = d.mistakes
            stats = d.stats
        }
        loading = false
    }

    private func add() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            _ = try await API.shared.addMistake(text: draft, examType: nil)
            draft = ""
            adding = false
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ m: Mistake) async {
        // 先从界面上拿掉，请求失败再拉回来——删除等半秒才消失很别扭
        let backup = mistakes
        mistakes.removeAll { $0.id == m.id }
        do {
            try await API.shared.deleteMistake(m.id)
            await load()
        } catch {
            mistakes = backup
            app.showToast(error.localizedDescription)
        }
    }
}

// MARK: - 我的

struct ProfileView: View {
    @EnvironmentObject var app: AppState

    @State private var metrics: Metrics?
    @State private var languages: [LanguageOption] = []
    @State private var nickname = ""
    @State private var targetLang = "en"
    @State private var saving = false
    @State private var showSignOut = false

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: "我的") { app.route = .home }
            Divider()
            ScrollView {
                VStack(spacing: 14) {
                    header
                    if let m = metrics { statsGrid(m) }
                    settings
                    Button("退出登录") { showSignOut = true }
                        .font(.system(size: 15))
                        .foregroundColor(Theme.danger)
                        .padding(.top, 6)
                }
                .padding(.horizontal, 16).padding(.vertical, 16)
            }
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea())
        .confirmationDialog("确定退出登录？", isPresented: $showSignOut, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) { Task { await app.signOut() } }
            Button("取消", role: .cancel) {}
        }
        .task { await load() }
    }

    private var header: some View {
        VStack(spacing: 8) {
            Text(app.user?.displayName.first.map(String.init) ?? "我")
                .font(.system(size: 26, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 68, height: 68)
                .background(Theme.brandGradient)
                .clipShape(Circle())
            Text(app.user?.displayName ?? "")
                .font(.system(size: 18, weight: .bold))
            HStack(spacing: 6) {
                Text(app.user?.isMember == true ? "会员" : "未开通会员")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(app.user?.isMember == true ? Theme.primaryDark : Theme.muted)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(app.user?.isMember == true ? Theme.primaryLight : Color(white: 0.93))
                    .clipShape(Capsule())
                Text(app.user?.levelText ?? "初级")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(Theme.primaryDark)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Theme.primaryLight).clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func statsGrid(_ m: Metrics) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            statCard("🔥", "\(m.streakDays)", "连续学习天数")
            statCard("✅", "\(m.vocab.known)", "已掌握单词")
            statCard("📝", "\(m.mistakes.total)", "错题收录")
            statCard("💬", "\(m.chatCount)", "AI 对话次数")
        }
    }

    private func statCard(_ icon: String, _ value: String, _ label: String) -> some View {
        VStack(spacing: 3) {
            Text(icon).font(.system(size: 20))
            Text(value).font(.system(size: 20, weight: .heavy)).foregroundColor(Theme.primary)
            Text(label).font(.system(size: 11)).foregroundColor(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("设置").font(.system(size: 14, weight: .bold))

            VStack(alignment: .leading, spacing: 6) {
                Text("昵称").font(.system(size: 12)).foregroundColor(Theme.muted)
                TextField("", text: $nickname).fieldStyle()
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("目标语言").font(.system(size: 12)).foregroundColor(Theme.muted)
                Menu {
                    ForEach(languages) { l in
                        Button(l.name) { targetLang = l.code }
                    }
                } label: {
                    HStack {
                        Text(languages.first { $0.code == targetLang }?.name ?? targetLang)
                            .font(.system(size: 15)).foregroundColor(Theme.text)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .bold)).foregroundColor(Theme.muted)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 13)
                    .background(Color(white: 0.97))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }

            Button(saving ? "保存中…" : "保存") { Task { await save() } }
                .buttonStyle(PrimaryButtonStyle(enabled: !saving))
                .disabled(saving)

            Button("重新测评水平") { app.route = .placementIntro }
                .buttonStyle(OutlineButtonStyle())
                .frame(maxWidth: .infinity)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func load() async {
        nickname = app.user?.nickname ?? ""
        targetLang = app.user?.targetLang ?? "en"
        async let mTask = API.shared.metrics()
        async let lTask = API.shared.languages()
        metrics = try? await mTask
        languages = (try? await lTask) ?? []
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let u = try await API.shared.updateProfile(
                nickname: nickname, level: nil, targetLang: targetLang)
            app.user = u
            app.showToast("已保存")
        } catch {
            app.showToast(error.localizedDescription)
        }
    }
}
