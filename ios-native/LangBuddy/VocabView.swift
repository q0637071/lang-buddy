import SwiftUI

/// 背单词。卡片正面只给单词，点一下翻到背面看释义，再按四个评价之一。
/// 间隔安排（SM-2）全在后端算，这里只负责把结果画出来。
struct VocabView: View {
    @EnvironmentObject var app: AppState

    @State private var words: [VocabWord] = []
    @State private var stats: VocabStats?
    @State private var index = 0
    @State private var flipped = false
    @State private var loading = true
    @State private var busy = false

    private var current: VocabWord? {
        words.indices.contains(index) ? words[index] : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else if let w = current {
                card(w)
                ratingBar(w)
            } else {
                finished
            }
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea())
        .task { await load() }
    }

    // MARK: - 顶部

    private var header: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button { app.route = .home } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .frame(width: 44, height: 44)
                }
                Spacer()
                Text(current == nil ? "今日单词" : "\(index + 1) / \(words.count)")
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                Button {
                    Task { await markKnown() }
                } label: {
                    Text("已掌握")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(current == nil ? .clear : Theme.muted)
                        .frame(width: 56, height: 44)
                }
                .disabled(current == nil || busy)
            }
            .padding(.horizontal, 6)

            if let s = stats {
                HStack(spacing: 14) {
                    statChip("已掌握", s.known, Theme.primary)
                    statChip("学习中", s.learning, .orange)
                    statChip("未学", s.new, Theme.muted)
                    Spacer()
                }
                .padding(.horizontal, 18).padding(.bottom, 10)
            }
            Divider()
        }
        .background(Color.white)
    }

    private func statChip(_ label: String, _ n: Int, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text("\(label) \(n)").font(.system(size: 12)).foregroundColor(Theme.muted)
        }
    }

    // MARK: - 卡片

    private func card(_ w: VocabWord) -> some View {
        ZStack {
            if flipped {
                back(w)
                    // 背面要再翻 180°，否则内容是镜像的
                    .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
            } else {
                front(w)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(20)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.06), radius: 14, y: 6)
        .padding(.horizontal, 20).padding(.vertical, 18)
        .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .animation(.spring(response: 0.45, dampingFraction: 0.82), value: flipped)
        .onTapGesture { flipped.toggle() }
    }

    private func front(_ w: VocabWord) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Text(w.word)
                .font(.system(size: 40, weight: .bold))
                .multilineTextAlignment(.center)
            if let pos = w.pos, !pos.isEmpty {
                Text(pos).font(.system(size: 15)).foregroundColor(Theme.muted)
            }
            Spacer()
            Text("点一下看释义")
                .font(.system(size: 13)).foregroundColor(Theme.muted.opacity(0.7))
        }
    }

    private func back(_ w: VocabWord) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(w.word).font(.system(size: 26, weight: .bold))
                if let pos = w.pos, !pos.isEmpty {
                    Text(pos).font(.system(size: 14)).foregroundColor(Theme.muted).padding(.top, 2)
                }

                Text(w.meaning_zh ?? "")
                    .font(.system(size: 20, weight: .semibold))
                    .padding(.top, 14)

                // 词根词缀是这个功能的差异点，单独用色块突出。
                // 有词根的词才给"关联星球"入口——没词根点进去也是空的。
                if let line = w.rootLine {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top, spacing: 6) {
                            Text("🔍").font(.system(size: 13))
                            Text(line).font(.system(size: 14)).foregroundColor(Theme.primaryDark)
                        }
                        if let r = w.root, !r.isEmpty {
                            Button {
                                app.route = .orbit(w.word)
                            } label: {
                                HStack(spacing: 4) {
                                    Text("🪐").font(.system(size: 12))
                                    Text("看同词根的词").font(.system(size: 13, weight: .semibold))
                                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold))
                                }
                                .foregroundColor(Theme.primaryDark)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.primaryLight)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.top, 14)
                }

                if let en = w.example_en, !en.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(en).font(.system(size: 15)).foregroundColor(Theme.text)
                        if let zh = w.example_zh, !zh.isEmpty {
                            Text(zh).font(.system(size: 14)).foregroundColor(Theme.muted)
                        }
                    }
                    .padding(.top, 16)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - 评价

    private let ratings: [(key: String, label: String, color: Color)] = [
        ("again", "忘了", Color(red: 0.86, green: 0.24, blue: 0.24)),
        ("hard", "困难", .orange),
        ("good", "记得", Theme.primary),
        ("easy", "简单", Color(red: 0.13, green: 0.64, blue: 0.35)),
    ]

    private func ratingBar(_ w: VocabWord) -> some View {
        VStack(spacing: 8) {
            if !flipped {
                Button("显示释义") { flipped = true }
                    .buttonStyle(PrimaryButtonStyle())
            } else {
                HStack(spacing: 8) {
                    ForEach(ratings, id: \.key) { r in
                        Button {
                            Task { await rate(w, r.key) }
                        } label: {
                            VStack(spacing: 3) {
                                Text(r.label).font(.system(size: 15, weight: .semibold))
                                // 预计下次什么时候再见到这个词，让评价有依据
                                Text(w.previews?.text(for: r.key) ?? "")
                                    .font(.system(size: 11))
                                    .opacity(0.85)
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .background(r.color)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .disabled(busy)
                    }
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
    }

    private var finished: some View {
        VStack(spacing: 12) {
            Spacer()
            Text("🎉").font(.system(size: 54))
            Text("今天的单词复习完了").font(.system(size: 20, weight: .bold))
            if let s = stats {
                Text("已掌握 \(s.known) 词 · 学习中 \(s.learning) 词")
                    .font(.system(size: 14)).foregroundColor(Theme.muted)
            }
            Spacer()
            Button("回首页") { app.route = .home }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 20).padding(.bottom, 16)
        }
    }

    // MARK: - 数据

    private func load() async {
        do {
            let q = try await API.shared.vocabQueue()
            words = q.words
            stats = q.stats
        } catch {
            app.showToast(error.localizedDescription)
        }
        loading = false
    }

    private func rate(_ w: VocabWord, _ rating: String) async {
        busy = true
        defer { busy = false }
        do {
            try await API.shared.reviewWord(w.word, rating: rating)
            advance()
        } catch {
            app.showToast(error.localizedDescription)
        }
    }

    private func markKnown() async {
        guard let w = current else { return }
        busy = true
        defer { busy = false }
        do {
            try await API.shared.skipWord(w.word)
            advance()
        } catch {
            app.showToast(error.localizedDescription)
        }
    }

    /// 翻到下一张前先把卡片翻回正面，否则下一个词会直接露出答案
    private func advance() {
        flipped = false
        index += 1
    }
}
