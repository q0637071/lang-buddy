/* 界面语言。默认中文——中文用户的体验一点不变，想看英文自己点顶栏的 EN。
   不按浏览器语言自动切：海外华人、英文系统的中文用户会被误伤。

   词典直接拿中文原文当 key。这样做的好处是漏翻的地方会原样显示中文，
   页面不会散架，也不用先发明一套 key 再挨个替换（那样改动量大得多、还容易写错 key）。

   这个文件必须在 app.js 之前加载：app.js 里到处都要用 t()。 */
(function () {
  var LANG_KEY = 'lb_ui_lang';

  var EN = {
    // —— 顶栏 / 导航 ——
    'LangBuddy 语伴': 'LangBuddy',
    '首页': 'Home',
    'AI 对话': 'AI Chat',
    'AI对话': 'AI Chat',
    '情景地图': 'Scenario Map',
    '同声传译': 'Live Translate',
    '背单词': 'Vocabulary',
    '语法精讲': 'Grammar',
    '美式口语': 'Everyday English',
    '作文批改': 'Essay Review',
    '错题本': 'Mistake Log',
    '管理后台': 'Admin',
    '我的': 'Account',
    '与 AI 私教面对面': 'Face-to-Face with AI Tutor',

    // —— 落地页 ——
    '跟 AI 私教': 'Learn with an AI tutor',
    '1对1 练出真实的外语能力': 'One-on-one practice that builds real fluency',
    'AI 视频通话 · 打字对话 · 语音练习 · 背单词 · 语法精讲，一站式外语学习平台':
      'Video calls, chat, speaking practice, vocabulary and grammar — everything in one place.',
    '免费开始学习': 'Start learning free',
    '已有账号，登录': 'I have an account',
    'AI 视频通话': 'AI Video Call',
    '和 AI 私教面对面视频通话，看得见表情、听得见语气，最接近真人外教的口语练习。':
      'Talk face to face with an AI tutor — you can see expressions and hear tone. The closest thing to a real tutor.',
    '会员专享': 'Members only',
    '会员专享免费试用': 'Members only · free trial',
    'AI 1对1 对话': 'One-on-one AI chat',
    '随时随地和 AI 私教打字对话，模拟真实场景，及时纠正你的语法和用词错误。':
      'Chat with your AI tutor anytime. Real situations, with grammar and word choice corrected as you go.',
    '语音练习': 'Speaking practice',
    '支持语音输入和 AI 语音朗读，练习听力和口语发音，像真人对话一样自然。':
      'Speak and listen, with natural text-to-speech — practice listening and pronunciation like a real conversation.',
    '科学背单词': 'Smart vocabulary',
    '内置分级词库，基于间隔重复算法安排复习，让记忆更持久。':
      'A leveled word bank with spaced repetition, so what you learn actually sticks.',
    '10大核心语法专题讲解+练习，配合 AI 批改，写句子不再心虚。':
      '10 core grammar topics with exercises and AI feedback, so you can write with confidence.',
    'AI 作文批改': 'AI essay review',
    '整篇作文逐句批改，指出语法和用词问题，并讲清为什么要这么改、地道的说法是什么。':
      'Sentence-by-sentence feedback on your whole essay — what to fix, why, and how a native speaker would say it.',
    '开通会员，解锁 AI 1对1 全部功能': 'Go premium and unlock everything',
    '演示版 · 免费开通': 'Demo — free to activate',
    '📹 AI 视频通话，面对面练口语': '📹 AI video calls for face-to-face speaking',
    '✔ AI 1对1 打字/语音对话': '✔ One-on-one chat and voice practice',
    '✔ AI 语法批改': '✔ AI grammar feedback',
    '✔ 完整背单词与语法课程': '✔ Full vocabulary and grammar courses',
    '✔ 学习进度记录': '✔ Progress tracking',
    '注册并开通会员': 'Sign up and activate',

    // —— 首页 Dashboard ——
    '欢迎回来': 'Welcome back',
    '欢迎回来，': 'Welcome back, ',
    '连续天数': 'Streak',
    // 语言名（服务端下发的是中文）
    '中文': 'Chinese', '英语': 'English', '日语': 'Japanese', '韩语': 'Korean',
    '法语': 'French', '德语': 'German', '西班牙语': 'Spanish',
    // 等级 / 会员状态
    '✅ 会员': '✅ Premium', '未开通': 'Free plan',
    'GRE': 'GRE',
    // 功能星球上的一句话介绍
    '打字或语音，AI 按你的水平陪练': 'Type or talk — the AI matches your level',
    '一天一个场景，走过的自动插旗': 'One scenario a day, cleared levels get a flag',
    '面对面': 'Face to face',
    '和 AI 私教视频通话，看得见表情': 'Video call your tutor and read their expression',
    '说一句，立刻听到另一种语言': 'Say a line, hear it in another language',
    '按遗忘曲线复习，顺带记词根': 'Spaced repetition, with word roots along the way',
    '一次讲透一个点，带 AI 批改': 'One point at a time, with AI feedback',
    '地道说法，跟读对比发音': 'Real expressions, with pronunciation practice',
    '错过的题自动归拢，反复清零': 'Your mistakes, collected and cleared',
    '逐句改，讲清为什么这么改': 'Line-by-line edits, with the reasoning',
    '会员、目标语言、学习设置': 'Membership, target language and settings',
    // —— JS 里动态生成的 ——
    '暂未开放': 'Not available yet',
    '这个功能还没开启，先用「对话」页练也一样有效。':
      'This feature isn’t switched on yet — the Chat page works just as well for practice.',
    '总词汇': 'Total', '未学': 'Not started',
    '学习中 ': 'Learning ', '关': 'levels',
    '停止收听': 'Stop listening', '停止并翻译': 'Stop and translate', '开始录音': 'Start recording',
    '尚未开通会员': 'No membership yet', '立即开通': 'Activate',
    '🎁 当前可试用 1 分钟 AI 对话，在"我的"页面验证手机号即可解锁每天 5 分钟。':
      '🎁 You have a 1-minute trial. Verify your phone number under Account to unlock 5 minutes a day.',
    '🎁 当前可试用 1 次 AI 语法批改，在"我的"页面验证手机号即可解锁每天 3 次。':
      '🎁 You have 1 free grammar check. Verify your phone number under Account to unlock 3 a day.',
    '🎁 当前可试用 1 次错题解析，在"我的"页面验证手机号即可解锁每天 3 次。':
      '🎁 You have 1 free explanation. Verify your phone number under Account to unlock 3 a day.',
    '🎁 当前可试用 1 次 AI 作文批改，在"我的"页面验证手机号即可解锁每天 3 次。':
      '🎁 You have 1 free essay review. Verify your phone number under Account to unlock 3 a day.',
    '电脑端可直接 Ctrl+V 粘贴截图': 'On a computer you can paste a screenshot with Ctrl+V',
    '和 AI 私教练口语': 'Practice speaking with your AI tutor',
    '进 入': 'Enter',
    '拖动旋转 · 点节点直接进入': 'Drag to rotate · tap a node to open',
    '功能星球，左右拖动旋转，回车进入选中的功能':
      'Feature globe — drag left or right to rotate, press Enter to open the selected feature',
    '会员状态': 'Membership',
    '目标语言': 'Target language',
    '当前水平': 'Level',
    '待复习单词': 'Words due',
    '学习数据': 'Your stats',
    '连续学习天数': 'Day streak',
    '已掌握单词': 'Words mastered',
    '错题收录': 'Mistakes saved',
    'AI对话次数': 'Chats',
    '单词总体掌握进度': 'Overall vocabulary progress',
    '立即开通会员': 'Go premium',

    // —— AI 对话 ——
    'AI 1对1 对话练习': 'One-on-One Practice',
    '语言': 'Language',
    '声音': 'Voice',
    '自动朗读': 'Auto-play',
    'AI 回复后自动读出来': 'Read AI replies out loud automatically',
    '试听': 'Preview',
    '🎧 语音模式': '🎧 Voice mode',
    '清空对话记录': 'Clear conversation',
    '语音输入': 'Voice input',
    '发送': 'Send',
    '用目标语言打字，或点麦克风说话…': 'Type in your target language, or tap the mic…',
    '🎙️ 正在聆听...': '🎙️ Listening…',
    '结束语音对话': 'End voice mode',
    '情景练习': 'Scenario',
    '退出情景': 'Exit scenario',
    '🎁 非会员每天可免费体验 5 分钟 AI 对话，开通会员畅享无限时长。':
      '🎁 Free plan includes 5 minutes of AI chat per day. Go premium for unlimited.',

    // —— 面对面 ——
    '真人形象 · 实时视频': 'Real face · live video',
    '看得见表情，听得见语气': 'See expressions, hear tone',
    '开始之前': 'Before you start',
    '浏览器会请求摄像头和麦克风权限，点「允许」才能接通。':
      'Your browser will ask for camera and microphone access — you must allow it to connect.',
    '建议戴耳机，避免 AI 的声音被麦克风收进去形成回声。':
      'Use headphones so the AI’s voice doesn’t echo back through your mic.',
    '说错了不用停，直接往下讲，AI 会在回应里顺手帮你改。':
      'Don’t stop when you make a mistake — keep going, and the AI will correct you as it replies.',
    '每次通话有固定时长，时间到了会自己挂断，不会多扣你的次数。':
      'Each call has a fixed length and ends on its own — you won’t be charged extra.',
    '接通前会把你的测评等级和目标语言带过去，难度自动贴合，不会一上来就听不懂。':
      'Your level and target language are sent ahead, so the difficulty fits from the first sentence.',
    'AI 私教会看着你说话、点头、追问，比打字更接近真实对话的压力。':
      'The tutor watches you, nods and follows up — much closer to the pressure of a real conversation.',
    '像跟真人上课': 'Like a real lesson',
    '到点自动结束': 'Ends automatically',
    '开始通话': 'Start call',
    '结束通话': 'End call',
    '正在查询可用额度…': 'Checking your remaining quota…',
    '正在通话': 'In call',
    '本月次数': 'Calls this month',
    '本月用量': 'Usage this month',
    '房间 id': 'Room ID',

    // —— 情景地图 ——
    '像玩游戏闯关一样练英语口语，每一关是一个真实场景。':
      'Level up like a game — every level is a real-life situation.',
    '今日场景': 'Today’s scenario',
    '开始今天的场景': 'Start today’s scenario',
    '地图进度': 'Map progress',
    '开始对话': 'Start conversation',

    // —— 同声传译 ——
    '对方说外语，实时翻译成你指定的语言并读出来':
      'Translates what the other person says into your language, out loud, in real time.',
    '对方说': 'They speak',
    '翻译成': 'Translate to',
    '互换语言': 'Swap languages',
    '开始收听': 'Start listening',
    '点击开始，对方说话时会自动翻译并朗读':
      'Tap start — anything they say will be translated and read aloud.',
    '🔊 自动朗读译文': '🔊 Read translations aloud',
    '🎧 一直识别不出来？改用录音翻译': '🎧 Not picking anything up? Switch to record-and-translate',
    '清空记录': 'Clear',

    // —— 背单词 ——
    '📚 浏览全部单词': '📚 Browse all words',
    '🪐 看词根关联星球': '🪐 Word-root galaxy',
    '📝 根据学习情况来次测试': '📝 Take a placement test',
    '🎉 今天的复习任务已完成！': '🎉 You’re done reviewing for today!',
    '显示释义': 'Show meaning',
    '😵 忘记': '😵 Forgot',
    '😓 困难': '😓 Hard',
    '🙂 记得': '🙂 Good',
    '😎 简单': '😎 Easy',
    '⏭️ 已掌握，跳过': '⏭️ Already know it — skip',
    '🔍 搜索单词或中文释义...': '🔍 Search a word or meaning…',
    '返回背单词': 'Back to vocabulary',
    '全部': 'All',
    '四级': 'CET-4',
    '六级': 'CET-6',
    '考研': 'Postgrad',
    '托福': 'TOEFL',
    '未学': 'New',
    '学习中': 'Learning',
    '已掌握': 'Mastered',
    '已掌握词': 'Mastered',
    'CET-4 四级': 'CET-4',
    'CET-6 六级': 'CET-6',
    'IELTS 雅思': 'IELTS',
    'TOEFL 托福': 'TOEFL',
    '👆 拖动球体旋转，点击任意单词查看释义': '👆 Drag to rotate, tap any word to see its meaning',
    '📇 复习卡片': '📇 Review cards',
    '🔑 词根线索': '🔑 Root clues',
    '整体水平评估': 'Overall level',
    '再测一次': 'Test again',
    '按你的水平出题': 'Questions matched to your level',
    '初级': 'Beginner',
    '中级': 'Intermediate',
    '高级': 'Advanced',

    // —— 语法 ——
    '语法学习': 'Grammar',
    '← 返回列表': '← Back to list',
    '结构': 'Structure',
    '讲解': 'Explanation',
    '例句': 'Examples',
    '练习': 'Practice',
    '提交检查': 'Check',
    '输入一句你写的句子，AI 会帮你检查语法...': 'Write a sentence and the AI will check your grammar…',
    '🎁 非会员每天可免费体验 3 次 AI 语法批改，开通会员畅享无限次使用。':
      '🎁 Free plan includes 3 AI grammar checks per day. Go premium for unlimited.',

    // —— 美式口语 ——
    '地道美式口语': 'Everyday English',
    '日常最常用的美式口语表达，点击卡片查看例句和使用场景，点击 🔊 听发音。':
      'The expressions Americans actually use. Tap a card for examples, tap 🔊 to hear it.',
    '发音': 'Pronunciation',

    // —— 错题本 ——
    'AI 错题本': 'AI Mistake Log',
    '我的错题（': 'My mistakes (',
    '处）': ')',
    '📷 拍照 / 上传图片': '📷 Take a photo or upload',
    '点击拍照或从相册选择错题图片': 'Take a photo of the question, or pick one from your library',
    '电脑端可直接': 'On a computer you can also',
    '粘贴截图': 'paste a screenshot',
    '选择图片': 'Choose image',
    '🔍 AI 识别解析': '🔍 Read and explain',
    '⌨️ 打字输入': '⌨️ Type it in',
    '把错题打字输入进来，比如：题目内容 + 选项 + 你选的答案是什么，AI 会帮你整理分析...':
      'Type the question, the options and the answer you chose — the AI will break it down…',
    '🔍 AI 解析': '🔍 Explain',
    '还没有错题记录，上传第一道错题开始吧！': 'No mistakes saved yet — add your first one.',
    '🎁 非会员每天可免费体验 3 次错题解析，开通会员畅享无限次使用。':
      '🎁 Free plan includes 3 explanations per day. Go premium for unlimited.',
    '⚠️ 中国学生常见错误': '⚠️ Common mistake for Chinese learners',

    // —— 作文 ——
    'AI 作文助手': 'AI Essay Assistant',
    '把你写的作文粘贴或输入进来，AI 会逐句逐词批改，给出修改建议和整体点评...':
      'Paste or type your essay — the AI will review it line by line and give overall feedback…',
    '考试类型（可选，如 CET-4）': 'Exam type (optional, e.g. CET-4)',
    '考试类型（可选，如 CET-4 / 雅思）': 'Exam type (optional, e.g. CET-4 / IELTS)',
    '通用批改': 'General',
    '考研英语': 'Postgrad English',
    '🎯 针对性备考批改': '🎯 Exam-focused review',
    '✍️ AI 批改': '✍️ Review my essay',
    '预估分数': 'Estimated score',
    '评分细项': 'Score breakdown',
    '总体点评': 'Overall comments',
    '修改后全文': 'Revised version',
    '逐句逐词修改（': 'Line-by-line changes (',
    '🔤 语言使用：': '🔤 Language use: ',
    '🧩 结构与逻辑：': '🧩 Structure and logic: ',
    '📋 内容与任务完成度：': '📋 Content and task completion: ',
    '🎁 非会员每天可免费体验 3 次 AI 作文批改，开通会员畅享无限次使用。':
      '🎁 Free plan includes 3 essay reviews per day. Go premium for unlimited.',

    // —— 我的 / 账号 ——
    '我的头像': 'Your avatar',
    '上传照片': 'Upload a photo',
    '恢复默认': 'Reset',
    '昵称': 'Nickname',
    '怎么称呼你': 'What should we call you?',
    '保存设置': 'Save',
    '退出登录': 'Sign out',
    '手机号': 'Phone number',
    '验证码': 'Code',
    '获取验证码': 'Send code',
    '验证并绑定': 'Verify',
    '请输入11位手机号': 'Enter your phone number',
    '6位验证码': '6-digit code',
    '✅ 已验证手机号': '✅ Phone verified',
    '🎁 未验证手机号的账号暂不提供每日免费体验额度（AI对话/作文批改/错题本），验证后即可解锁。':
      '🎁 Daily free credits (chat, essay review, mistake log) unlock once you verify your phone number.',
    '直接开通会员': 'Activate membership',
    '去支付': 'Pay',
    '💚 微信支付': '💚 WeChat Pay',
    '💙 支付宝': '💙 Alipay',
    '解锁 AI 1对1 对话、作文批改、错题解析全部功能':
      'Unlock one-on-one chat, essay review and mistake explanations',
    '当前为演示版，暂未接入真实支付，可免费开通体验。':
      'This is a demo — no real payment is taken, activation is free.',
    '开通会员': 'Go premium',

    // —— 登录 / 注册 ——
    '登录 / 注册': 'Sign in',
    '账号登录': 'Password',
    '手机号登录': 'Phone',
    '登录继续你的语言学习之旅': 'Sign in to keep learning',
    '用户名': 'Username',
    '密码': 'Password',
    '新密码': 'New password',
    '登录': 'Sign in',
    '立即注册': 'Create one',
    '创建账号': 'Create account',
    '还没有账号？': 'No account yet?',
    '其他方式登录': 'Or continue with',
    '微信登录': 'WeChat',
    'QQ登录': 'QQ',
    '3-30位字符': '3–30 characters',
    '至少6位': 'At least 6 characters',
    '昵称（可选）': 'Nickname (optional)',
    '不填则默认用用户名': 'Defaults to your username',
    '取消': 'Cancel',
    '关闭': 'Close',
    '清空': 'Clear',
    '其他': 'Other',

    // —— 管理后台 ——
    '注册用户': 'Users',
    '会员数': 'Members',
    '累计AI对话': 'Total chats',
    '累计错题': 'Total mistakes',
    '今日新增': 'New today',
    '近7天新增': 'New this week',
    '用户数': 'Users',
    '用户列表': 'Users',
    '➕ 新增用户': '➕ Add user',
    '新增用户': 'Add user',
    '管理员手动创建账号，跳过手机验证': 'Created by an admin — skips phone verification',
    '最近登录': 'Recent sign-ins',
    '全部动态': 'All activity',
    '只看登录': 'Sign-ins only',
    '只看登出': 'Sign-outs only',
    '只看新注册': 'New sign-ups only',
    '过去 24 小时': 'Last 24 hours',
    '过去 3 天': 'Last 3 days',
    '过去 7 天': 'Last 7 days',
    '过去 30 天': 'Last 30 days',
    '全部状态': 'All',
    '只保留最近 50 条。Cookie 到期导致的自动掉线不会产生登出记录，所以登录条数通常多于登出。':
      'Only the last 50 events are kept. Sessions that expire on their own don’t produce a sign-out, so sign-ins usually outnumber sign-outs.',
    '注册地区分布': 'Sign-ups by region',
    '地区': 'Region',
    '注册归属地': 'Region',
    '注册公网IP': 'Public IP',
    '来源 IP': 'Source IP',
    '运营商': 'Carrier',
    '注册时间': 'Signed up',
    '开始于': 'Started',
    '最近登出': 'Last sign-out',
    '会员': 'Member',
    '状态': 'Status',
    '时间': 'Time',
    '用户': 'User',
    '动作': 'Action',
    '方式': 'Method',
    '操作': 'Actions',
    '错题数': 'Mistakes',
    '登录记录': 'Sign-in history',
    '重置密码': 'Reset password',
    '确认重置': 'Reset',
    'AI 视频通话用量（本月）': 'AI video usage (this month)',

    // —— 报错兜底 ——
    '⚠️ 页面加载出错': '⚠️ Something went wrong',
    '把下面这段发给开发者即可定位问题。': 'Send the text below to the developer to help track it down.',
    'LangBuddy 语伴 - AI 1对1语言学习': 'LangBuddy — One-on-One AI Language Learning',
  };

  var dict = { zh: {}, en: EN };

  // 站点默认语言由服务端注入（英语站 zh、西语站 en）。
  // 用户自己选过就听用户的，永远优先于站点默认。
  var SITE_LANG = (window.__SITE__ && window.__SITE__.uiLang === 'en') ? 'en' : 'zh';
  function readLang() {
    try {
      var v = localStorage.getItem(LANG_KEY);
      if (v === 'en' || v === 'zh') return v;
    } catch (e) { /* 隐私模式读不到，用站点默认 */ }
    return SITE_LANG;
  }
  var current = readLang();

  /// 翻译一段中文。查不到就原样返回——漏翻只是那一处还是中文，页面不会坏。
  function t(zh) {
    if (current === 'zh') return zh;
    var d = dict[current] || {};
    return Object.prototype.hasOwnProperty.call(d, zh) ? d[zh] : zh;
  }

  /// 把静态页面上标了 data-i18n 的地方翻一遍。
  /// 属性单独标（data-i18n-placeholder 之类），因为一个元素可能既有文本又有 placeholder。
  function applyI18n(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var txt = t(el.getAttribute('data-i18n'));
      // 不能直接写 textContent：有的元素里还嵌着东西
      //（"欢迎回来，<span id=dashNickname>"、"还没有账号？<a>立即注册</a>"），
      // 覆盖 textContent 会把这些子元素连同它们的 id 一起抹掉，
      // 后面 JS 再去 getElementById 就取不到了，页面直接坏给你看。
      // 只改第一个非空文本节点，子元素原样留着。
      var first = null;
      for (var k = 0; k < el.childNodes.length; k++) {
        var n = el.childNodes[k];
        if (n.nodeType === 3 && n.nodeValue.trim()) { first = n; break; }
      }
      if (first) first.nodeValue = txt;
      else el.textContent = txt;
    }
    ['placeholder', 'title', 'aria-label'].forEach(function (attr) {
      var sel = '[data-i18n-' + attr + ']';
      var list = scope.querySelectorAll(sel);
      for (var j = 0; j < list.length; j++) {
        list[j].setAttribute(attr, t(list[j].getAttribute('data-i18n-' + attr)));
      }
    });
    document.documentElement.lang = current === 'en' ? 'en' : 'zh-CN';
  }

  function setLang(lang) {
    current = lang === 'en' ? 'en' : 'zh';
    try { localStorage.setItem(LANG_KEY, current); } catch (e) { /* 存不了就只在本次生效 */ }
    // 整页重新加载最稳妥：界面上有大量 JS 动态生成的文字，
    // 挨个去重绘容易漏，而语言切换本来就是低频操作，重载一次可以接受。
    location.reload();
  }

  window.LBI18n = { t: t, apply: applyI18n, get lang() { return current; }, setLang: setLang };
  window.t = t;

  function wireToggle() {
    var box = document.getElementById('langToggle');
    if (!box) return;
    var opts = box.querySelectorAll('.lang-opt');
    for (var i = 0; i < opts.length; i++) {
      (function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === current);
        btn.addEventListener('click', function () {
          if (btn.getAttribute('data-lang') === current) return;   // 点当前语言不用重载
          setLang(btn.getAttribute('data-lang'));
        });
      })(opts[i]);
    }
  }

  // 静态文案在 DOM 就绪时先翻一遍，别等 app.js 起来才翻，否则会闪一下中文
  function boot() { applyI18n(); wireToggle(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
