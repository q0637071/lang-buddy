# LangBuddy App 构建说明（Windows 开发）

用 Capacitor 把现有网页打包成原生 App。网页代码和 App 共用同一套 `public/`，
以后改功能只需要改一次，两边都生效。

---

## 一、安卓（可以在 Windows 上完整开发和出包）

### 环境（已经配置好了，这里只是记录）

- Android Studio + Android SDK：已装在 `C:\Users\q0637\AppData\Local\Android\Sdk`
- **JDK 21**：已解压到 `C:\Users\q0637\jdk21\jdk-21.0.12+8`

  为什么不用 Android Studio 自带的 JDK：它带的是 JDK 25，而当前 Gradle 8.14
  最高只支持 Java 24，直接用会报 `Unsupported class file major version 69`。
  所以单独装了一个官方推荐的 JDK 21。

### 出安装包（一条命令）

```bash
npm run app:apk
```

这条命令会自动把最新网页同步进安卓工程、找到正确的 JDK、然后编译，
最后打印出安装包路径：

`android/app/build/outputs/apk/debug/app-debug.apk`

把这个文件传到安卓手机上点击安装即可（手机需要允许"安装未知来源应用"）。

**以后每次改完网页代码，就跑这一条命令重新出包，不需要额外做别的。**

### 用模拟器或真机调试

```bash
npm run app:open
```

会打开 Android Studio，点绿色三角运行按钮，选模拟器或插着的真机。

注意：如果在 Android Studio 里直接点运行报 JDK 版本错误，去
`File > Settings > Build, Execution, Deployment > Build Tools > Gradle`，
把 Gradle JDK 改成 `C:\Users\q0637\jdk21\jdk-21.0.12+8`。

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

### 1. 语音功能（实测结论）

**语音识别：可以用。** 在模拟器上实测，点麦克风会正常弹出录音权限请求，
授权后 Google 语音识别服务正常启动并返回结果（模拟器没有真实麦克风输入，
所以返回的是"没检测到语音"，这是预期行为）。不需要额外接原生插件。

前提是设备上装有语音识别服务（国内某些没有 Google 服务的机型可能没有，
这种情况下我们的代码会连续重试3次后自动退出语音模式并提示改用打字，
不会卡死）。

**朗读（TTS）：取决于设备有没有装语音包。** 模拟器上显示"当前设备没有可用的
语音包"，因为模拟器镜像不带 TTS 语音数据。真机一般自带（国产机通常有自家的
TTS 引擎），如果某台设备确实没有，页面上会明确提示而不是静默失败。

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
- [x] 环境配好（Android Studio + SDK + JDK 21），`npm run app:apk` 一条命令出包，已验证成功
- [x] **在安卓模拟器（Android 15 / Pixel 7）上实测通过**：
  - 注册登录（token 认证）✓
  - 背单词卡片、词库 6261 词（来自线上）✓
  - 词根关联星球，手指拖拽旋转 ✓
  - AI 对话，发消息收到正常回复 ✓
  - 麦克风权限请求与语音识别服务调用 ✓
  - 无 JS 报错
- [ ] 有真机时再验一遍（真机能测到真实麦克风、TTS语音包、中文输入法）
- [ ] 应用图标和启动图替换成自己的设计
- [ ] 应用图标和启动图替换成自己的设计
- [ ] 语音识别原生插件（如果需要 App 内也能语音输入）
- [ ] iOS 云端构建配置
