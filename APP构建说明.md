# LangBuddy App 构建说明（Windows 开发）

用 Capacitor 把现有网页打包成原生 App。网页代码和 App 共用同一套 `public/`，
以后改功能只需要改一次，两边都生效。

---

## 一、安卓（可以在 Windows 上完整开发和出包）

### 1. 装 Android Studio（一次性，约 1GB）

下载：https://developer.android.com/studio

安装时保持默认选项即可，它会自动装好 **JDK** 和 **Android SDK**（这两个是编译必需的）。
装完打开一次 Android Studio，让它把 SDK 组件下载完整。

### 2. 出一个可安装的测试包（APK）

```bash
npm run app:sync
npm run app:apk
```

生成的安装包在：
`android/app/build/outputs/apk/debug/app-debug.apk`

把这个文件传到安卓手机上点击安装即可（手机需要允许"安装未知来源应用"）。

### 3. 用模拟器或真机调试

```bash
npm run app:open
```

会打开 Android Studio，点绿色三角运行按钮，选模拟器或插着的真机。

### 4. 每次改完网页代码后

```bash
npm run app:sync
```

这一步把 `public/` 里最新的网页同步进安卓工程，然后重新运行/出包。

---

## 二、iOS（Windows 上写代码，云端出包）

iOS 编译签名只能在 macOS 上做，Xcode 不支持 Windows。你那台十年前的 Mac 系统版本
大概率也太旧（上架要求较新的 Xcode/SDK）。解决办法是**云端构建**，不需要自己有 Mac：

- **Codemagic**（codemagic.io）——有免费额度，对 Capacitor 支持好，推荐先用这个
- **Expo EAS Build**（expo.dev）
- **GitHub Actions** 的 macOS runner（公开仓库免费额度较多）

流程：代码推到 GitHub → 云端 Mac 自动编译签名 → 下载 ipa 或直接传到 TestFlight。

前置条件：**Apple Developer Program 会员，$99/年**（不交这个连 TestFlight 内测都做不了）。

准备做 iOS 时告诉我，我帮你配置 `capacitor.config.json` 的 iOS 部分和云端构建的配置文件。

---

## 三、已知限制（重要）

### 1. 语音识别在 App 里用不了

安卓 WebView **不支持** Web Speech API 的语音识别（`SpeechRecognition`），
所以"🎙️ 语音输入"和"语音对话模式"在 App 里点了不会有反应。

- **朗读**（`speechSynthesis`）在 WebView 里是支持的，AI 回复朗读、单词发音都正常
- 要让语音识别在 App 里能用，需要接原生插件：
  `npm i @capacitor-community/speech-recognition`，然后在代码里判断环境分别调用

网页版不受影响，语音功能照常。

### 2. 上架国内应用商店需要的材料

安卓 App 在国内上架（华为/小米/OPPO/vivo/应用宝等）普遍要求：

- **软件著作权证书（软著）**——个人也能申请，自己办约 300 元，代办约 500-1000 元，
  正常流程约 30 个工作日，加急可缩短
- 应用商店开发者账号（各家单独注册，部分要营业执照，部分个人可注册）
- 隐私政策页面、备案信息

Google Play 只需 $25 一次性注册费，但国内用户基本用不了。

### 3. 支付

App 内如果卖会员，苹果要求虚拟商品走 App 内购（抽成 15-30%），
直接用微信/支付宝支付会被拒审。安卓国内商店没这个强制要求。
这块等真要上架时再单独处理。

---

## 四、当前进度

- [x] 后端支持 token 认证（App 跨域场景 cookie 发不出去，必须用 token）
- [x] 后端为 App 的 WebView 源开放 CORS
- [x] 前端自动识别运行环境：App 里请求打到 https://langbuddy.org，网页版走同源
- [x] Capacitor 工程初始化、安卓平台已添加
- [x] 应用名 "LangBuddy 语伴"、包名 org.langbuddy.app
- [x] 相机/麦克风/相册权限已在 AndroidManifest 声明
- [ ] 安装 Android Studio 后出第一个 APK（需要你操作）
- [ ] 应用图标和启动图替换成自己的设计
- [ ] 语音识别原生插件（如果需要 App 内也能语音输入）
- [ ] iOS 云端构建配置
