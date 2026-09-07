import Foundation
import AVFoundation
// ObservableObject 和 @Published 定义在 Combine 里，新版 Xcode 不再隐式导出
import Combine

/// 按住说话的录音器。录成 16kHz 单声道 m4a——Whisper 认这个格式，
/// 而且采样率压到 16k 后文件小很多，手机网络下上传快得多，识别精度没有损失。
@MainActor
final class Recorder: NSObject, ObservableObject {

    @Published private(set) var isRecording = false
    @Published private(set) var level: CGFloat = 0      // 0...1，画音量条用
    @Published private(set) var seconds = 0

    private var recorder: AVAudioRecorder?
    private var meterTask: Task<Void, Never>?
    private var fileURL: URL?

    /// 太短的多半是误触，不值得发去识别
    let minSeconds = 1
    /// 上限防止一直按着不放，也避免上传超过后端 10MB 限制
    let maxSeconds = 60

    /// 当前授权状态。已经决定过的情况不必再走异步请求，直接返回结果，
    /// 也就不存在"卡在获取权限"这种状态。
    private var permissionState: AVAudioApplication.recordPermission {
        AVAudioApplication.shared.recordPermission
    }

    /// 给视图层用的布尔量。AVFAudio 的枚举不往外暴露，否则每个用到它的视图
    /// 都得 import AVFoundation，纯粹是把音频框架的依赖扩散到 UI 里。
    var isPermissionDenied: Bool { permissionState == .denied }

    func requestPermission() async -> Bool {
        switch permissionState {
        case .granted: return true
        case .denied: return false
        default: break      // undetermined，才需要真的去问
        }

        // 加超时兜底：Info.plist 里缺 NSMicrophoneUsageDescription 时这个回调
        // 可能永远不来，没有超时的话界面就永久停在"正在获取权限"。
        return await withTaskGroup(of: Bool?.self) { group in
            group.addTask {
                await withCheckedContinuation { cont in
                    AVAudioApplication.requestRecordPermission { granted in
                        cont.resume(returning: granted)
                    }
                }
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                return nil      // 超时
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first ?? false
        }
    }

    /// 返回是否真的开始录了。失败原因放在 lastError 里，UI 要能告诉用户怎么回事，
    /// 而不是按了没反应。
    @Published private(set) var lastError: String?

    @discardableResult
    func start() -> Bool {
        guard !isRecording else { return true }
        lastError = nil
        let session = AVAudioSession.sharedInstance()
        do {
            // 录音期间必须切到 playAndRecord；Speaker 平时用的是 playback，录不了音
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
        } catch {
            lastError = "无法启用麦克风：\(error.localizedDescription)"
            return false
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("lb_rec_\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let r = try AVAudioRecorder(url: url, settings: settings)
            r.isMeteringEnabled = true
            r.prepareToRecord()
            r.record()
            recorder = r
            fileURL = url
            isRecording = true
            seconds = 0
            startMetering()
            return true
        } catch {
            isRecording = false
            lastError = "录音启动失败：\(error.localizedDescription)"
            return false
        }
    }

    /// 返回录好的文件；时长不够或没录上返回 nil
    func stop() -> URL? {
        meterTask?.cancel(); meterTask = nil
        guard let r = recorder else { return nil }
        let duration = r.currentTime
        r.stop()
        recorder = nil
        isRecording = false
        level = 0
        // 录完切回 playback，否则接下来的朗读会从听筒出声而不是扬声器
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        guard duration >= Double(minSeconds), let url = fileURL else {
            discard()
            return nil
        }
        return url
    }

    func cancel() {
        meterTask?.cancel(); meterTask = nil
        recorder?.stop()
        recorder = nil
        isRecording = false
        level = 0
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        discard()
    }

    func discard() {
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        fileURL = nil
    }

    private func startMetering() {
        meterTask = Task { [weak self] in
            var tick = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000)
                guard let self, let r = self.recorder else { return }
                r.updateMeters()
                // dB 是 -160...0，映射到 0...1；低于 -50dB 基本是环境噪音，直接压到 0
                let db = Double(r.averagePower(forChannel: 0))
                let norm = max(0, min(1, (db + 50) / 50))
                self.level = CGFloat(norm)
                tick += 1
                if tick % 16 == 0 { self.seconds = Int(r.currentTime) }
                if r.currentTime >= Double(self.maxSeconds) { return }
            }
        }
    }
}
