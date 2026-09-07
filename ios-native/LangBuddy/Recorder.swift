import Foundation
import AVFoundation

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

    func requestPermission() async -> Bool {
        await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { granted in
                cont.resume(returning: granted)
            }
        }
    }

    func start() {
        guard !isRecording else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            // 录音期间必须切到 playAndRecord；Speaker 平时用的是 playback，录不了音
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
        } catch { return }

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
        } catch {
            isRecording = false
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
