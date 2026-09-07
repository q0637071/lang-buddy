import SwiftUI

// MARK: - 课程列表

struct GrammarListView: View {
    @EnvironmentObject var app: AppState
    @State private var lessons: [GrammarSummary] = []
    @State private var loading = true

    /// 按难度分组，和网站保持一致的三档
    private let groups: [(key: String, label: String, desc: String)] = [
        ("basic", "基础", "零基础到能说完整句子"),
        ("intermediate", "进阶", "时态、语态、非谓语"),
        ("advanced", "高级", "各类从句与复杂句式"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: "语法精讲") { app.route = .home }
            Divider()

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else if lessons.isEmpty {
                Spacer()
                Text("暂时没有课程").foregroundColor(Theme.muted)
                Spacer()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        ForEach(groups, id: \.key) { g in
                            let items = lessons.filter { $0.levelKey == g.key }
                            if !items.isEmpty {
                                section(g, items)
                            }
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 18)
                }
            }
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea())
        .task { await load() }
    }

    private func section(_ g: (key: String, label: String, desc: String),
                         _ items: [GrammarSummary]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(g.label)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Theme.primary)
                    .clipShape(Capsule())
                Text(g.desc).font(.system(size: 12)).foregroundColor(Theme.muted)
                Spacer()
                Text("\(items.count) 课").font(.system(size: 12)).foregroundColor(Theme.muted)
            }

            VStack(spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.element.id) { i, l in
                    Button {
                        app.route = .grammarDetail(l.id)
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Text("\(i + 1)")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(Theme.primaryDark)
                                .frame(width: 26, height: 26)
                                .background(Theme.primaryLight)
                                .clipShape(Circle())
                            VStack(alignment: .leading, spacing: 3) {
                                Text(l.title)
                                    .font(.system(size: 15.5, weight: .semibold))
                                    .foregroundColor(Theme.text)
                                    .multilineTextAlignment(.leading)
                                Text(l.summary)
                                    .font(.system(size: 13))
                                    .foregroundColor(Theme.muted)
                                    .multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Theme.muted)
                                .padding(.top, 4)
                        }
                        .padding(14)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func load() async {
        do { lessons = try await API.shared.grammarList() }
        catch { app.showToast(error.localizedDescription) }
        loading = false
    }
}

// MARK: - 课程详情

struct GrammarDetailView: View {
    @EnvironmentObject var app: AppState
    let lessonId: String

