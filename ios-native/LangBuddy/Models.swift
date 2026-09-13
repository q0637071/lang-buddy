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

// MARK: - 情景对话

struct Scenario: Codable, Identifiable, Equatable {
    let id: String
    let emoji: String
    let title: String
    let brief: String
    let level: String
    let category: String
    let keyPhrases: [String]?
    // 只有详情接口返回这几个；列表里是 nil
    let goal: String?
    let aiRole: String?
    let setting: String?
    let opener: String?
    // 只有列表/计划接口返回
    let doneToday: Bool?
    let doneCount: Int?

    var levelText: String {
        switch level {
        case "advanced": return "高级"
        case "intermediate": return "进阶"
        default: return "基础"
        }
    }
}

struct DailyPlan: Codable {
    let date: String
    let level: String
    let plan: [Scenario]
    let doneToday: Int
    let total: Int
}

struct ScenarioListResponse: Codable {
    let scenarios: [Scenario]
}

struct ScenarioResponse: Codable {
    let scenario: Scenario
}

// MARK: - 背单词

/// 四种评价各自的"下次间隔"预览，后端算好直接给，前端不重复实现 SM-2
struct VocabPreviews: Codable, Equatable {
    let again: String?
    let hard: String?
    let good: String?
    let easy: String?

    func text(for rating: String) -> String {
        switch rating {
        case "again": return again ?? ""
        case "hard": return hard ?? ""
        case "good": return good ?? ""
        default: return easy ?? ""
        }
    }
}

struct VocabWord: Codable, Identifiable, Equatable {
    let word: String
    let pos: String?
    let meaning_zh: String?
    let example_en: String?
    let example_zh: String?
    let level: String?
    let category: String?
    let root: String?
    let note: String?
    let previews: VocabPreviews?

    var id: String { word }
    /// 词根和助记是分开的两个字段，展示时拼一行，都为空就不显示
    var rootLine: String? {
        let parts = [root, note].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// 词根关联星球上的一颗词。relation 是 root（同词根）或 category（同主题），
/// via 是具体的词根或分类名，用来告诉用户"为什么这个词会出现在这里"
struct RelatedWord: Codable, Identifiable, Equatable {
    let word: String
    let pos: String?
    let meaning_zh: String?
    let root: String?
    let relation: String?
    let via: String?

    var id: String { word }
    var isRoot: Bool { relation == "root" }
}

/// 首页"词根星球"入口用：后端随机挑一个词根足够常见的词
struct RootPick: Codable {
    let word: String?
    let root: String?
    let meaning_zh: String?
    let poolSize: Int?
}

struct RelatedResponse: Codable {
    let center: VocabWord
    let related: [RelatedWord]
}

struct VocabStats: Codable, Equatable {
    let total: Int
    let known: Int
    let learning: Int
    let new: Int
}

struct VocabQueue: Codable {
    let words: [VocabWord]
    let stats: VocabStats
}

// MARK: - 语法

struct GrammarSummary: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let summary: String
    let level: String?

    var levelKey: String { level ?? "basic" }
}

struct GrammarListResponse: Codable {
    let lessons: [GrammarSummary]
}

struct GrammarExample: Codable, Identifiable, Equatable {
    var id: String { en }
    let en: String
    let zh: String
}

/// 中国学生常见错误。老课程数据里没有这个字段，所以整段都是可选的
struct GrammarMistake: Codable, Identifiable, Equatable {
    var id: String { wrong }
    let wrong: String
    let right: String
    let why: String
}

struct GrammarPractice: Codable, Identifiable, Equatable {
    var id: String { question }
    let question: String
    let options: [String]
    let answerIndex: Int
    let explanation: String?
}

struct GrammarLesson: Codable, Equatable {
    let id: String
    let title: String
    let summary: String
    let structure: String?
    let explanation: String?
    let examples: [GrammarExample]?
    let mistakes: [GrammarMistake]?
    let practice: [GrammarPractice]?
}

struct GrammarLessonResponse: Codable {
    let lesson: GrammarLesson
}

struct GrammarCheckResponse: Codable {
    let result: String
}

// MARK: - AI 视频通话（Tavus）

struct AvatarStatus: Codable {
    let enabled: Bool
    let isMember: Bool?
    let unlimited: Bool?
    let monthlyMinutes: Int?
    let usedSeconds: Int?
    let remainingSeconds: Int?
    let maxCallSeconds: Int?
    let globalExhausted: Bool?
    // 试用次数：每个 IP 每月 N 次，每次 maxCallSeconds
    let monthlyCalls: Int?
    let usedCalls: Int?
    let remainingCalls: Int?

