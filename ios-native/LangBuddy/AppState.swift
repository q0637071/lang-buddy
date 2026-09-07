import SwiftUI

/// App 的全局状态和流程调度。哪一屏该出现由 route 决定，视图只负责画。
@MainActor
final class AppState: ObservableObject {

    enum Route {
        case launching      // 启动时先拿 token 续登，避免闪一下欢迎页
        case welcome
        case login
        case register
        case placementIntro
        case placement
        case result(PlacementResult)
        case home
    }

    @Published var route: Route = .launching
    @Published var user: User?
    @Published var placement: PlacementStatus?
    @Published var toast: String?

    func showToast(_ msg: String) {
        toast = msg
        Task {
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            if toast == msg { toast = nil }
        }
    }

    /// 启动流程：有 token 就直接续上，别让老用户每次打开都重新登录
    func bootstrap() async {
        guard await API.shared.hasToken else {
            route = .welcome
            return
        }
        do {
            if let u = try await API.shared.me() {
                user = u
                await routeAfterAuth()
                return
            }
        } catch {
            // token 失效或网络不通都退回欢迎页，不弹错误——启动阶段弹窗很打扰
        }
        await API.shared.logout()
        route = .welcome
    }

    /// 登录/注册成功后的分流：没测过先测评，测过直接进首页
    func routeAfterAuth() async {
        do {
            let st = try await API.shared.placementStatus()
            placement = st
            route = st.done ? .home : .placementIntro
        } catch {
            // 拿不到测评状态也不该把人挡在门外，先进首页
            route = .home
        }
    }

    func finishPlacement(_ r: PlacementResult) {
        user?.level = r.level
        placement = PlacementStatus(done: true, level: r.level, cefr: r.cefr,
                                    questionCount: placement?.questionCount ?? 0)
        route = .result(r)
    }

    func signOut() async {
        await API.shared.logout()
        user = nil
        placement = nil
        route = .welcome
    }
}
