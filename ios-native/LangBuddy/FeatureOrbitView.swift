import SwiftUI

// 首页的功能星球。所有功能挂在一个可旋转的球面上，转到最前面的那个就是当前选中项，
// 点节点直接进入。和网页版是同一套做法，几个关键取舍也一样（见下面注释）。

/// 球面上的一个功能入口
private struct OrbitFeature: Identifiable {
    let id = UUID()
    let label: String
    let desc: String
    let color: Color
    /// 目标路由；isOrbit 的那个要先跟后端要一个随机词才知道去哪，所以单独标一下
    let route: AppState.Route?
    var isOrbit = false

    /// 这个节点转到正前方时 yaw 应该等于多少。build 时算好，选中判定和"转过去"都用它
    var frontYaw: Double = 0
    var base: SIMD3<Double> = .zero
}

struct FeatureOrbitView: View {
    @EnvironmentObject var app: AppState
    @State private var showSignOut = false
    @State private var pickingOrbit = false

    // 球体朝向
    @State private var yaw: Double = 0
    @State private var pitch: Double = -0.18
    @State private var dragStart: (yaw: Double, pitch: Double) = (0, -0.18)
    @State private var spinSince: Date? = Date()

    /// 自转速度。写成"多少秒一圈"而不是裸弧度——直接写 0.21 rad/s 完全看不出快慢
    private let secondsPerTurn: Double = 30
    private var spinSpeed: Double { .pi * 2 / secondsPerTurn }

    // 半径和焦距的比例。线框球、卫星、功能胶囊三者必须共用同一组值，
    // 否则透视不一致，胶囊看着就是浮在球外面而不是贴在球面上。
    private let radiusRatio: CGFloat = 0.32
    private let focalRatio: Double = 3.2

    @State private var features: [OrbitFeature] = FeatureOrbitView.buildFeatures()

