import Foundation

/// 和 LangBuddy 后端通信的唯一入口。后端就是网站那一套 API，没有为 App 单独做接口。
actor API {
    static let shared = API()

    /// 线上地址。本地调试时改成电脑的局域网 IP（例如 http://192.168.1.5:3001/api），
    /// 注意模拟器可以用 localhost，真机必须用局域网 IP。
    private let baseURL = URL(string: "https://langbuddy.org/api")!

    private let tokenKey = "lb_token"

    // token 存 UserDefaults：这不是密码，只是登录凭证，且 App 沙盒本身是隔离的。
    // 真要更严可以换 Keychain，等上架前再说。
    var token: String? {
        get { UserDefaults.standard.string(forKey: tokenKey) }
    }
    func setToken(_ t: String?) {
        if let t { UserDefaults.standard.set(t, forKey: tokenKey) }
        else { UserDefaults.standard.removeObject(forKey: tokenKey) }
    }
    var hasToken: Bool { token?.isEmpty == false }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil,
        as type: T.Type
    ) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 30   // 手机网络不稳时别无限等，否则用户只看到转圈
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError(message: "网络连接失败，请检查网络后重试")
        }

        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            // 后端的错误信息是给用户看的中文，直接透出去比"请求失败(400)"有用
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = obj["error"] as? String {
                throw APIError(message: msg)
            }
            throw APIError(message: "请求失败（\(code)）")
        }

        // 登录/注册的响应里带 token，统一在这里存下来，调用方不用逐个处理
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let t = obj["token"] as? String, !t.isEmpty {
            setToken(t)
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(message: "服务器返回了预期之外的数据")
        }
    }

    // MARK: - 认证

    func login(username: String, password: String) async throws -> User {
        let r = try await request("login", method: "POST",
                                  body: ["username": username, "password": password],
                                  as: AuthResponse.self)
        return r.user
    }

    func register(nickname: String, username: String, password: String,
                  phone: String, code: String) async throws -> User {
        let r = try await request("register", method: "POST",
                                  body: ["nickname": nickname, "username": username,
                                         "password": password, "phone": phone, "code": code],
                                  as: AuthResponse.self)
        return r.user
    }

    func sendCode(phone: String) async throws -> String? {
        let r = try await request("auth/phone/send-code", method: "POST",
                                  body: ["phone": phone], as: SendCodeResponse.self)
        return r.devCode
    }

    func me() async throws -> User? {
        try await request("me", as: MeResponse.self).user
    }

    func logout() {
        setToken(nil)
    }

    // MARK: - 水平测评

    func placementStatus() async throws -> PlacementStatus {
        try await request("placement/status", as: PlacementStatus.self)
    }

    func placementQuestions() async throws -> [PlacementQuestion] {
        try await request("placement/questions", as: PlacementQuestions.self).questions
    }

    func submitPlacement(answers: [String: Int]) async throws -> PlacementResult {
        try await request("placement/submit", method: "POST",
                          body: ["answers": answers], as: PlacementResult.self)
    }

    // MARK: - AI 对话

    func chatHistory() async throws -> [ChatMessage] {
        try await request("chat/history", as: ChatHistoryResponse.self).history
    }

    /// history 只带最近若干轮，后端也会再截一次；带太多会撑爆上下文也更慢
    func sendChat(message: String, history: [ChatMessage],
                  inputLang: String, replyLang: String) async throws -> String {
        let recent = history.suffix(10).map { ["role": $0.role, "content": $0.content] }
        let r = try await request("chat", method: "POST",
                                  body: ["message": message, "history": recent,
                                         "inputLang": inputLang, "replyLang": replyLang],
                                  as: ChatReply.self)
        return r.reply
    }

    func clearChat() async throws {
        _ = try await request("chat/clear", method: "POST", as: OKResponse.self)
    }

    func languages() async throws -> [LanguageOption] {
        try await request("meta/languages", as: LanguagesResponse.self).languages
    }

    // MARK: - 背单词

    func vocabQueue() async throws -> VocabQueue {
        try await request("vocab/review", as: VocabQueue.self)
    }

    /// rating 取 again / hard / good / easy，间隔计算全在后端（SM-2），前端不重复实现
    func reviewWord(_ word: String, rating: String) async throws {
        _ = try await request("vocab/review", method: "POST",
                              body: ["word": word, "rating": rating], as: OKResponse.self)
    }

    /// 标记为已掌握，直接跳到 30 天后再复习
    func skipWord(_ word: String) async throws {
        _ = try await request("vocab/review", method: "POST",
                              body: ["word": word, "skip": true], as: OKResponse.self)
    }

    // MARK: - 语法

    func grammarList() async throws -> [GrammarSummary] {
        try await request("grammar/list", as: GrammarListResponse.self).lessons
    }

    func grammarLesson(_ id: String) async throws -> GrammarLesson {
        try await request("grammar/\(id)", as: GrammarLessonResponse.self).lesson
    }

    /// AI 语法批改。非会员每天 3 次，超了后端返回 403 带中文说明
    func checkGrammar(_ sentence: String) async throws -> String {
        try await request("grammar/check", method: "POST",
                          body: ["sentence": sentence], as: GrammarCheckResponse.self).result
    }

    // MARK: - AI 视频通话

    func avatarStatus() async throws -> AvatarStatus {
        try await request("avatar/status", as: AvatarStatus.self)
    }

    func startAvatarCall() async throws -> AvatarConversation {
        try await request("avatar/conversation", method: "POST", as: AvatarConversation.self)
    }

    /// 通话中每 20 秒报一次，服务端据此判断人什么时候真的离开——
    /// 不报心跳会被按"异常退出"结算，用户会被多扣时长
    func pingAvatar() async throws {
        _ = try await request("avatar/ping", method: "POST", as: OKResponse.self)
    }

    func endAvatarCall() async throws {
        _ = try await request("avatar/end", method: "POST", as: OKResponse.self)
    }
}
