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

## 二、iOS（在 Apple Silicon 的 Mac 上开发，M1 iMac / MacBook 均可）

iOS 工程已经在 Windows 这边生成好并提交到 git 了，Mac 上拉下来就能直接用。
Capacitor 8 用的是 Swift Package Manager，**不需要装 CocoaPods**，省一大堆麻烦。

### 第 0 步：先确认 macOS 版本（这一步决定后面能不能干）

Xcode 版本受 macOS 限制，Xcode 又决定能编译哪个 iOS SDK。
苹果要求用**较新版本的 Xcode 构建才能提交 App Store**，而新 Xcode 需要较新的 macOS。

```bash
sw_vers          # 看 macOS 版本
xcode-select -p  # 看有没有装过命令行工具
```

M1 机器硬件上支持最新 macOS，但**如果一直没升级过**（出厂是 Big Sur），
要先去 系统设置 → 通用 → 软件更新 升上去，否则 App Store 里装不到能上架的 Xcode。

判断依据：装完 Xcode 后看它的版本号，如果 App Store 只给你很老的版本，
基本就是 macOS 太旧被卡住了。

### 首次在 Mac 上准备

```bash
# 1. 从 App Store 安装 Xcode（免费，约 10GB，装完先打开一次同意协议）
# 2. 装 Node（如果还没有）：https://nodejs.org 下 LTS 版
# 3. 拉代码
git clone https://github.com/q0637071/lang-buddy.git
cd lang-buddy
npm install
```

### 打开 Xcode 开发调试

```bash
npm run ios:open
```

这条命令会先同步最新网页代码，再自动用 Xcode 打开工程。然后在 Xcode 里：

1. 左上角选一个模拟器（比如 iPhone 16）
2. 点 ▶ 运行 —— **模拟器不需要任何付费账号**，可以立刻看到效果

### 装到自己的 iPhone 上真机测试

用**免费的 Apple ID** 就能装到自己手机上（不用 $99）：

1. Xcode → Settings → Accounts → 加上你的 Apple ID
2. 选中左侧 App 项目 → Signing & Capabilities → Team 选你的个人账号
3. 手机用数据线连电脑，顶部设备选你的 iPhone → 点 ▶
4. 首次运行手机会提示"不受信任的开发者"，去 设置 → 通用 → VPN与设备管理 里信任一下

⚠️ 免费账号签的 App **7天后会过期**需要重新装，且不能给别人装。要长期用或给别人测，
就得交 $99/年 的 Apple Developer Program。

### 每次改完网页代码

```bash
npm run ios:sync
```

然后回 Xcode 重新点运行即可。

### 上架 App Store 需要的

| 项目 | 说明 |
|---|---|
| Apple Developer Program | **$99/年**，没有它连 TestFlight 内测都做不了 |
| App 图标 | 1024×1024 无透明通道，用 @capacitor/assets 生成全套 |
| 隐私政策网址 | 强制要求，必须是可公开访问的页面 |
| 软件著作权登记 | 上架中国区需要，办理周期约 1-2 个月，要提前动手 |
| **工信部 App 备案** | 2023 年起强制。备案要求 App 使用的域名/服务器**已完成 ICP 备案** |
| **ICP 备案** | ⚠️ 当前最大障碍，见下 |

⚠️ **上架中国区的硬门槛**：`langbuddy.org` 目前挂在 Render（境外服务器），
这个组合**做不了 ICP 备案** —— 而没有 ICP 备案就办不了工信部 App 备案，
办不了 App 备案就上不了中国区 App Store。

要上架中国区，绕不开这一步：域名换成可备案的（.com/.cn 等，.org 也可以但需实名），
服务器迁到国内（阿里云/腾讯云），并用国内主体（公司或个体工商户）完成备案。
这件事周期长（备案本身 2-3 周），要上架就得尽早启动。

不上架中国区、只上美区等海外市场的话，以上中国特有的手续都不需要。

⚠️ **重要**：App 内如果要卖会员，苹果强制走 App 内购（抽成 15-30%），
直接接微信/支付宝会被拒审。我们接的 ZPay 在 iOS 端不能用于卖会员，
这块等真要上架时需要单独处理（常见做法是 iOS 端引导到网页版购买，
但苹果对"引导站外支付"也有限制，需要小心处理）。

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
- [x] iOS 工程已生成（Bundle ID 与安卓一致：org.langbuddy.app）
- [x] iOS 隐私权限说明已写入 Info.plist（麦克风/语音识别/相机/相册）
      —— 这几项缺失会导致请求权限时闪退且上架被拒
- [ ] 在 M1 Mac 上跑一遍模拟器，确认各功能正常
- [ ] 应用图标和启动图替换成自己的设计
- [ ] 应用图标和启动图替换成自己的设计
- [ ] 语音识别原生插件（如果需要 App 内也能语音输入）
- [ ] iOS 云端构建配置
