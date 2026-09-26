# HolaBuddy（西语站）部署清单

一套代码跑两个站：`langbuddy.org` 学英语、`holabuddy.org` 学西语。
差异全部由环境变量决定，代码不分叉 —— bug 修一次两边都好。

> **贯穿全文的硬约束**：不配任何新变量时，行为完全等于今天的 LangBuddy。
> 所有新增配置项都必须保持这个性质。

---

## 1. 域名

注册 **`holabuddy.org`**（和 `langbuddy.org` 同后缀）。

查过 Cloudflare DoH 是 NXDOMAIN，很可能可注册，但**这只说明没有 DNS 记录，
不等于没被注册** —— 最终以注册商为准。备选：`hablabuddy.com`、`charlaai.com`。

---

## 2. 在 Render 上建第二个服务

指向**同一个仓库、同一个分支**。两条路：

### 路线 A：手动在面板里建（推荐，风险最低）

Dashboard → New → Web Service → 选同一个 repo，然后：

| 项 | 值 |
|---|---|
| Name | `holabuddy` |
| Build Command | `npm install` |
| Start Command | `node server.js` |

环境变量见第 3 节。

### 路线 B：写进 `render.yaml`

更规范，但**有风险**：如果 Blueprint 开了自动同步，改动这个文件会让 Render
去对账**现有的 langbuddy 服务**。要是线上配置曾经在面板里手工改过、和文件里
不一致，同步时会被覆盖回文件里的值。

走这条路之前，先逐项核对线上 langbuddy 的环境变量和 `render.yaml` 是否一致。
确认无误后，往 `services:` 下面追加：

```yaml
  - type: web
    name: holabuddy
    env: node
    plan: free
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      # —— 站点身份 ——
      - key: SITE_NAME
        value: HolaBuddy
      - key: SITE_TITLE
        value: HolaBuddy — Learn Spanish with an AI Tutor
      - key: SITE_UI_LANG
        value: en
      - key: SITE_TARGET_LANG
        value: es
      - key: SITE_URL
        value: https://holabuddy.org
      # —— 关掉的功能 ——
      - key: FEATURE_VOCAB
        value: "off"
      - key: FEATURE_GRAMMAR
        value: "off"
      - key: FEATURE_COLLOQUIAL
        value: "off"
      - key: FEATURE_SCENARIOS
        value: "off"
      # —— 必须独立，不能和 langbuddy 共用 ——
      - key: MONGODB_URI
        sync: false
      - key: SESSION_SECRET
        generateValue: true
      # —— 可与 langbuddy 共用（同一账号计费）——
      - key: SF_API_KEY
        sync: false
      - key: TAVUS_API_KEY
        sync: false
      - key: TAVUS_FACE_ID
        sync: false
      - key: TAVUS_PAL_ID
        sync: false
```

---

## 3. 环境变量

### 必须独立，共用会出事

| 变量 | 为什么 |
|---|---|
| `MONGODB_URI` | **最容易出事的一条。** 共用的话两个站是同一份用户表，用户名会打架，A 站注册的人能用同一个账号登 B 站。必须新建一个库。 |
| `SESSION_SECRET` | 共用等于两站的登录态可以互相伪造。用 `generateValue: true` 让 Render 各自生成。 |
| `SITE_URL` | OAuth 回调和支付通知都按它拼地址，配错会回调到另一个站。 |

### 站点身份

| 变量 | HolaBuddy | 不配时 |
|---|---|---|
| `SITE_NAME` | `HolaBuddy` | 不下发，前端不接管品牌（现有站靠这个保持原样） |
| `SITE_TITLE` | `HolaBuddy — Learn Spanish with an AI Tutor` | 同上 |
| `SITE_UI_LANG` | `en` | `zh` |
| `SITE_TARGET_LANG` | `es` | `en` |

### 功能开关（只有写 `off` 才关）

| 变量 | HolaBuddy | 说明 |
|---|---|---|
| `FEATURE_VOCAB` | `off` | 用户明确不要 |
| `FEATURE_GRAMMAR` | `off` | 用户明确不要 |
| `FEATURE_COLLOQUIAL` | `off` | 「地道美式口语」是英语内容，放西语站没意义 |
| `FEATURE_SCENARIOS` | `off` | **暂时**关掉，见第 6 节 |

### 可以共用

`SF_API_KEY`、`TAVUS_API_KEY`、`OPENROUTER_API_KEY`、`DOMESTIC_API_KEY` 等
都可以和 langbuddy 用同一个。

> ⚠️ 共用 Tavus 的话，**全站月度分钟硬顶是两个站一起吃的**。
> `AVATAR_GLOBAL_MONTHLY_MINUTES` 在每个服务里各自生效，两边加起来别超过套餐额度。

---

## 4. Tavus：建一个西语 PAL

面对面是这个站最重的功能，不配的话声音会带英语腔。

1. Tavus 后台 → **PALS** → **New PAL**
2. Voice 选一个**西语区域**的音色（文档原话：音色 locale 和目标语言匹配才自然）
3. 建好后把 `pal_id`（`p` 开头）配成 `TAVUS_PAL_ID`

**不用担心脸会被改**：我们创建通话时 `face_id` 和 `pal_id` 都传，
而 Tavus 文档写明**请求里的 `face_id` 会覆盖 PAL 里配的那个**。
所以一个西语 PAL 管声音，八位老师各自的长相不受影响。

通话语言本身已经在代码里按用户的 `targetLang` 传了（`properties.languages`），
不需要额外配置。

---

## 5. 上线后验证

```bash
# 配置有没有生效（应该看到 name/uiLang/targetLang 和四个 false）
curl -s https://holabuddy.org/ | grep -o 'window.__SITE__={[^<]*'

# 现有站必须一点没变：没有 name 字段、uiLang=zh、四项全 true
curl -s https://langbuddy.org/ | grep -o 'window.__SITE__={[^<]*'
```

浏览器里再确认：

- [ ] 左上角是 **HolaBuddy**，标签页标题是英文
- [ ] 界面默认英文（顶栏「中 / EN」仍可切）
- [ ] 导航只有 6 项：AI 对话、面对面、同声传译、作文批改、错题本、我的
- [ ] 地址栏手输 `#vocab` / `#scenarios` 会被踢回首页
- [ ] 注册一个新号，「目标语言」默认是 **Spanish**
- [ ] 用超管登录 `https://holabuddy.org/api/health`，`warnings` 里
      **不该有** SESSION_SECRET 和 MongoDB 的告警

---

## 6. 还没做的

**200 个场景的西语版**（英文标题/简介/目标 + 西语开场白和关键表达）。

现有那 200 个场景的 `opener` 和 `keyPhrases` 全是英文，直接开在西语站上，
学西语的人点进去看到的是英文对话 —— 比没有这个功能还糟。所以先
`FEATURE_SCENARIOS=off`。

做好之后：把西语场景库放成 `data/scenarios-es.json`，然后在 holabuddy 服务上

```
SCENARIOS_FILE=scenarios-es.json
FEATURE_SCENARIOS=on      # 或者直接删掉这个变量
```

老师人设（8 位）的 prompt 是语言中立的，已验证可直接复用，不用改。

---

## 附：一处需要你核实的旧结论

`render.yaml` 里写着 `ADMIN_USERNAME: admin`。我之前在对话里说过
「除非专门设过，否则全站只有 administrator 一个管理员」—— 按这个文件看
**是设过的**，也就是线上还存在一个叫 `admin` 的普通管理员（能看用户列表和
统计，看不到 IP/归属地/登录记录）。

如果那不是你有意留的，去 Render 面板确认一下。