    @State private var lesson: GrammarLesson?
    @State private var loading = true
    @State private var picked: [String: Int] = [:]     // 题目 -> 选了第几个
    @State private var sentence = ""
    @State private var checkResult: String?
    @State private var checking = false

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: lesson?.title ?? "语法精讲") { app.route = .grammar }
            Divider()

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else if let l = lesson {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(l.summary).font(.system(size: 15)).foregroundColor(Theme.muted)

                        if let s = l.structure, !s.isEmpty {
                            block("句型结构") {
                                Text(s).font(.system(size: 15, weight: .medium))
                            }
                        }
                        if let e = l.explanation, !e.isEmpty {
                            block("讲解") {
                                Text(e).font(.system(size: 15)).lineSpacing(5)
                            }
                        }
                        if let examples = l.examples, !examples.isEmpty {
                            block("例句") {
                                VStack(alignment: .leading, spacing: 12) {
                                    ForEach(examples) { ex in
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(ex.en).font(.system(size: 15))
                                            Text(ex.zh).font(.system(size: 13.5)).foregroundColor(Theme.muted)
                                        }
                                    }
                                }
                            }
                        }
                        // 老课程数据里没有 mistakes 字段，为空就整块不显示
                        if let mistakes = l.mistakes, !mistakes.isEmpty {
                            block("⚠️ 中国学生常见错误") {
                                VStack(alignment: .leading, spacing: 14) {
                                    ForEach(mistakes) { m in
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("❌ " + m.wrong).font(.system(size: 14.5))
                                                .foregroundColor(Theme.danger)
                                            Text("✅ " + m.right).font(.system(size: 14.5))
                                                .foregroundColor(Color(red: 0.13, green: 0.64, blue: 0.35))
                                            Text(m.why).font(.system(size: 13)).foregroundColor(Theme.muted)
                                        }
                                    }
                                }
                            }
                        }
                        if let practice = l.practice, !practice.isEmpty {
                            block("练习") {
                                VStack(alignment: .leading, spacing: 18) {
                                    ForEach(Array(practice.enumerated()), id: \.element.id) { i, p in
                                        practiceItem(i, p)
                                    }
                                }
                            }
                        }
                        checkerBlock
                    }
                    .padding(.horizontal, 18).padding(.vertical, 18)
                }
            } else {
                Spacer(); Text("课程加载失败").foregroundColor(Theme.muted); Spacer()
            }
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea())
        .task { await load() }
    }

    @ViewBuilder
    private func block<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 13, weight: .bold)).foregroundColor(Theme.primaryDark)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func practiceItem(_ i: Int, _ p: GrammarPractice) -> some View {
        let chosen = picked[p.id]
        return VStack(alignment: .leading, spacing: 8) {
            Text("\(i + 1). \(p.question)").font(.system(size: 15, weight: .medium))
            ForEach(Array(p.options.enumerated()), id: \.offset) { oi, opt in
                Button {
                    if chosen == nil { picked[p.id] = oi }   // 选过就不让改，避免反复试出答案
                } label: {
                    HStack {
                        Text(opt).font(.system(size: 15))
                        Spacer()
                        if chosen != nil && oi == p.answerIndex {
                            Image(systemName: "checkmark").foregroundColor(.white)
                        } else if chosen == oi {
                            Image(systemName: "xmark").foregroundColor(.white)
                        }
                    }
                    .foregroundColor(optionTextColor(chosen: chosen, index: oi, answer: p.answerIndex))
                    .padding(.horizontal, 13).padding(.vertical, 11)
                    .background(optionBg(chosen: chosen, index: oi, answer: p.answerIndex))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Theme.border, lineWidth: chosen == nil ? 1 : 0)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            if chosen != nil, let ex = p.explanation, !ex.isEmpty {
                Text(ex).font(.system(size: 13)).foregroundColor(Theme.muted).padding(.top, 2)
            }
        }
    }

    private func optionBg(chosen: Int?, index: Int, answer: Int) -> Color {
        guard chosen != nil else { return Color.white }
        if index == answer { return Color(red: 0.13, green: 0.64, blue: 0.35) }
        if index == chosen { return Theme.danger }
        return Color.white
    }
    private func optionTextColor(chosen: Int?, index: Int, answer: Int) -> Color {
        guard chosen != nil else { return Theme.text }
        return (index == answer || index == chosen) ? .white : Theme.text
    }

    // AI 批改
    private var checkerBlock: some View {
        block("AI 语法批改") {
            VStack(alignment: .leading, spacing: 10) {
                TextField("写一句你自己的句子，AI 帮你挑错…", text: $sentence, axis: .vertical)
                    .lineLimit(2...5)
                    .font(.system(size: 15))
                    .padding(12)
                    .background(Color(red: 0.96, green: 0.96, blue: 0.98))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                Button(checking ? "批改中…" : "提交批改") { Task { await check() } }
                    .buttonStyle(PrimaryButtonStyle(enabled: canCheck))
                    .disabled(!canCheck)

                if let r = checkResult {
                    Text(r)
                        .font(.system(size: 14.5)).lineSpacing(4)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.primaryLight)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
    }

    private var canCheck: Bool {
        !sentence.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !checking
    }

    private func load() async {
        do { lesson = try await API.shared.grammarLesson(lessonId) }
        catch { app.showToast(error.localizedDescription) }
        loading = false
    }

    private func check() async {
        checking = true
        defer { checking = false }
        do {
            checkResult = try await API.shared.checkGrammar(
                sentence.trimmingCharacters(in: .whitespacesAndNewlines))
        } catch {
            app.showToast(error.localizedDescription)
        }
    }
}