    /// -1 是后端给不限量账号的约定值
    var isUnlimited: Bool { unlimited == true || remainingSeconds == -1 }
    /// 老后端不返回这个字段，当成还有得用，真打不了后端会自己拦
    var callsLeft: Int { remainingCalls ?? 1 }
    var canStart: Bool {
        // 不再要求会员：非会员也有试用次数，能不能打完全看额度
        guard enabled, globalExhausted != true else { return false }
        return isUnlimited || (callsLeft > 0 && (remainingSeconds ?? 0) > 0)
    }
}

struct AvatarConversation: Codable {
    let conversationUrl: String
    let conversationId: String
    let maxSeconds: Int
    let remainingSeconds: Int?
}

struct SendCodeResponse: Codable {
    let ok: Bool?
    // 后端没接短信服务商时会把验证码直接返回，方便内测阶段自测
    let devCode: String?
}

// MARK: - 对话对象（人设）

/// 文字对话和视频通话共用同一批"人"，选一次到处生效。
/// voice 决定朗读音色，prompt 在后端，不下发到 App。
struct Persona: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let title: String
    let emoji: String
    let gender: String
    let voice: String
    let brief: String
    /// 视频通话里有没有专属的数字人形象。没有的话几位老师长得一样，只是性格不同
    let hasOwnFace: Bool?
    /// 老师照片的相对路径，形如 "img/personas/hannah.jpg"。没放照片时是 nil，界面退回 emoji
    let photo: String?

    var displayName: String { name + " · " + title }
    /// 后端给的是相对路径，App 要拼成完整地址才能加载
    var photoURL: URL? {
        guard let photo, !photo.isEmpty else { return nil }
        return URL(string: "https://langbuddy.org/" + photo)
    }
}

struct PersonaListResponse: Codable {
    let personas: [Persona]
    let defaultId: String?
    /// 一共配了几张不同的脸。1 表示还只有默认形象
    let distinctFaces: Int?
}

// MARK: - 作文批改

struct EssayCorrection: Codable, Identifiable, Equatable {
    let original: String
    let corrected: String
    let explanation: String
    // 后端没给 id，用内容拼一个。同一条修改的三段文字凑在一起足够唯一，
    // 用数组下标当 id 会在列表变化时错位
    var id: String { original + "→" + corrected }
}

struct EssayRubric: Codable, Equatable {
    let content: String
    let organization: String
    let language: String
}

struct EssayResult: Codable, Equatable {
    let estimatedLevel: String
    let overallComment: String
    let correctedEssay: String
    let corrections: [EssayCorrection]
    // 只有英语考试模式才有这两项
    let scoreEstimate: String?
    let rubric: EssayRubric?
}

// MARK: - 我的

// VocabStats 上面背单词那一节已经有了，直接复用，不要再定义一遍

struct MistakeStats: Codable, Equatable {
    let total: Int
    let mastered: Int
}

struct Metrics: Codable, Equatable {
    let vocab: VocabStats
    let mistakes: MistakeStats
    let chatCount: Int
    let streakDays: Int
    let activeDays: Int
    let isMember: Bool
}

struct ProfileResponse: Codable {
    let user: User
}

/// 后端统一用 { error: "..." } 返回错误，这里解出来直接展示给用户
struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
