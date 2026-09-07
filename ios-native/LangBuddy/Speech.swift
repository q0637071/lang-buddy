import Foundation
import AVFoundation
// ObservableObject 和 @Published 定义在 Combine 里，新版 Xcode 不再隐式导出
import Combine

/// 朗读。走服务端的 Groq orpheus 模型，不用 iOS 自带的 AVSpeechSynthesizer——
/// 系统合成音一听就是机器，orpheus 有语气起伏，接近真人。
/// 代价是要联网、有几百毫秒延迟，所以本地缓存同一句话的音频。
@MainActor
final class Speaker: NSObject, ObservableObject {
    static let shared = Speaker()

    @Published private(set) var speakingID: String?   // 正在读哪条消息
    @Published private(set) var loadingID: String?    // 哪条正在合成

    private var player: AVAudioPlayer?
    private var cache: [String: Data] = [:]           // "voice|text" -> wav
    private let cacheLimit = 40

    /// 可选音色。orpheus 只认这几个，名字是模型定的，不能自己编。
    static let voices: [(id: String, label: String)] = [
        ("hannah", "Hannah · 女声"),
        ("diana",  "Diana · 女声"),
        ("autumn", "Autumn · 女声"),
        ("austin", "Austin · 男声"),
        ("daniel", "Daniel · 男声"),
        ("troy",   "Troy · 男声"),
    ]

    private override init() {
        super.init()
        // 用 playback 类别：手机静音开关拨到静音时也要能出声，
        // 否则用户会以为"点了朗读没反应"
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    }

    func stop() {
        player?.stop()
        player = nil
        speakingID = nil
    }

    /// id 用来标记是哪条消息在读，UI 据此显示播放状态
    func speak(_ text: String, voice: String, id: String) async {
        // 再点一次正在读的那条 = 停止，符合直觉
        if speakingID == id { stop(); return }
        stop()

        let key = "\(voice)|\(text)"
        if let data = cache[key] {
            play(data, id: id)
            return
        }

        loadingID = id
        defer { loadingID = nil }
        do {
            let data = try await API.shared.tts(text: text, voice: voice)
            if cache.count >= cacheLimit { cache.removeValue(forKey: cache.keys.first!) }
            cache[key] = data
            play(data, id: id)
        } catch {
            // 朗读失败不该打断对话，静默处理，UI 上恢复成未播放即可
            speakingID = nil
        }
    }

    private func play(_ data: Data, id: String) {
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            let p = try AVAudioPlayer(data: data)
            p.delegate = self
            p.prepareToPlay()
            p.play()
            player = p
            speakingID = id
        } catch {
            speakingID = nil
        }
    }
}

extension Speaker: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.speakingID = nil
            self.player = nil
        }
    }
}