    /// 动画基准时刻。直接用 timeIntervalSinceReferenceDate 会是 7.8e8 这种量级的数，
    /// 乘上速度之后精度白白浪费在高位上，用相对时间干净得多。
    @State private var startedAt = Date()

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height * 0.62)
            // 整屏包在同一个 TimelineView 里：底部面板要跟着球一起变。
            // 之前把面板写成计算属性、里面调 Date()，SwiftUI 不会因为时间流逝重算它，
            // 表现就是球在转、下面的名字却一直不动。
            TimelineView(.animation) { ctx in
                let liveYaw = yaw + autoOffset(at: ctx.date)
                let frontIdx = frontIndex(yaw: liveYaw)
                VStack(spacing: 0) {
                    header
                    stage(side: side, yaw: liveYaw,
                          time: ctx.date.timeIntervalSince(startedAt), frontIdx: frontIdx)
                    panel(features[frontIdx])
                }
            }
        }
        .background(Theme.orbitBackdrop.ignoresSafeArea())
        .confirmationDialog("账号", isPresented: $showSignOut, titleVisibility: .visible) {
            Button("重新测评") { app.route = .placementIntro }
            Button("退出登录", role: .destructive) { Task { await app.signOut() } }
            Button("取消", role: .cancel) {}
        }
    }

    // MARK: - 顶部问候

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("你好，\(app.user?.displayName ?? "同学")")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundColor(.white)
                Text(levelLine)
                    .font(.system(size: 13))
                    .foregroundColor(.white.opacity(0.55))
            }
            Spacer()
            Button { showSignOut = true } label: {
                Text(app.user?.displayName.first.map(String.init) ?? "我")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 40, height: 40)
                    .background(Theme.primary.opacity(0.85))
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    private var levelLine: String {
        let lv = app.user?.levelText ?? "初级"
        if let cefr = app.placement?.cefr, !cefr.isEmpty { return "当前水平：\(lv)（\(cefr)）" }
        return "当前水平：\(lv)"
    }

    // MARK: - 星球

    // 舞台是正方形：球半径按边长算，外围卫星最远绕到 1.24R，
    // 加上自身尺寸约 1.46R，必须 < 0.5 才不会碰到舞台边——0.32 留出了余量。
    private func stage(side: CGFloat, yaw liveYaw: Double, time: Double, frontIdx: Int) -> some View {
        let radius = side * radiusRatio
        let mid = CGPoint(x: side / 2, y: side / 2)

        return ZStack {
            // 线框球 + 卫星 + 轨道线都画在一张 Canvas 上：
            // 几百条线用 SwiftUI 视图去堆会直接掉帧
            Canvas { gc, _ in
                OrbitCanvas.draw(
                    in: gc, center: mid, radius: radius,
                    yaw: liveYaw, pitch: pitch, focalRatio: focalRatio, time: time
                )
            }
            .allowsHitTesting(false)

            ForEach(Array(features.enumerated()), id: \.element.id) { i, f in
                let p = project(f.base, radius: radius, yaw: liveYaw)
                let isFront = i == frontIdx
                pill(f, isFront: isFront)
                    .position(x: mid.x + p.x, y: mid.y + p.y)
                    // 选中项一律不透明、不缩小、压最上层。选中判定按的是方位角，
                    // 它不一定是 z 最深的那个；再跟着深度调透明度就会出现
                    // "当前选中项自己是半透明的、字都看不清"。
                    .opacity(isFront ? 1 : 0.28 + 0.72 * p.depth)
                    .scaleEffect(isFront ? 1 : 0.78 + 0.3 * p.depth)
                    .zIndex(isFront ? 99 : p.depth)
                    .onTapGesture { tap(i, frontIdx: frontIdx) }
            }
        }
        .frame(width: side, height: side)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        // 必须用 simultaneousGesture：普通 .gesture 会把子视图的点击一起吞掉，
        // 表现就是点节点没反应。这个坑在词根星球那边已经踩过一次。
        .simultaneousGesture(
            DragGesture(minimumDistance: 4)
                .onChanged { v in
                    if spinSince != nil { freezeSpin() }
                    yaw = dragStart.yaw + Double(v.translation.width) * 0.009
                    pitch = max(-0.7, min(0.7, dragStart.pitch - Double(v.translation.height) * 0.007))
                }
                .onEnded { _ in
                    dragStart = (yaw, pitch)
                    resumeSpin()      // 松手就接着转，不然拖过一次就永远停在那儿
                }
        )
    }

    private func pill(_ f: OrbitFeature, isFront: Bool) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(f.color)
                .frame(width: 8, height: 8)
                .shadow(color: f.color, radius: 4)
            Text(f.label)
                .font(.system(size: 13.5, weight: isFront ? .bold : .semibold))
                .foregroundColor(isFront ? Theme.text : .white.opacity(0.92))
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(
            Capsule().fill(isFront ? Color.white : Color(red: 0.09, green: 0.12, blue: 0.22).opacity(0.82))
        )
        .overlay(
            Capsule().stroke(isFront ? Color.clear : Color.white.opacity(0.16), lineWidth: 1)
        )
        .shadow(color: isFront ? Theme.primary.opacity(0.45) : .clear, radius: 10)
        // 整个胶囊可点，不然只有文字笔画上才响应
        .contentShape(Capsule())
    }

    // MARK: - 底部面板

    private func panel(_ f: OrbitFeature) -> some View {
        VStack(spacing: 8) {
            Text(f.label)
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(.white)
            Text(f.desc)
                .font(.system(size: 13))
                .foregroundColor(.white.opacity(0.6))
                .multilineTextAlignment(.center)
            Button(pickingOrbit ? "打开中…" : "进入") { enter(f) }
                .buttonStyle(PrimaryButtonStyle(enabled: !pickingOrbit))
                .disabled(pickingOrbit)
                .padding(.top, 2)
            Text("拖动旋转 · 点节点直接进入")
                .font(.system(size: 11))
                .foregroundColor(.white.opacity(0.3))
        }
        .padding(.horizontal, 34)
        .padding(.bottom, 18)
        .frame(maxWidth: .infinity)
    }

    // MARK: - 交互

    private func tap(_ i: Int, frontIdx: Int) {
        let f = features[i]
        if i == frontIdx {
            enter(f)
            return
        }
        // 点的是后排节点：先把它转到正前方，再进去，别瞬移
        freezeSpin()
        withAnimation(.easeInOut(duration: 0.45)) {
            yaw = f.frontYaw
            pitch = max(-0.7, min(0.7, -asin(f.base.y)))
        }
        dragStart = (f.frontYaw, pitch)
        // 等转过去的动画走完再进，别瞬移
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            enter(f)
        }
    }

    private func enter(_ f: OrbitFeature) {
        if f.isOrbit {
            Task { await openOrbit() }
        } else if let r = f.route {
            app.route = r
        } else {
            app.showToast("这个功能正在做，敬请期待")
            resumeSpin()   // 不跳页，得自己把转恢复了
        }
    }

    /// 星球没有固定入口词，先跟后端随机要一个词根够常见的词再进
    private func openOrbit() async {
        pickingOrbit = true
        defer { pickingOrbit = false }
        do {
            let p = try await API.shared.rootPick()
            if let w = p.word, !w.isEmpty {
                app.route = .orbit(word: w, fromHome: true)
            } else {
                app.showToast("词库里暂时没有合适的词根")
            }
        } catch {
            app.showToast(error.localizedDescription)
        }
    }

    // MARK: - 几何

    private func autoOffset(at now: Date) -> Double {
        guard let since = spinSince else { return 0 }
        return now.timeIntervalSince(since) * spinSpeed
    }

    /// 重新开始自转。freezeSpin 已经把之前累计的角度并进 yaw 了，
    /// 这里只要把时钟重新起头，就会从当前朝向接着转。
    private func resumeSpin() {
        spinSince = Date()
    }

    /// 把自转累计的角度并进 yaw 再停下，否则一停就会跳回起始朝向
    private func freezeSpin() {
        if let since = spinSince {
            yaw += Date().timeIntervalSince(since) * spinSpeed
            spinSince = nil
        }
        dragStart = (yaw, pitch)
    }

    /// 选中判定比的是"方位角离正前方多近"，不是"谁的 z 最大"。
    /// 用 z 的话，靠近南北极的节点环半径小（0.77 vs 1.00），z 天然比不过赤道上的——
    /// 网页版实测过：那两个节点只在 3.1° 的窗口里当选，30 秒一圈时只有 0.26 秒，
    /// 转过去根本停不住。按方位角每个节点各占一份，最短也有 3.5 秒。
    private func frontIndex(yaw: Double) -> Int {
        var best = Double.infinity
        var idx = 0
        for (i, f) in features.enumerated() {
            let d = abs(atan2(sin(yaw - f.frontYaw), cos(yaw - f.frontYaw)))
            if d < best { best = d; idx = i }
        }
        return idx
    }

    private func project(_ v: SIMD3<Double>, radius: CGFloat, yaw: Double)
        -> (x: CGFloat, y: CGFloat, depth: Double) {
        let x1 = v.x * cos(yaw) + v.z * sin(yaw)
        let z1 = -v.x * sin(yaw) + v.z * cos(yaw)
        let y2 = v.y * cos(pitch) - z1 * sin(pitch)
        let z2 = v.y * sin(pitch) + z1 * cos(pitch)
        let s = focalRatio / (focalRatio - z2)
        return (CGFloat(x1 * s) * radius, CGFloat(y2 * s) * radius, (z2 + 1) / 2)
    }

    // MARK: - 功能表

    private static func buildFeatures() -> [OrbitFeature] {
        var list: [OrbitFeature] = [
            .init(label: "AI 对话", desc: "打字或按住说话，AI 会朗读回复",
                  color: Theme.primary, route: .chat(nil)),
            .init(label: "情景练习", desc: "每天三个场景，练到能用出来",
                  color: Color(red: 0.24, green: 0.82, blue: 0.60), route: .scenarios),
            .init(label: "面对面", desc: "和 AI 私教视频通话，看得见表情",
                  color: Color(red: 0.13, green: 0.83, blue: 0.93), route: .videoCall),
            .init(label: "今日单词", desc: "按遗忘曲线复习，顺带记词根",
                  color: Color(red: 0.96, green: 0.62, blue: 0.04), route: .vocab),
            .init(label: "语法精讲", desc: "一次讲透一个点，带 AI 批改",
                  color: Color(red: 0.65, green: 0.55, blue: 0.98), route: .grammar),
            .init(label: "词根星球", desc: "顺着词根一次记住一串词",
                  color: Color(red: 0.98, green: 0.45, blue: 0.52), route: nil, isOrbit: true),
        ]

        // 纬度压在 ±0.72 的带子里，不铺满整个球。铺满时靠近南北极的节点
        // 光左右转永远转不到最前面（网页版实测 8 个里只有 6 个可达）。
        // 分子用 (i + 0.5) 而不是 i/(n-1)：后者会让首尾两个点挤在带子边缘。
        let n = Double(list.count)
        let golden = Double.pi * (1 + 5.0.squareRoot())
        for i in list.indices {
            let by = (1 - 2 * (Double(i) + 0.5) / n) * 0.72
            let ring = (1 - by * by).squareRoot()
            let theta = golden * (Double(i) + 0.5)
            list[i].base = SIMD3(ring * cos(theta), by, ring * sin(theta))
            // z1 = ring·sin(theta − yaw)，最大值在 theta − yaw = π/2
            list[i].frontYaw = theta - .pi / 2
        }
        return list
    }
}
