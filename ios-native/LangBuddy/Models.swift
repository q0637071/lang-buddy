import Foundation

// 后端返回的数据结构。字段名和 server.js 里的 publicUser / placement 接口一一对应，
// 改后端字段时这里必须同步改，否则解码会失败。

struct User: Codable, Equatable {
    let username: String
    var nickname: String?
    var level: String?
    var targetLang: String?
    var isMember: Bool?
    var isAdmin: Bool?

    var displayName: String { nickname?.isEmpty == false ? nickname! : username }
    var levelText: String {
        switch level {
        case "advanced": return "高级"
        case "intermediate": return "中级"
        default: return "初级"
        }
    }
}

struct AuthResponse: Codable {
    let user: User
    // 后端在返回体里带回 token，App 存下来后续请求用 Bearer 带上
    let token: String?
}

struct MeResponse: Codable {
    let user: User?
}

struct PlacementStatus: Codable {
    let done: Bool
    let level: String
    let cefr: String?
    let questionCount: Int
}

struct PlacementQuestion: Codable, Identifiable {
    let id: String
    let tier: Int
    let skill: String
    let question: String
    let options: [String]

    var tierLabel: String {
        switch tier {
        case 1: return "入门"
        case 2: return "基础"
        case 3: return "进阶"
        case 4: return "较难"
        default: return "挑战"
        }
    }
}

struct PlacementQuestions: Codable {
    let version: Int
    let questions: [PlacementQuestion]
}

struct PlacementResult: Codable {
    let level: String
    let cefr: String
    let correct: Int
    let total: Int

    var levelText: String {
        switch level {
        case "advanced": return "高级"
        case "intermediate": return "中级"
        default: return "初级"
        }
    }
    var advice: String {
        switch level {
        case "advanced":
            return "基础很扎实，之后会用更地道的表达和更复杂的话题来挑战你。"
        case "intermediate":
            return "你已经有不错的基础，接下来重点练表达的自然度和词汇的精准度。"
        default:
            return "我们会从基础句型和高频词开始，AI 对话时会放慢速度、用简单表达。"
        }
    }
}

// MARK: - AI 对话

/// 后端存的历史里 role 只有 "user" 和 "ai" 两种
struct ChatMessage: Codable, Identifiable, Equatable {
    var id: String = UUID().uuidString
    let role: String
    let content: String

    var isUser: Bool { role == "user" }

    // 后端返回的历史里没有 id 字段，解码时不要去找它，否则会失败
    enum CodingKeys: String, CodingKey { case role, content }
}

struct ChatHistoryResponse: Codable {
    let history: [ChatMessage]
}

struct ChatReply: Codable {
    let reply: String
}

/// 只返回 { ok: true } 的接口用这个接住
struct OKResponse: Codable {
    let ok: Bool?
}

struct LanguageOption: Codable, Identifiable, Equatable {
    let code: String
    let name: String
    var id: String { code }
}

struct LanguagesResponse: Codable {
    let languages: [LanguageOption]
}

struct SendCodeResponse: Codable {
    let ok: Bool?
    // 后端没接短信服务商时会把验证码直接返回，方便内测阶段自测
    let devCode: String?
}

/// 后端统一用 { error: "..." } 返回错误，这里解出来直接展示给用户
struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
