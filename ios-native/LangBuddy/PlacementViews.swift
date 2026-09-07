import SwiftUI

// MARK: - 测评说明

struct PlacementIntroView: View {
    @EnvironmentObject var app: AppState

    var count: Int { app.placement?.questionCount ?? 15 }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Text("📝").font(.system(size: 54)).padding(.bottom, 14)
            Text("先测一下你的英语水平").font(.system(size: 22, weight: .bold))

            VStack(alignment: .leading, spacing: 0) {
                bullet("\(count) 道题，约 2 分钟")
                bullet("从简单到难，不会的直接跳过")
                bullet("结果决定 AI 跟你说话的难度")
            }
            .padding(.vertical, 18)

            Text("随时可以在「我的」里重测。")
                .font(.system(size: 14)).foregroundColor(Theme.muted)
            Spacer()

            VStack(spacing: 8) {
                Button("开始测评") { app.route = .placement }
                    .buttonStyle(PrimaryButtonStyle())
                Button("先跳过") { app.route = .home }
                    .font(.system(size: 15)).foregroundColor(Theme.muted).padding(.vertical, 8)
            }
            .padding(.horizontal, 22).padding(.bottom, 16)
        }
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("✓").font(.system(size: 15, weight: .heavy)).foregroundColor(Theme.primary)
            Text(text).font(.system(size: 15)).foregroundColor(Theme.text)
        }
        .padding(.vertical, 9)
    }
}

// MARK: - 答题

struct PlacementTestView: View {
    @EnvironmentObject var app: AppState
    @State private var questions: [PlacementQuestion] = []
    @State private var answers: [String: Int] = [:]
    @State private var index = 0
    @State private var loading = true
    @State private var submitting = false
    @State private var picked: Int?

    private var current: PlacementQuestion? {
        questions.indices.contains(index) ? questions[index] : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    if index > 0 { index -= 1; picked = answers[current?.id ?? ""] }
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .frame(width: 44, height: 44)
                        .opacity(index == 0 ? 0 : 1)
                }
                .disabled(index == 0)
                Spacer()
                Text("\(index + 1) / \(max(questions.count, 1))")
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                Button("跳过") { next() }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.muted)
                    .frame(width: 44, height: 44)
            }
            .padding(.horizontal, 6)

            // 进度条
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(Theme.border)
                    Rectangle().fill(Theme.primary)
                        .frame(width: geo.size.width * progress)
                        .animation(.easeOut(duration: 0.25), value: progress)
                }
            }
            .frame(height: 4)

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else if let q = current {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(q.tierLabel)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Theme.muted)
                            .padding(.bottom, 10)
                        Text(q.question)
                            .font(.system(size: 21, weight: .bold))
                            .lineSpacing(4)
                            .padding(.bottom, 24)

                        VStack(spacing: 10) {
                            ForEach(Array(q.options.enumerated()), id: \.offset) { i, opt in
                                Button {
                                    choose(i, for: q)
                                } label: {
                                    Text(opt)
                                        .font(.system(size: 16, weight: picked == i ? .semibold : .regular))
                                        .foregroundColor(Theme.text)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, 18).padding(.vertical, 16)
                                        .background(picked == i ? Theme.primaryLight : Color.white)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                                .stroke(picked == i ? Theme.primary : Theme.border, lineWidth: 1.5)
                                        )
                                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, 22).padding(.top, 20)
                }
            } else {
                Spacer()
                Text("题目加载失败").foregroundColor(Theme.muted)
                Spacer()
            }
        }
        .overlay { if submitting { LoadingOverlay() } }
        .task { await load() }
    }

    private var progress: CGFloat {
        guard questions.count > 0 else { return 0 }
        return CGFloat(index) / CGFloat(questions.count)
    }

    private func load() async {
        do {
            questions = try await API.shared.placementQuestions()
        } catch {
            app.showToast(error.localizedDescription)
        }
        loading = false
    }

    private func choose(_ i: Int, for q: PlacementQuestion) {
        answers[q.id] = i
        picked = i
        // 选完稍作停顿再翻页：立刻切走会让人怀疑自己有没有点中
        Task {
            try? await Task.sleep(nanoseconds: 200_000_000)
            next()
        }
    }

    private func next() {
        if index < questions.count - 1 {
            index += 1
            picked = answers[current?.id ?? ""]
        } else {
            Task { await submit() }
        }
    }

    private func submit() async {
        submitting = true
        defer { submitting = false }
        do {
            let r = try await API.shared.submitPlacement(answers: answers)
            app.finishPlacement(r)
        } catch {
            app.showToast(error.localizedDescription)
        }
    }
}

// MARK: - 结果

struct PlacementResultView: View {
    @EnvironmentObject var app: AppState
    let result: PlacementResult

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 4) {
                Text(result.cefr)
                    .font(.system(size: 40, weight: .heavy))
                    .foregroundColor(Theme.primary)
                Text("CEFR")
                    .font(.system(size: 11, weight: .semibold))
                    .kerning(1.4)
                    .foregroundColor(Theme.muted)
            }
            .frame(width: 132, height: 132)
            .overlay(Circle().stroke(Theme.primary, lineWidth: 5))
            .shadow(color: Theme.primary.opacity(0.2), radius: 17, y: 12)
            .padding(.bottom, 20)

            Text(result.levelText).font(.system(size: 22, weight: .bold))
            Text("答对 \(result.correct) / \(result.total) 题")
                .font(.system(size: 14)).foregroundColor(Theme.muted)
                .padding(.top, 4)
            Text(result.advice)
                .font(.system(size: 14.5))
                .foregroundColor(Theme.muted)
                .multilineTextAlignment(.center)
                .lineSpacing(5)
                .padding(.horizontal, 40).padding(.top, 14)
            Spacer()

            Button("开始学习") { app.route = .home }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 22).padding(.bottom, 16)
        }
    }
}

struct LoadingOverlay: View {
    var body: some View {
        ZStack {
            Color.white.opacity(0.6).ignoresSafeArea()
            ProgressView().scaleEffect(1.2)
        }
    }
}
