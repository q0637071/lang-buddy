# LangBuddy 原生 iOS App（SwiftUI）

这是**独立于网站和 Capacitor 套壳**的一套原生 App 代码。

- 网站在 `public/`，一行不受影响
- Capacitor 套壳版在 `ios/`，保留着不动，随时可以回去
- 这里是纯 SwiftUI，走的是同一套后端 API（`https://langbuddy.org/api`）

## 为什么代码在这、工程文件不在这

Xcode 的工程文件（`.xcodeproj`）结构复杂且和本机路径绑定，手写极易出错。
所以分工是：**工程由你在 Xcode 里用向导生成一次，代码由仓库提供**。

---

## 第一次设置（在 iMac 上，约 5 分钟）

### 1. 新建工程

Xcode → **File → New → Project** → 选 **iOS** → **App** → Next

按这个填：

| 项 | 填什么 |
|---|---|
| Product Name | `LangBuddy` |
| Interface | **SwiftUI** |
| Language | **Swift** |
| Storage | **None** |
| Organization Identifier | `org.langbuddy` |

⚠️ Bundle ID 会自动变成 `org.langbuddy.LangBuddy`。如果以后要和 Capacitor 版共存
就保持这样；如果这版是要正式上架的，改成 `org.langbuddy.app`（和原来一致）。

保存位置随便选一个，**不要**存到 `lang-buddy` 仓库里面，避免和仓库文件混在一起。

### 2. 把代码加进工程

新建的工程里 Xcode 会自动生成 `LangBuddyApp.swift` 和 `ContentView.swift`。

1. 在 Xcode 左侧把这两个文件**删掉**（选 Move to Trash）
2. 打开访达，进到仓库的 `ios-native/LangBuddy/` 目录
3. 把里面**所有 `.swift` 文件**拖进 Xcode 左侧的项目里
4. 弹窗里勾上 **Copy items if needed** 和 **Add to targets: LangBuddy**

### 3. 运行

选一个模拟器（iPhone 16 之类），点 ▶。

---

## 每次我更新代码后

我改完推到 GitHub，你这边：

```bash
cd ~/lang-buddy && git pull
```

然后把 `ios-native/LangBuddy/` 里变动的文件重新拖进 Xcode 覆盖，
或者直接在访达里复制过去覆盖同名文件。

> 更省事的做法：新建工程时把工程建在 `ios-native/` 旁边，然后用
> **File → Add Files** 时**不勾** Copy items，这样文件是引用的，
> `git pull` 之后 Xcode 里自动就是新的。第一次设置时可以直接这么选。

---

## ⚠️ 视频通话需要先加两个权限说明（否则一点就崩）

Xcode 新建的工程里没有摄像头和麦克风的用途说明，App 一请求权限就会**直接崩溃**
（这是 iOS 的硬性规定，不是 bug）。

Xcode 里加：选中项目 → TARGETS → **Info** 标签 → 在列表里点 **+** 加两项：

| Key | Value |
|---|---|
| `Privacy - Camera Usage Description` | 用于与 AI 私教进行视频通话练习口语 |
| `Privacy - Microphone Usage Description` | 用于语音输入、按住说话和与 AI 私教对话练习 |

加完重新运行。**不加的话点"AI 视频通话"或"按住说话"都会闪退。**

## 当前进度

已完成：

- 欢迎页 / 注册（手机号+验证码，60秒倒计时）/ 登录
- 英语水平测评：15 题、难度梯度、进度条、可跳过可回退
- 结果页：CEFR 等级 + 三档水平 + 针对性建议
- 首页：学习路径卡片
- **AI 对话**：气泡列表、自动滚底、键盘跟随、可切换双方语言
- **今日单词**：卡片翻转、四档评价带间隔预览、词根词缀
- **语法精讲**：按难度分组的列表、详情、练习即时判对错、AI 批改
- **AI 视频通话**：Tavus 房间（WKWebView 内嵌）、倒计时、心跳计费
- token 本地保存，重开 App 自动续登

还没做：

- 「我的」页面（目前点首页右上角头像可以重新测评/退出登录）
- 语音对话（按住说话、原生录音）
- 错题本、作文批改、美式口语、同声传译

## 国内网络

已用国内移动数据实测 `network-test.daily.co`，全部通过。
Tavus 走的 Daily.co WebRTC 在国内可用，这条路没有网络层面的障碍。

## 关于视频通话为什么是 WebView

Tavus 交付通话的方式就是给一个网页房间地址（`tavus.daily.co/...`），
官方推荐的接入方式就是内嵌。要做成纯原生需要接 Daily 的 iOS SDK，
是另一套工作量。目前这一屏内部是 `WKWebView`，其余所有界面都是纯 SwiftUI。

## 文件说明

| 文件 | 作用 |
|---|---|
| `LangBuddyApp.swift` | App 入口 + 根视图（按 route 切屏） |
| `AppState.swift` | 全局状态和流程调度 |
| `API.swift` | 后端通信，token 管理 |
| `Models.swift` | 与后端 JSON 对应的数据结构 |
| `Theme.swift` | 配色和通用控件样式 |
| `AuthViews.swift` | 欢迎 / 登录 / 注册 |
| `PlacementViews.swift` | 测评说明 / 答题 / 结果 |
| `HomeView.swift` | 首页学习路径 |

## 本地调试后端

`API.swift` 里的 `baseURL` 默认指向线上。要连本地服务器：

- **模拟器**：改成 `http://localhost:3001/api`
- **真机**：改成电脑的局域网 IP，例如 `http://192.168.1.5:3001/api`

另外 iOS 默认禁止明文 HTTP，连本地服务器需要在 `Info.plist` 里加
`NSAppTransportSecurity → NSAllowsLocalNetworking`。线上是 HTTPS，不受影响。
