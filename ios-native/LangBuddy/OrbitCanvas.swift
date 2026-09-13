import SwiftUI

/// 功能星球的背景层：线框球 + 外围卫星（小球/三角）+ 轨道线。
/// 全部画在一张 Canvas 上——几百条线用 SwiftUI 视图去堆会直接掉帧。
enum OrbitCanvas {

    // MARK: - 测地球（细分二十面体）

    /// level 1 = 42 顶点 / 120 棱。手机上球本身只有两百多点宽，
    /// 再密就糊成一团了，而且每帧都要重画，没必要上 level 2。
    private static let mesh = icosphere(level: 1)

    private struct Mesh {
        let verts: [SIMD3<Double>]
        let edges: [(Int, Int)]
    }

    private static func icosphere(level: Int) -> Mesh {
        let t = (1 + 5.0.squareRoot()) / 2
        func norm(_ v: SIMD3<Double>) -> SIMD3<Double> {
            let l = (v.x * v.x + v.y * v.y + v.z * v.z).squareRoot()
            return SIMD3(v.x / l, v.y / l, v.z / l)
        }
        var verts: [SIMD3<Double>] = [
            SIMD3(-1, t, 0), SIMD3(1, t, 0), SIMD3(-1, -t, 0), SIMD3(1, -t, 0),
            SIMD3(0, -1, t), SIMD3(0, 1, t), SIMD3(0, -1, -t), SIMD3(0, 1, -t),
            SIMD3(t, 0, -1), SIMD3(t, 0, 1), SIMD3(-t, 0, -1), SIMD3(-t, 0, 1),
        ].map(norm)
        var faces: [(Int, Int, Int)] = [
            (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
            (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
            (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
            (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
        ]

        for _ in 0..<level {
            var cache: [String: Int] = [:]
            var next: [(Int, Int, Int)] = []
            func mid(_ a: Int, _ b: Int) -> Int {
                let key = a < b ? "\(a),\(b)" : "\(b),\(a)"
                if let hit = cache[key] { return hit }
                verts.append(norm((verts[a] + verts[b]) / 2))
                cache[key] = verts.count - 1
                return verts.count - 1
            }
            for f in faces {
                let ab = mid(f.0, f.1), bc = mid(f.1, f.2), ca = mid(f.2, f.0)
                next.append((f.0, ab, ca))
                next.append((f.1, bc, ab))
                next.append((f.2, ca, bc))
                next.append((ab, bc, ca))
            }
            faces = next
        }

        var seen = Set<String>()
        var edges: [(Int, Int)] = []
        for f in faces {
            for (a, b) in [(f.0, f.1), (f.1, f.2), (f.2, f.0)] {
                let key = a < b ? "\(a)-\(b)" : "\(b)-\(a)"
                if seen.insert(key).inserted { edges.append((a, b)) }
            }
        }
        return Mesh(verts: verts, edges: edges)
    }

    // MARK: - 卫星

    private struct Sat {
        let isTriangle: Bool
        let orbitR: Double
        let inc: Double        // 轨道倾角
        let node: Double       // 升交点：让每条轨道朝向都不一样
        let phase: Double
        let speed: Double
        let size: Double       // 占球半径的比例，跟着球一起缩放
        let color: Color
    }

    /// 速度互不成整数倍，否则转几圈之后又会排成一条线
    private static let sats: [Sat] = [
        .init(isTriangle: false, orbitR: 1.10, inc: 0.34, node: 0.0, phase: 0.0, speed: 0.33,
              size: 0.090, color: Color(red: 0.49, green: 0.94, blue: 0.92)),
        .init(isTriangle: false, orbitR: 1.22, inc: -0.52, node: 1.9, phase: 2.1, speed: -0.21,
              size: 0.068, color: Color(red: 0.49, green: 0.83, blue: 0.99)),
        .init(isTriangle: false, orbitR: 1.06, inc: 0.78, node: 3.6, phase: 4.0, speed: 0.27,
              size: 0.052, color: Color(red: 0.65, green: 0.55, blue: 0.98)),
        .init(isTriangle: false, orbitR: 1.24, inc: 0.12, node: 2.7, phase: 1.2, speed: 0.17,
              size: 0.058, color: Color(red: 0.99, green: 0.88, blue: 0.28)),
        .init(isTriangle: true, orbitR: 1.16, inc: -0.30, node: 0.8, phase: 3.1, speed: 0.24,
              size: 0.140, color: Color(red: 0.49, green: 0.94, blue: 0.92)),
        .init(isTriangle: true, orbitR: 1.21, inc: 0.62, node: 4.4, phase: 0.7, speed: -0.19,
              size: 0.120, color: Color(red: 0.73, green: 0.90, blue: 0.99)),
        .init(isTriangle: true, orbitR: 1.13, inc: -0.70, node: 5.5, phase: 5.2, speed: 0.30,
              size: 0.100, color: Color(red: 0.77, green: 0.71, blue: 0.99)),
    ]

    // MARK: - 绘制

    static func draw(in gc: GraphicsContext, center: CGPoint, radius: CGFloat,
                     yaw: Double, pitch: Double, focalRatio: Double, time: Double) {
        let cY = cos(yaw), sY = sin(yaw), cX = cos(pitch), sX = sin(pitch)

        func project(_ v: SIMD3<Double>) -> (p: CGPoint, z: Double, scale: Double) {
            let x1 = v.x * cY + v.z * sY
            let z1 = -v.x * sY + v.z * cY
            let y2 = v.y * cX - z1 * sX
            let z2 = v.y * sX + z1 * cX
            let s = focalRatio / (focalRatio - z2)
            return (CGPoint(x: center.x + CGFloat(x1 * s) * radius,
                            y: center.y + CGFloat(y2 * s) * radius), z2, s)
        }

        // ---- 线框球 ----
        // 按深度分 5 档，每档攒成一条 Path 再描边。逐条 stroke 是 120 次绘制调用，
        // 分档之后只有 5 次，手机上差别很明显。
        let projected = mesh.verts.map(project)
        var buckets = [Path](repeating: Path(), count: 5)
        for (a, b) in mesh.edges {
            let d = (projected[a].z + projected[b].z) / 2
            let k = min(4, max(0, Int((d + 1) / 2 * 5)))
            buckets[k].move(to: projected[a].p)
            buckets[k].addLine(to: projected[b].p)
        }
        for (k, path) in buckets.enumerated() {
            let t = (Double(k) + 0.5) / 5
            gc.stroke(path, with: .color(Theme.primary.opacity(0.05 + t * t * 0.42)), lineWidth: 1)
        }
        // 顶点上的小亮点
        for pr in projected {
            let t = (pr.z + 1) / 2
            let r = 1.1 * (0.55 + t * 0.65)
            gc.fill(Path(ellipseIn: CGRect(x: pr.p.x - r, y: pr.p.y - r, width: r * 2, height: r * 2)),
                    with: .color(Theme.primary.opacity(0.08 + t * t * 0.75)))
        }

        // ---- 卫星 ----
        // 轨道面内的一点 → 世界坐标。轨道线和卫星本体共用，两者必须同一套变换，
        // 否则球会"脱轨"。
        func onOrbit(_ s: Sat, _ a: Double) -> SIMD3<Double> {
            var x = cos(a) * s.orbitR, y = 0.0, z = sin(a) * s.orbitR
            let ci = cos(s.inc), si = sin(s.inc)
            (y, z) = (y * ci - z * si, y * si + z * ci)
            let cn = cos(s.node), sn = sin(s.node)
            (x, z) = (x * cn + z * sn, -x * sn + z * cn)
            return SIMD3(x, y, z)
        }

        // 轨道线：投影后的椭圆，背面那半压暗，环才有穿过球体的立体感
        let seg = 60
        for s in sats {
            var path = Path()
            var depthSum = 0.0
            for k in 0...seg {
                let pr = project(onOrbit(s, Double(k) / Double(seg) * .pi * 2))
                depthSum += pr.z
                if k == 0 { path.move(to: pr.p) } else { path.addLine(to: pr.p) }
            }
            let t = (depthSum / Double(seg + 1) + 1) / 2
            gc.stroke(path, with: .color(s.color.opacity(0.05 + t * 0.16)), lineWidth: 1)
        }

        // 本体：远的先画近的后画，不排序的话后面的会盖住前面的，立体感立刻塌掉
        let bodies = sats.map { s -> (s: Sat, pr: (p: CGPoint, z: Double, scale: Double)) in
            (s, project(onOrbit(s, s.phase + s.speed * time)))
        }.sorted { $0.pr.z < $1.pr.z }

        for b in bodies {
            let depth = (b.pr.z + 1) / 2
            let alpha = 0.22 + depth * depth * 0.78
            let size = CGFloat(b.s.size) * radius * CGFloat(b.pr.scale) * CGFloat(0.62 + depth * 0.5)
            if b.s.isTriangle {
                // 三角只描边，像 HUD 上的标记；跟着时间自转
                let spin = time * (b.s.speed > 0 ? 0.45 : -0.5)
                var path = Path()
                for k in 0..<3 {
                    let a = -Double.pi / 2 + Double(k) * (.pi * 2 / 3) + spin
                    let pt = CGPoint(x: b.pr.p.x + cos(a) * size, y: b.pr.p.y + sin(a) * size)
                    if k == 0 { path.move(to: pt) } else { path.addLine(to: pt) }
                }
                path.closeSubpath()
                gc.stroke(path, with: .color(b.s.color.opacity(alpha)),
                          style: StrokeStyle(lineWidth: 1.2, lineJoin: .round))
            } else {
                // 小球：外面一圈辉光 + 本体，做出发光的球感
                let glow = size * 2.2
                gc.fill(Path(ellipseIn: CGRect(x: b.pr.p.x - glow, y: b.pr.p.y - glow,
                                               width: glow * 2, height: glow * 2)),
                        with: .radialGradient(
                            Gradient(colors: [b.s.color.opacity(alpha * 0.45), b.s.color.opacity(0)]),
                            center: b.pr.p, startRadius: 0, endRadius: glow))
                gc.fill(Path(ellipseIn: CGRect(x: b.pr.p.x - size, y: b.pr.p.y - size,
                                               width: size * 2, height: size * 2)),
                        with: .radialGradient(
                            Gradient(colors: [.white.opacity(alpha), b.s.color.opacity(alpha)]),
                            center: CGPoint(x: b.pr.p.x - size * 0.35, y: b.pr.p.y - size * 0.4),
                            startRadius: 0, endRadius: size * 1.3))
            }
        }
    }
}
