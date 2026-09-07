import SwiftUI

/// 词根关联星球。同词根的词分布在一个球面上，拖动旋转、点词看释义。
/// 这一屏是原生相对网页优势最明显的地方：真 3D 投影 + 拖拽惯性，网页做不出这个手感。
struct OrbitView: View {
    @EnvironmentObject var app: AppState
    let centerWord: String

    @State private var center: VocabWord?
    @State private var related: [RelatedWord] = []
    @State private var loading = true

    // 球体朝向：yaw 绕 Y 轴，pitch 绕 X 轴
    @State private var yaw: Double = 0
    @State private var pitch: Double = 0
    @State private var dragStart: (yaw: Double, pitch: Double) = (0, 0)
    @State private var spinning = true          // 没人碰的时候自己慢慢转
    @State private var selected: RelatedWord?

    var body: some View {
        VStack(spacing: 0) {
            NavHeader(title: "词根关联") { app.route = .vocab }
            Divider()

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else if related.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Text("🪐").font(.system(size: 44))
                    Text("这个词暂时没有找到关联词")
                        .font(.system(size: 15)).foregroundColor(Theme.muted)
                }
                Spacer()
            } else {
                sphere
                bottomPanel
            }
        }
        .background(Color(red: 0.06, green: 0.07, blue: 0.12).ignoresSafeArea())
        .task { await load() }
        .task { await autoSpin() }
    }

    // MARK: - 球体

    private var sphere: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            let radius = size * 0.36
            let mid = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)

            ZStack {
                // 中心词固定在正中，不参与旋转
                VStack(spacing: 2) {
                    Text(center?.word ?? centerWord)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(.white)
                    if let r = center?.root, !r.isEmpty {
                        Text(r).font(.system(size: 11)).foregroundColor(Theme.accent)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(Theme.primary.opacity(0.9))
                .clipShape(Capsule())
                .position(mid)
                .zIndex(10)

                ForEach(Array(related.enumerated()), id: \.element.id) { i, w in
                    let p = project(index: i, total: related.count, radius: radius)
                    Text(w.word)
                        .font(.system(size: 13 + 3 * p.depth, weight: w.isRoot ? .semibold : .regular))
                        .foregroundColor(w.isRoot ? .white : Color.white.opacity(0.75))
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(
                            Capsule().fill(w.isRoot
                                ? Theme.primary.opacity(0.25 + 0.35 * p.depth)
                                : Color.white.opacity(0.06 + 0.10 * p.depth))
                        )
                        // 越靠后的词越小越淡，做出前后景深
                        .opacity(0.25 + 0.75 * p.depth)
                        .scaleEffect(0.75 + 0.35 * p.depth)
                        .position(x: mid.x + p.x, y: mid.y + p.y)
                        .zIndex(p.depth)
                        .onTapGesture {
                            selected = w
                            spinning = false
                        }
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { v in
                        if spinning { spinning = false; dragStart = (yaw, pitch) }
                        yaw = dragStart.yaw + Double(v.translation.width) * 0.01
                        // 上下限制在 ±60°，转过头球体会翻过来，很难看
                        pitch = max(-1.05, min(1.05, dragStart.pitch - Double(v.translation.height) * 0.01))
                    }
                    .onEnded { _ in dragStart = (yaw, pitch) }
            )
        }
    }

    /// 斐波那契球面分布 + 旋转 + 透视投影。
    /// depth 是归一化到 0...1 的前后位置，1 表示最靠近观察者。
    private func project(index: Int, total: Int, radius: CGFloat)
        -> (x: CGFloat, y: CGFloat, depth: Double) {
        let n = max(total, 2)
        let golden = Double.pi * (3 - 5.0.squareRoot())
        let y0 = 1 - (Double(index) / Double(n - 1)) * 2
        let r0 = max(0, (1 - y0 * y0)).squareRoot()
        let theta = golden * Double(index)
        let x0 = cos(theta) * r0
        let z0 = sin(theta) * r0

        // 绕 Y 轴
        let x1 = x0 * cos(yaw) + z0 * sin(yaw)
        let z1 = -x0 * sin(yaw) + z0 * cos(yaw)
        // 绕 X 轴
        let y2 = y0 * cos(pitch) - z1 * sin(pitch)
        let z2 = y0 * sin(pitch) + z1 * cos(pitch)

        let perspective = 2.4
        let scale = perspective / (perspective - z2)
        return (CGFloat(x1 * scale) * radius,
                CGFloat(y2 * scale) * radius,
                (z2 + 1) / 2)
    }

    private func autoSpin() async {
        // 没人操作时缓慢自转，让球体"活着"；一旦被碰过就不再自动转
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 40_000_000)
            if spinning { yaw += 0.004 }
        }
    }

    // MARK: - 底部释义

    private var bottomPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let w = selected {
                HStack(spacing: 8) {
                    Text(w.word).font(.system(size: 19, weight: .bold)).foregroundColor(.white)
                    if let p = w.pos, !p.isEmpty {
                        Text(p).font(.system(size: 12)).foregroundColor(.white.opacity(0.5))
                    }
                    Spacer()
                    if let via = w.via, !via.isEmpty {
                        Text(w.isRoot ? "词根 \(via)" : "同类 \(via)")
                            .font(.system(size: 11))
                            .foregroundColor(Theme.accent)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Theme.primary.opacity(0.22))
                            .clipShape(Capsule())
                    }
                }
                Text(w.meaning_zh ?? "")
                    .font(.system(size: 15)).foregroundColor(.white.opacity(0.85))
            } else {
                Text("👆 拖动旋转，点任意单词看释义")
                    .font(.system(size: 14)).foregroundColor(.white.opacity(0.45))
                Text("共 \(related.count) 个关联词，实心的是同词根")
                    .font(.system(size: 12)).foregroundColor(.white.opacity(0.3))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 74, alignment: .leading)
        .padding(.horizontal, 20).padding(.vertical, 14)
        .background(Color.white.opacity(0.05))
    }

    private func load() async {
        do {
            let r = try await API.shared.relatedWords(centerWord)
            center = r.center
            related = r.related
        } catch {
            app.showToast(error.localizedDescription)
        }
        loading = false
    }
}
