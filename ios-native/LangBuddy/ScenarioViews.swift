import SwiftUI

/// 今日练习计划。把"随便聊"变成"今天练这三个场景"，
/// 每天换一批、当天刷新不变。
struct ScenarioPlanView: View {
    @EnvironmentObject var app: AppState
    @State private var plan: DailyPlan?
    @State private var all: [Scenario] = []
    @State private var loading = true
    @State private var showAll = false

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: "情景练习") { app.route = .home }
            Divider()

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if let p = plan { todaySection(p) }
                        allSection
                    }
                    .padding(.horizontal, 18).padding(.vertical, 18)
                }
            }
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea())
        .task { await load() }
    }

    private func todaySection(_ p: DailyPlan) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("今日计划").font(.system(size: 18, weight: .bold))
                Spacer()
                Text("\(p.doneToday) / \(p.total) 已完成")
                    .font(.system(size: 13))
                    .foregroundColor(p.doneToday >= p.total ? Theme.primary : Theme.muted)
            }

            // 进度条比数字更直观，一眼知道今天还剩多少
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.border)
                    Capsule().fill(Theme.primary)
                        .frame(width: geo.size.width * CGFloat(p.total > 0
                            ? Double(p.doneToday) / Double(p.total) : 0))
                }
            }
            .frame(height: 6)

            ForEach(p.plan) { s in card(s, big: true) }
        }
    }

    private var allSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { showAll.toggle() }
            } label: {
                HStack {
                    Text("全部场景（\(all.count)）").font(.system(size: 16, weight: .bold))
                        .foregroundColor(Theme.text)
                    Spacer()
                    Image(systemName: showAll ? "chevron.up" : "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Theme.muted)
                }
            }
            .buttonStyle(.plain)
            .padding(.top, 6)

            if showAll {
                ForEach(all) { s in card(s, big: false) }
            }
        }
    }

    private func card(_ s: Scenario, big: Bool) -> some View {
        Button {
            app.route = .scenarioBrief(s.id)
        } label: {
            HStack(spacing: 12) {
                Text(s.emoji).font(.system(size: big ? 28 : 22))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(s.title)
                            .font(.system(size: big ? 16 : 15, weight: .semibold))
                            .foregroundColor(Theme.text)
                        Text(s.levelText)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(Theme.primaryDark)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Theme.primaryLight)
                            .clipShape(Capsule())
                    }
                    Text(s.brief)
                        .font(.system(size: 13))
                        .foregroundColor(Theme.muted)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 4)
                if s.doneToday == true {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(Theme.primary)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Theme.muted)
                }
            }
            .padding(big ? 16 : 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        // 两个请求并发发出，别串着等——这一屏一进来就要有东西看
        async let planTask = API.shared.dailyPlan()
        async let listTask = API.shared.scenarioList()
        plan = try? await planTask
        all = (try? await listTask) ?? []
        loading = false
    }
}

/// 场景开始前的说明页。先讲清"你是谁、要做成什么、可以用哪些说法"，
/// 学生才知道自己在练什么，而不是被 AI 一句英文问懵。
struct ScenarioBriefView: View {
    @EnvironmentObject var app: AppState
    let scenarioId: String

    @State private var scenario: Scenario?
    @State private var loading = true

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: "开始前") { app.route = .scenarios }
            Divider()

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else if let s = scenario {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(spacing: 12) {
                            Text(s.emoji).font(.system(size: 40))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(s.title).font(.system(size: 20, weight: .bold))
                                Text(s.levelText + " · " + s.category)
                                    .font(.system(size: 13)).foregroundColor(Theme.muted)
                            }
                        }

                        if let setting = s.setting {
                            block("情景", setting)
                        }
                        if let role = s.aiRole {
                            block("对面是谁", role)
                        }
                        if let goal = s.goal {
                            block("这次要做到", goal)
                        }
                        if let ps = s.keyPhrases, !ps.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("可能用得上").font(.system(size: 13, weight: .bold))
                                    .foregroundColor(Theme.primaryDark)
                                ForEach(ps, id: \.self) { p in
                                    Text("· " + p).font(.system(size: 14.5))
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background(Theme.primaryLight)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 18)
                }
            } else {
                Spacer(); Text("场景加载失败").foregroundColor(Theme.muted); Spacer()
            }

            if let s = scenario {
                Button("开始练习") {
                    app.route = .chat(s)
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 20).padding(.bottom, 16)
            }
        }
        .background(Color(red: 0.97, green: 0.97, blue: 0.98).ignoresSafeArea())
        .task {
            scenario = try? await API.shared.scenario(scenarioId)
            loading = false
        }
    }

    private func block(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 13, weight: .bold)).foregroundColor(Theme.primaryDark)
            Text(body).font(.system(size: 15)).lineSpacing(4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
