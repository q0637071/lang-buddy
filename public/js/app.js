(function () {
  'use strict';

  const state = {
    user: null,
    languages: [],
    chatHistory: [],
    vocabQueue: [],
    vocabIndex: 0,
    vocabStats: null,
    vocabLevel: '',
    vocabMode: 'review',
    vocabBrowseWords: [],
    vocabSearch: '',
    vocabStatusF: '',
    grammarLessons: [],
    currentGrammarId: null,
    authMode: 'login',
    autoSpeak: true,
    voiceCallActive: false,
    chatInputLang: 'zh',
    chatReplyLang: 'en',
    mistakes: [],
    mistakeFile: null,
    mistakeFilter: { category: '' },
    quiz: { questions: [], index: 0, score: 0, active: false },
    voiceErrorStreak: 0,
    chatHistoryLoaded: false,
    avatarStyle: 'ghost',
  };

  const LEVEL_ZH = { beginner: '初级', intermediate: '中级', advanced: '高级' };
  const VOCAB_LEVEL_ZH = { cet4: '四级', cet6: '六级', kaoyan: '考研', toefl: '托福', gre: 'GRE' };
  const VOCAB_STATUS_ZH = { new: '未学', learning: '学习中', known: '已掌握' };
  const LANG_BCP47 = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

  // ---------- 工具函数 ----------
  const $ = (sel) => document.querySelector(sel);
  const $all = (sel) => Array.from(document.querySelectorAll(sel));

  // iOS Safari 隐私浏览模式下 localStorage.setItem 会直接抛异常（配额为0），
  // 如果不接住会导致调用它的函数在那一行整个中断、后面的代码根本不会执行——
  // 之前头像切换在苹果手机上完全没反应，根源就是这个。全部改用这两个安全封装。
  function safeGetItem(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 存不进去就算了，不影响当次使用 */ }
  }

  // 打包成App（Capacitor）后，页面是从本地加载的，源是 capacitor://localhost 或 http://localhost，
  // 得把请求打到线上域名；同时这种跨站场景下浏览器不会发送 cookie，所以改用 token 认证。
  // 网页端正常访问时 location.origin 就是自己的域名，走原来的同源+cookie 逻辑，行为完全不变。
  // 优先用 Capacitor 注入的全局判断（最可靠），拿不到再退回看协议
  const IS_NATIVE_APP = (() => {
    try {
      if (window.Capacitor?.isNativePlatform?.()) return true;
    } catch {}
    return location.protocol === 'capacitor:' || location.protocol === 'ionic:';
  })();
  // App 里默认打到线上；调试时可以在 index.html 之前设 window.LANGBUDDY_API_BASE 指向本地服务器
  const API_BASE = IS_NATIVE_APP
    ? (window.LANGBUDDY_API_BASE || 'https://langbuddy.org/api')
    : '/api';
  const TOKEN_KEY = 'lb_auth_token';

  function getAuthToken() { return safeGetItem(TOKEN_KEY); }
  function setAuthToken(t) {
    if (t) safeSetItem(TOKEN_KEY, t);
  }
  function clearAuthToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    // 必须有超时：手机网络一抖动，fetch 可能永远挂着既不成功也不失败，
    // 界面就会卡在"发送中"再无任何反馈（用户感受就是"点了没反应"）。
    // AI 生成本身比较慢，所以给的时间比普通接口宽裕。
    const timeoutMs = options.timeoutMs || 45000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(API_BASE + path, {
        method: options.method || 'GET',
        headers,
        credentials: 'include',
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('网络较慢，请求超时了，请重试');
      throw new Error('网络连接失败，请检查网络后重试');
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || '请求失败');
      err.needMembership = data.needMembership;
      err.needPhoneVerify = data.needPhoneVerify;
      throw err;
    }
    // 登录/注册类接口会在响应里带回 token，存下来供 App 后续请求使用
    if (data.token) setAuthToken(data.token);
    return data;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function inputLangBcp47() {
    return LANG_BCP47[state.chatInputLang] || 'zh-CN';
  }
  function replyLangBcp47() {
    return LANG_BCP47[state.chatReplyLang] || 'en-US';
  }

  // ---------- 视图切换 ----------
  const VIEWS = ['landing', 'dashboard', 'tutor', 'vocab', 'grammar', 'colloquial', 'mistakes', 'essay', 'profile', 'admin'];

  function showView(name) {
    if (!state.user && name !== 'landing') name = 'landing';
    if (name === 'admin' && !state.user?.isAdmin) name = 'dashboard';
    if (name !== 'tutor' && state.voiceCallActive) stopVoiceCall();
    VIEWS.forEach(v => {
      $('#view-' + v).hidden = v !== name;
    });
    $all('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.nav === name));
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    if (name === 'dashboard') renderDashboard();
    if (name === 'tutor') renderTutor();
    if (name === 'vocab') {
      state.vocabMode = 'review';
      $all('#vocabModeToggle .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === 'review'));
      $('#btnStartQuiz').hidden = false;
      loadVocabQueue();
    }
    if (name === 'grammar') renderGrammarList();
    if (name === 'colloquial') renderColloquial();
    if (name === 'mistakes') renderMistakes();
    if (name === 'essay') renderEssay();
    if (name === 'profile') renderProfile();
    if (name === 'admin') renderAdmin();
  }

  $all('[data-nav]').forEach(el => {
    el.addEventListener('click', () => showView(el.dataset.nav));
  });

  // ---------- 登录状态渲染 ----------
  // 未登录时唯一能看到的页面就是落地页，落地页顶部的大按钮（免费开始学习/已有账号登录）
  // 已经覆盖了登录/注册两个入口，顶栏这里不用再重复放一遍同样功能的小按钮
  function rebuildAuthButtons() {
    $('#authArea').innerHTML = '';
  }

  function renderLoggedInTopbar() {
    const nav = $('#mainNav');
    const authArea = $('#authArea');
    nav.hidden = false;
    $('#navAdmin').hidden = !state.user.isAdmin;
    authArea.innerHTML = `<span style="font-size:14px;color:var(--text-muted);margin-right:4px;">👤 ${escapeHtml(state.user.nickname)}</span>`;
  }

  function updateTopbar() {
    if (state.user) {
      renderLoggedInTopbar();
    } else {
      $('#mainNav').hidden = true;
      rebuildAuthButtons();
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  // ---------- 认证弹窗 ----------
  function openAuthModal(mode) {
    state.authMode = mode;
    $('#authModalOverlay').hidden = false;
    $('#authError').textContent = '';
    setAuthMode(mode);
    renderOAuthButtons();
  }

  // 只显示后端真正配好了密钥的第三方登录入口，没配的直接不显示，
  // 避免用户点了才发现"暂未开通"
  let oauthChecked = false;
  async function renderOAuthButtons() {
    if (oauthChecked) return;
    oauthChecked = true;
    try {
      const a = await api('/auth/oauth/available');
      $('#btnLoginWechat').hidden = !a.wechat;
      $('#btnLoginQQ').hidden = !a.qq;
      $('#oauthBlock').hidden = !(a.wechat || a.qq);
    } catch { /* 拿不到就保持隐藏 */ }
  }

  async function startOAuthLogin(provider) {
    try {
      const data = await api(`/auth/${provider}/login-url`);
      window.location.href = data.url;
    } catch (err) {
      toast(err.message);
    }
  }
  $('#btnLoginWechat').addEventListener('click', () => startOAuthLogin('wechat'));
  $('#btnLoginQQ').addEventListener('click', () => startOAuthLogin('qq'));
  function closeAuthModal() {
    $('#authModalOverlay').hidden = true;
    $('#authForm').reset();
    $('#phoneForm').reset();
    $('#phoneCodeHint').textContent = '';
    $('#phoneError').textContent = '';
    $('#regPhoneCodeHint').textContent = '';
  }
  function setAuthMode(mode) {
    state.authMode = mode;
    // 登录和注册共用同一个"账号登录"标签页，靠表单底部的切换链接互相跳转，
    // 不再单独占一个标签，减少重复入口
    $('#tabLogin').classList.toggle('active', mode !== 'phone');
    $('#tabPhone').classList.toggle('active', mode === 'phone');
    $('#authForm').hidden = mode === 'phone';
    $('#phoneForm').hidden = mode !== 'phone';
    $('#rowNickname').hidden = mode !== 'register';
    // 注册必须绑定手机号验证码，防止一人靠不同用户名注册无数个账号刷免费额度
    $('#rowRegPhone').hidden = mode !== 'register';
    $('#rowRegCode').hidden = mode !== 'register';
    $('#inputRegPhone').required = mode === 'register';
    $('#inputRegCode').required = mode === 'register';
    $('#authSubmitBtn').textContent = mode === 'login' ? '登录' : '注册并进入';
    $('#authError').textContent = '';
    // 登录/注册用同一个密码输入框，autocomplete 提示要跟着切换，
    // 浏览器才会正确弹出"记住密码"（注册）或用已保存的密码自动填充（登录）
    $('#inputPassword').autocomplete = mode === 'register' ? 'new-password' : 'current-password';

    const titleEl = $('#authTitle');
    const subEl = $('#authSub');
    const switchLine = $('#authSwitchLine');
    if (mode === 'phone') {
      titleEl.textContent = '手机号登录';
      subEl.textContent = '未注册的手机号将自动创建新账号';
    } else if (mode === 'register') {
      titleEl.textContent = '创建账号';
      subEl.textContent = '开始你的语言学习之旅';
      switchLine.innerHTML = '已有账号？<a href="javascript:void(0)" id="linkAuthSwitch">去登录</a>';
    } else {
      titleEl.textContent = '欢迎回来';
      subEl.textContent = '登录继续你的语言学习之旅';
      switchLine.innerHTML = '还没有账号？<a href="javascript:void(0)" id="linkAuthSwitch">立即注册</a>';
    }
  }

  $('#modalClose').addEventListener('click', closeAuthModal);
  $('#authModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'authModalOverlay') closeAuthModal(); });
  $('#tabLogin').addEventListener('click', () => setAuthMode('login'));
  $('#tabPhone').addEventListener('click', () => setAuthMode('phone'));
  // 切换链接是每次 setAuthMode 时用 innerHTML 重新生成的，用事件委托绑在稳定的父表单上
  $('#authForm').addEventListener('click', (e) => {
    if (e.target.id === 'linkAuthSwitch') setAuthMode(state.authMode === 'login' ? 'register' : 'login');
  });

  $('#btnHeroLogin').addEventListener('click', () => openAuthModal('login'));
  $('#btnHeroRegister').addEventListener('click', () => openAuthModal('register'));
  $('#btnPricingRegister').addEventListener('click', () => openAuthModal('register'));

  document.body.addEventListener('click', (e) => {
    if (e.target.id === 'btnShowLogin') openAuthModal('login');
    if (e.target.id === 'btnShowRegister') openAuthModal('register');
  });

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#inputUsername').value.trim();
    const password = $('#inputPassword').value;
    const nickname = $('#inputNickname').value.trim();
    const errEl = $('#authError');
    errEl.textContent = '';
    try {
      let data;
      if (state.authMode === 'login') {
        data = await api('/login', { method: 'POST', body: { username, password } });
      } else {
        const phone = $('#inputRegPhone').value.trim();
        const code = $('#inputRegCode').value.trim();
        if (!/^1[3-9]\d{9}$/.test(phone)) { errEl.textContent = '请输入正确的11位手机号'; return; }
        if (!code) { errEl.textContent = '请输入验证码'; return; }
        data = await api('/register', { method: 'POST', body: { username, password, nickname, phone, code } });
      }
      state.user = data.user;
      await completeLogin(data.user, state.authMode === 'login' ? '欢迎回来！' : '注册成功，欢迎加入 LangBuddy！');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  async function completeLogin(user, message) {
    state.user = user;
    closeAuthModal();
    updateTopbar();
    await loadLanguages();
    showView('dashboard');
    toast(message);
  }

  // ---------- 手机验证码登录 ----------
  const phoneCountdownTimers = {};

  function startPhoneCountdown(btnId) {
    const btn = $('#' + btnId);
    let seconds = 60;
    btn.disabled = true;
    btn.textContent = `${seconds}秒后重发`;
    clearInterval(phoneCountdownTimers[btnId]);
    phoneCountdownTimers[btnId] = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(phoneCountdownTimers[btnId]);
        btn.disabled = false;
        btn.textContent = '获取验证码';
      } else {
        btn.textContent = `${seconds}秒后重发`;
      }
    }, 1000);
  }

  $('#btnSendCode').addEventListener('click', async () => {
    const phone = $('#inputPhone').value.trim();
    const errEl = $('#phoneError');
    const hintEl = $('#phoneCodeHint');
    errEl.textContent = '';
    if (!/^1[3-9]\d{9}$/.test(phone)) { errEl.textContent = '请输入正确的11位手机号'; return; }
    try {
      const data = await api('/auth/phone/send-code', { method: 'POST', body: { phone } });
      startPhoneCountdown('btnSendCode');
      hintEl.textContent = data.devCode
        ? `测试模式（未接入真实短信服务）：验证码是 ${data.devCode}`
        : '验证码已发送，请查收短信';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // 注册表单里的"获取验证码"，复用同一个发送验证码接口
  $('#btnRegSendCode').addEventListener('click', async () => {
    const phone = $('#inputRegPhone').value.trim();
    const errEl = $('#authError');
    const hintEl = $('#regPhoneCodeHint');
    errEl.textContent = '';
    if (!/^1[3-9]\d{9}$/.test(phone)) { errEl.textContent = '请输入正确的11位手机号'; return; }
    try {
      const data = await api('/auth/phone/send-code', { method: 'POST', body: { phone } });
      startPhoneCountdown('btnRegSendCode');
      hintEl.textContent = data.devCode
        ? `测试模式（未接入真实短信服务）：验证码是 ${data.devCode}`
        : '验证码已发送，请查收短信';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  $('#phoneForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = $('#inputPhone').value.trim();
    const code = $('#inputPhoneCode').value.trim();
    const errEl = $('#phoneError');
    errEl.textContent = '';
    try {
      const data = await api('/auth/phone/verify', { method: 'POST', body: { phone, code } });
      await completeLogin(data.user, '登录成功！');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // ---------- Dashboard ----------
  async function renderDashboard() {
    if (!state.user) return;
    $('#dashNickname').textContent = state.user.nickname;
    $('#dashMemberStatus').textContent = state.user.isMember ? '✅ 会员' : '未开通';
    $('#btnDashUpgrade').hidden = !!state.user.isMember;
    $('#dashLang').textContent = langName(state.user.targetLang);
    $('#dashLevel').textContent = LEVEL_ZH[state.user.level] || '初级';
    try {
      const data = await api('/vocab/review');
      $('#dashDueWords').textContent = data.words.length;
    } catch { $('#dashDueWords').textContent = '-'; }
    renderMetrics();
  }

  async function renderMetrics() {
    try {
      const m = await api('/metrics');
      $('#metricStreak').textContent = m.streakDays;
      $('#metricVocabMastered').textContent = m.vocab.known;
      $('#metricMistakes').textContent = m.mistakes.total;
      $('#metricChat').textContent = m.chatCount;
      const pct = m.vocab.total ? Math.round((m.vocab.known / m.vocab.total) * 100) : 0;
      $('#vocabProgressFill').style.width = pct + '%';
      $('#vocabProgressText').textContent = `${m.vocab.known} / ${m.vocab.total}（${pct}%）`;
    } catch (err) {
      toast(err.message);
    }
  }

  $('#btnDashUpgrade').addEventListener('click', upgradeMembership);

  // 打开套餐选择弹窗；未接入支付时后端会直接返回 demo:true 免费开通，行为跟以前一样
  async function upgradeMembership() {
    try {
      const data = await api('/membership/plans');
      renderPayPlans(data);
      $('#payOverlay').hidden = false;
    } catch (err) {
      toast(err.message);
    }
  }

  function renderPayPlans(data) {
    state.payPlans = data.plans;
    state.payEnabled = data.payEnabled;
    $('#payPlanList').innerHTML = data.plans.map((p, i) => `
      <button type="button" class="pay-plan${i === 0 ? ' active' : ''}" data-plan="${escapeHtml(p.id)}">
        <span class="pay-plan-name">${escapeHtml(p.name.replace('LangBuddy ', ''))}</span>
        <span class="pay-plan-price">¥${escapeHtml(p.price)}</span>
        <span class="pay-plan-days">${p.days} 天</span>
      </button>
    `).join('');
    $('#payMethods').hidden = !data.payEnabled;
    $('#payDemoHint').hidden = data.payEnabled;
    $('#paySubmitBtn').textContent = data.payEnabled ? '去支付' : '免费开通（演示版）';
  }

  $('#payPlanList').addEventListener('click', (e) => {
    const btn = e.target.closest('.pay-plan');
    if (!btn) return;
    $all('#payPlanList .pay-plan').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
  $('#payMethods').addEventListener('click', (e) => {
    const btn = e.target.closest('.pay-method');
    if (!btn) return;
    $all('#payMethods .pay-method').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
  $('#payClose').addEventListener('click', () => { $('#payOverlay').hidden = true; });
  $('#payOverlay').addEventListener('click', (e) => { if (e.target.id === 'payOverlay') $('#payOverlay').hidden = true; });

  $('#paySubmitBtn').addEventListener('click', async () => {
    const plan = $('#payPlanList .pay-plan.active')?.dataset.plan;
    const payType = $('#payMethods .pay-method.active')?.dataset.method || 'alipay';
    if (!plan) { toast('请选择套餐'); return; }
    try {
      const data = await api('/membership/create-order', { method: 'POST', body: { plan, payType } });
      if (data.demo) {
        state.user = data.user;
        $('#payOverlay').hidden = true;
        toast('🎉 会员开通成功！');
        showView(currentViewName());
        return;
      }
      // 跳到收银台付款；付款完成后用户会被带回本站，这里同时开始轮询确认到账
      window.location.href = data.payUrl;
    } catch (err) {
      toast(err.message);
    }
  });

  function currentViewName() {
    return VIEWS.find(v => !$('#view-' + v).hidden) || 'dashboard';
  }

  function langName(code) {
    const found = state.languages.find(l => l.code === code);
    return found ? found.name : '英语';
  }

  async function loadLanguages() {
    const data = await api('/meta/languages');
    state.languages = data.languages;

    // "目标语言"（我要学的语言）不包含中文
    const learnable = state.languages.filter(l => l.code !== 'zh');
    const sel = $('#profileLang');
    sel.innerHTML = learnable.map(l => `<option value="${l.code}">${l.name}</option>`).join('');

    // 对话页的输入/回复语言选择器，包含中文
    const inputSel = $('#chatInputLang');
    const replySel = $('#chatReplyLang');
    const allOptions = state.languages.map(l => `<option value="${l.code}">${l.name}</option>`).join('');
    inputSel.innerHTML = allOptions;
    replySel.innerHTML = allOptions;
  }

  // ---------- AI 对话 (Tutor) ----------
  let recognition = null;
  let recognizing = false;
  let voiceRetryTimer = null; // 语音对话模式里排队等待重试的定时器，结束通话时要一并清掉，避免"停不下来"
  let speakSafetyTimer = null; // 朗读的兜底超时：部分安卓机型 onend/onerror 从不触发，靠这个定时器强制续上
  let recognitionSafetyTimer = null; // 听写的兜底超时：部分安卓机型（尤其OPPO/ColorOS）连不上语音识别服务时onresult/onerror都不触发，只能靠这个强制打断

  async function renderTutor() {
    $('#tutorPaywall').hidden = state.user.isMember;
    $('#tutorPanel').hidden = false;

    const toggle = $('#autoSpeakToggle');
    toggle.checked = state.autoSpeak;
    toggle.onchange = () => { state.autoSpeak = toggle.checked; };

    // 第一次进入这个页面时，把上次登录留下的对话记录从服务端接回来接着聊
    if (!state.chatHistoryLoaded) {
      state.chatHistoryLoaded = true;
      try {
        const data = await api('/chat/history');
        if (Array.isArray(data.history) && data.history.length) {
          state.chatHistory = data.history;
          replayChatHistory(data.history);
        }
      } catch { /* 拿不到历史记录不影响正常使用，忽略即可 */ }
    }

    const inputSel = $('#chatInputLang');
    const replySel = $('#chatReplyLang');
    if (state.chatHistory.length === 0) state.chatReplyLang = state.user.targetLang;
    inputSel.value = state.chatInputLang;
    replySel.value = state.chatReplyLang;
    inputSel.onchange = () => { state.chatInputLang = inputSel.value; };
    replySel.onchange = () => { state.chatReplyLang = replySel.value; populateVoiceSelect(); };

    if (state.chatHistory.length === 0) {
      const langN = langName(state.chatReplyLang);
      appendMsg('ai', `你好！我是你的${langN}私教 👋 我们可以用打字或语音练习对话，随时开始吧！`);
    }
    setupSpeech();
    populateVoiceSelect();
  }

  // ---------- AI 朗读音色选择 ----------
  let availableVoices = [];

  function loadVoiceList() {
    if (!window.speechSynthesis) return;
    availableVoices = window.speechSynthesis.getVoices();
    if (!$('#view-tutor').hidden) populateVoiceSelect();
  }
  if (window.speechSynthesis) {
    loadVoiceList();
    window.speechSynthesis.onvoiceschanged = loadVoiceList;
  }

  function voicePrefKey(lang) { return 'lb_voice_' + lang; }

  // iOS/macOS 系统自带一批"搞怪音效"语音（气泡音、金属音、风琴音等），并非正常人声，
  // 学语言用不上，默认从候选列表里过滤掉。voice.name 在系统语言为中文时会被本地化成中文
  // （比如"气泡"），单纯匹配英文名会失效，所以额外用 voiceURI（不受系统语言影响，始终是
  // 英文技术标识符，如 com.apple.speech.synthesis.voice.bubbles）做兜底匹配
  const NOVELTY_VOICE_KEYWORDS = [
    'albert', 'badnews', 'bad-news', 'bad news', 'bahh', 'bells', 'boing', 'bubbles',
    'cellos', 'goodnews', 'good-news', 'good news', 'jester', 'organ', 'superstar',
    'trinoids', 'whisper', 'wobble', 'zarvox', 'deranged', 'hysterical', 'pipeorgan', 'pipe organ',
  ];
  function isNoveltyVoice(v) {
    const haystack = (v.name + ' ' + (v.voiceURI || '')).toLowerCase();
    return NOVELTY_VOICE_KEYWORDS.some(kw => haystack.includes(kw));
  }

  function populateVoiceSelect() {
    const select = $('#voiceSelect');
    if (!select) return;
    const lang = replyLangBcp47();
    const langPrefix = lang.split('-')[0];
    const matching = availableVoices.filter(v => v.lang.toLowerCase().startsWith(langPrefix));
    let list = matching.length ? matching : availableVoices;
    const naturalOnly = list.filter(v => !isNoveltyVoice(v));
    if (naturalOnly.length) list = naturalOnly;

    if (!list.length) {
      select.innerHTML = '<option value="">（当前设备没有可用的语音包）</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const saved = safeGetItem(voicePrefKey(lang));
    select.innerHTML = list.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name.replace(/^Microsoft /, ''))}</option>`).join('');
    if (saved && list.some(v => v.name === saved)) select.value = saved;
  }

  $('#voiceSelect').addEventListener('change', () => {
    const lang = replyLangBcp47();
    safeSetItem(voicePrefKey(lang), $('#voiceSelect').value);
  });

  $('#btnPreviewVoice').addEventListener('click', () => {
    const sample = { zh: '你好，我是你的语言私教。', en: 'Hello, I am your language tutor.', ja: 'こんにちは、私はあなたの語学の先生です。', ko: '안녕하세요, 저는 당신의 언어 선생님입니다.', fr: 'Bonjour, je suis votre professeur de langue.', de: 'Hallo, ich bin dein Sprachlehrer.', es: 'Hola, soy tu profesor de idiomas.' };
    speakText(sample[state.chatReplyLang] || sample.en);
  });

  function getPreferredVoice(lang) {
    const name = safeGetItem(voicePrefKey(lang));
    if (!name) return null;
    return availableVoices.find(v => v.name === name) || null;
  }

  $('#btnTutorUpgrade').addEventListener('click', upgradeMembership);
  $('#btnGrammarUpgrade').addEventListener('click', async () => { await upgradeMembership(); renderGrammarDetail(state.currentGrammarId); });

  function buildMsgEl(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-ai');
    div.textContent = text;
    if (role === 'ai') {
      const speak = document.createElement('span');
      speak.className = 'msg-speak';
      speak.textContent = '🔊';
      speak.title = '朗读';
      speak.addEventListener('click', () => speakText(text));
      div.appendChild(speak);
    }
    return div;
  }

  function appendMsg(role, text, opts = {}) {
    state.chatHistory.push({ role, content: text });
    const win = $('#chatWindow');
    win.appendChild(buildMsgEl(role, text));
    win.scrollTop = win.scrollHeight;
    if (role === 'ai' && state.autoSpeak) {
      speakText(text, null, opts.onSpeakEnd);
    } else if (opts.onSpeakEnd) {
      opts.onSpeakEnd();
    }
  }

  // 把服务端存的历史对话原样铺回聊天窗口（不重新入队 state.chatHistory，也不触发自动朗读）
  function replayChatHistory(history) {
    const win = $('#chatWindow');
    win.innerHTML = '';
    history.forEach(({ role, content }) => win.appendChild(buildMsgEl(role, content)));
    win.scrollTop = win.scrollHeight;
  }

  // 打字对话时的"AI 正在输入"气泡。之前只有语音模式有状态提示，
  // 打字模式发出去后界面完全不动，AI 慢几秒用户就以为卡死了。
  function showTypingBubble() {
    const win = $('#chatWindow');
    if (document.getElementById('chatTyping')) return;
    const div = document.createElement('div');
    div.className = 'msg msg-ai msg-typing';
    div.id = 'chatTyping';
    div.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    win.appendChild(div);
    win.scrollTop = win.scrollHeight;
  }
  function hideTypingBubble() {
    document.getElementById('chatTyping')?.remove();
  }

  // 出错时除了 toast，还在对话流里留一条提示。toast 两秒就消失了，
  // 用户如果正好没看到，就只会觉得"发出去石沉大海"
  function appendChatError(text) {
    const win = $('#chatWindow');
    const div = document.createElement('div');
    div.className = 'msg msg-ai msg-error';
    div.textContent = '⚠️ ' + text;
    win.appendChild(div);
    win.scrollTop = win.scrollHeight;
  }

  async function sendChatMessage(message) {
    appendMsg('user', message);
    $('#chatSendBtn').disabled = true;
    showTypingBubble();
    if (state.voiceCallActive) setCallStatus('thinking', '💭 AI 正在思考...');
    try {
      const data = await api('/chat', {
        method: 'POST',
        body: {
          message,
          history: state.chatHistory.slice(0, -1),
          inputLang: state.chatInputLang,
          replyLang: state.chatReplyLang,
        },
      });
      hideTypingBubble();
      appendMsg('ai', data.reply, {
        onSpeakEnd: () => { if (state.voiceCallActive) listenTurn(); },
      });
      if (state.voiceCallActive) setCallStatus('speaking', '🔊 AI 正在说话...');
    } catch (err) {
      hideTypingBubble();
      if (err.needMembership) {
        toast('需要开通会员才能继续对话');
        appendChatError('今日免费体验时长已用完，开通会员可无限畅聊');
        stopVoiceCall();
        renderTutor();
      } else if (err.needPhoneVerify) {
        toast(err.message);
        appendChatError(err.message);
        stopVoiceCall();
        showView('profile');
      } else {
        toast(err.message);
        appendChatError(err.message + '（可以直接再发一次试试）');
        if (state.voiceCallActive) setCallStatus('error', '⚠️ 出错了，点击麦克风图标重试');
      }
    } finally {
      $('#chatSendBtn').disabled = false;
    }
  }

  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    unlockSpeechSynthesis();
    const input = $('#chatInput');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    sendChatMessage(message);
  });

  $('#btnClearChat').addEventListener('click', async () => {
    if (!confirm('确定要清空所有对话记录吗？此操作无法撤销。')) return;
    try {
      await api('/chat/clear', { method: 'POST' });
      state.chatHistory = [];
      $('#chatWindow').innerHTML = '';
      const langN = langName(state.chatReplyLang);
      appendMsg('ai', `你好！我是你的${langN}私教 👋 我们可以用打字或语音练习对话，随时开始吧！`);
      toast('对话记录已清空');
    } catch (err) {
      toast(err.message);
    }
  });

  function setupSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = $('#micBtn');
    const hint = $('#voiceHint');
    const voiceCallBtn = $('#btnVoiceCall');
    if (!SpeechRecognition) {
      micBtn.disabled = true;
      voiceCallBtn.disabled = true;
      hint.textContent = '当前浏览器不支持语音识别，建议使用 Chrome 浏览器（语音朗读功能仍可用）。';
      return;
    }
    hint.textContent = '点击麦克风单次语音输入，或开启"语音对话模式"实现连续免手动对话。';
    micBtn.disabled = false;
    voiceCallBtn.disabled = false;
    micBtn.onclick = () => {
      if (recognizing) {
        recognition && recognition.stop();
        return;
      }
      recognition = new SpeechRecognition();
      recognition.lang = inputLangBcp47();
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => { recognizing = true; micBtn.classList.add('recording'); };
      recognition.onend = () => { recognizing = false; micBtn.classList.remove('recording'); };
      recognition.onerror = (event) => {
        recognizing = false;
        micBtn.classList.remove('recording');
        toast(recognitionErrorMessage(event.error));
      };
      recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        $('#chatInput').value = text;
      };
      recognition.start();
    };
  }

  function recognitionErrorMessage(error) {
    const messages = {
      'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏允许访问麦克风后重试',
      'no-speech': '没有检测到语音，请靠近麦克风再说一次',
      'audio-capture': '未检测到麦克风设备',
      'network': '语音识别服务连接失败（该功能依赖浏览器自带的在线语音识别，国内网络下常不稳定），建议改用打字输入',
      'timeout': '长时间没有识别结果（部分安卓浏览器无法连接语音识别服务），建议改用打字输入',
    };
    return messages[error] || '语音识别出错，请重试';
  }

  // ---------- 语音对话模式（免手动，连续对话） ----------
  function setCallStatus(kind, text) {
    const el = $('#callStatusIndicator');
    el.textContent = text;
    el.className = 'call-status-indicator ' + kind;

    const avatar = $('#aiAvatar');
    const status = $('#avatarStatus');
    if (avatar && kind !== 'speaking') {
      avatar.classList.remove('talking');
      avatar.classList.toggle('listening', kind === 'listening');
      avatar.classList.toggle('idle', kind !== 'listening');
      if (status) status.textContent = kind === 'listening' ? '正在听你说...' : kind === 'thinking' ? '思考中...' : '待机中';
    }
  }

  // 统一处理一轮"聆听"失败（不管是原生onerror报的错，还是我们自己判定的超时/静默失败）
  function handleListenError(error) {
    if (!state.voiceCallActive) return;
    if (error === 'not-allowed' || error === 'audio-capture') {
      toast(recognitionErrorMessage(error) + '，已退出语音对话模式');
      stopVoiceCall();
      return;
    }
    if (error === 'no-speech') {
      state.voiceErrorStreak = 0;
      setCallStatus('listening', '🎙️ 没听到声音，请再说一次');
      voiceRetryTimer = setTimeout(() => { if (state.voiceCallActive) listenTurn(); }, 500);
      return;
    }
    // network/timeout 等错误连续出现多次时（常见于部分安卓机型无法连接浏览器自带的在线语音识别服务），
    // 不再无限重试刷屏报错，而是直接退出语音模式并给出明确提示，引导用户改用打字输入
    state.voiceErrorStreak++;
    if (state.voiceErrorStreak >= 3) {
      toast(recognitionErrorMessage(error) + '，已退出语音对话模式');
      state.voiceErrorStreak = 0;
      stopVoiceCall();
      return;
    }
    setCallStatus('error', '⚠️ ' + recognitionErrorMessage(error));
    voiceRetryTimer = setTimeout(() => { if (state.voiceCallActive) listenTurn(); }, 1500);
  }

  function listenTurn() {
    if (!state.voiceCallActive) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setCallStatus('listening', '🎙️ 正在聆听，请说话...');
    recognition = new SpeechRecognition();
    recognition.lang = inputLangBcp47();
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    // 部分安卓机型（尤其OPPO/ColorOS，国内版通常没有Google服务、连不上浏览器自带的
    // 在线语音识别后端）遇到这种情况时onresult/onerror都不触发，导致"正在聆听"卡死、
    // AI永远等不到用户说话也就永远不会回复。settled防止兜底定时器和原生回调重复处理同一轮。
    let settled = false;
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(recognitionSafetyTimer); fn(); };

    recognition.onresult = (event) => finish(() => {
      if (!state.voiceCallActive) return; // 用户已点击结束通话，忽略这次迟到的识别结果
      state.voiceErrorStreak = 0;
      const text = event.results[0][0].transcript.trim();
      if (text) {
        sendChatMessage(text);
      } else {
        voiceRetryTimer = setTimeout(listenTurn, 600);
      }
    });
    recognition.onerror = (event) => finish(() => handleListenError(event.error));
    // 静默失败：没报错也没识别到内容，直接就结束了——当一次"没听清"处理，避免卡死
    recognition.onend = () => finish(() => handleListenError('no-speech'));

    try {
      recognition.start();
    } catch {
      finish(() => handleListenError('timeout'));
      return;
    }

    clearTimeout(recognitionSafetyTimer);
    recognitionSafetyTimer = setTimeout(() => finish(() => {
      try { recognition.abort(); } catch { try { recognition.stop(); } catch {} }
      handleListenError('timeout');
    }), 10000);
  }

  // 部分安卓机型（含OPPO ColorOS浏览器）的朗读接口要求先在一次真实的用户点击里"预热"一次，
  // 后面异步触发（比如AI回复回来之后）才会正常出声，否则会一直无声。这里在语音相关按钮的
  // 首次点击里静默播放一个空白句子来解锁，只做一次。
  let speechUnlocked = false;
  function unlockSpeechSynthesis() {
    if (speechUnlocked || !window.speechSynthesis) return;
    speechUnlocked = true;
    try {
      const warmup = new SpeechSynthesisUtterance(' ');
      warmup.volume = 0;
      window.speechSynthesis.speak(warmup);
    } catch {}
  }

  function startVoiceCall() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { toast('当前浏览器不支持语音识别，无法使用语音对话模式'); return; }
    unlockSpeechSynthesis();
    state.voiceErrorStreak = 0;
    state.voiceCallActive = true;
    state.autoSpeak = true;
    $('#autoSpeakToggle').checked = true;
    $('#autoSpeakToggle').disabled = true;
    $('#chatForm').hidden = true;
    $('#callStatusBar').hidden = false;
    $('#btnVoiceCall').hidden = true;
    window.speechSynthesis.cancel();
    listenTurn();
  }

  function stopVoiceCall() {
    if (!state.voiceCallActive) return;
    state.voiceCallActive = false;
    clearTimeout(voiceRetryTimer);
    clearTimeout(speakSafetyTimer);
    clearTimeout(recognitionSafetyTimer);
    // 先立刻把界面和头像状态复原，不依赖 recognition/speechSynthesis 的回调是否真的触发
    // （部分安卓机型上这些回调不可靠，是"点了结束但停不下来"的根源）
    setAvatarTalking(false);
    if (recognition) { try { recognition.abort(); } catch { try { recognition.stop(); } catch {} } }
    try { window.speechSynthesis.cancel(); } catch {}
    $('#autoSpeakToggle').disabled = false;
    $('#chatForm').hidden = false;
    $('#callStatusBar').hidden = true;
    $('#btnVoiceCall').hidden = false;
  }

  $('#btnVoiceCall').addEventListener('click', startVoiceCall);
  $('#btnEndVoiceCall').addEventListener('click', stopVoiceCall);

  function speakText(text, lang, onEnd) {
    if (!window.speechSynthesis) {
      toast('当前浏览器不支持语音朗读');
      if (onEnd) onEnd();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang || replyLangBcp47();
    const preferredVoice = getPreferredVoice(utter.lang);
    if (preferredVoice) utter.voice = preferredVoice;
    let finished = false;
    let boundaryFired = false;
    const finish = () => {
      if (finished) return; // 避免 onend/onerror 和兜底定时器重复触发
      finished = true;
      clearTimeout(speakSafetyTimer);
      setAvatarTalking(false);
      if (onEnd) onEnd();
    };
    utter.onstart = () => {
      setAvatarTalking(true);
      // 给 boundary 事件一点时间触发；如果这个平台压根不支持/不触发它，就退回固定间隔动画，
      // 保证嘴型至少还在动，而不是整段话说完嘴巴都不张合
      setTimeout(() => { if (!boundaryFired && !finished) startFallbackMouthLoop(); }, 400);
    };
    utter.onboundary = (event) => {
      if (event.name && event.name !== 'word') return; // 只用词级别的边界，句子级的太粗
      boundaryFired = true;
      clearInterval(avatarMouthTimer); // 边界事件已经在正常触发，不需要兜底动画了
      setMouthShape(true);
      clearTimeout(mouthCloseTimer);
      mouthCloseTimer = setTimeout(() => setMouthShape(false), 130);
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
    // 兜底：部分安卓机型的 onend/onerror 完全不触发，会让语音对话卡住"停不下来"。
    // 按文字长度粗略估算朗读时长，超时还没结束就强制续上，保底至少4秒、最多20秒。
    const estimateMs = Math.min(20000, Math.max(4000, text.length * 220));
    clearTimeout(speakSafetyTimer);
    speakSafetyTimer = setTimeout(finish, estimateMs);
  }

  // ---------- AI 头像形象切换（萌怪 / 机器人 / 人像） ----------
  const AVATAR_STYLES = {
    ghost: {
      viewBox: '0 0 200 200',
      height: 128,
      transformOrigin: '100px 130px',
      mouth: { closed: { h: 4, y: 126, rx: 2 }, open: { h: 16, y: 120, rx: 6 } },
      markup: `
        <defs>
          <linearGradient id="avatarStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffd35c"/>
            <stop offset="100%" stop-color="#f5a623"/>
          </linearGradient>
          <linearGradient id="avatarFace" x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stop-color="#ffe28a"/>
            <stop offset="55%" stop-color="#ffc93c"/>
            <stop offset="100%" stop-color="#f5a11a"/>
          </linearGradient>
          <radialGradient id="avatarGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ffc93c" stop-opacity=".32"/>
            <stop offset="100%" stop-color="#ffc93c" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="avatarBall" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#fff2c4"/>
            <stop offset="100%" stop-color="#ffc93c"/>
          </radialGradient>
        </defs>
        <circle class="avatar-glow" cx="100" cy="112" r="98" fill="url(#avatarGlow)"/>
        <text class="avatar-sparkle avatar-sparkle-1" x="20" y="56" font-size="13">✨</text>
        <text class="avatar-sparkle avatar-sparkle-2" x="166" y="70" font-size="10">✨</text>
        <ellipse cx="100" cy="188" rx="52" ry="8" fill="#f5a11a" opacity=".18"/>
        <g class="avatar-head">
          <path d="M100 46 L100 62" stroke="url(#avatarStroke)" stroke-width="10" stroke-linecap="round"/>
          <circle cx="100" cy="34" r="17" fill="url(#avatarBall)" stroke="url(#avatarStroke)" stroke-width="2"/>
          <ellipse cx="94" cy="28" rx="6" ry="4" fill="#ffffff" opacity=".55"/>
          <path d="M148 128 Q172 118 168 96 Q182 112 172 132 Q162 144 148 138 Z" fill="url(#avatarFace)" stroke="url(#avatarStroke)" stroke-width="2.5"/>
          <path d="M52 138 Q34 142 34 158 Q22 148 28 130 Q36 120 48 124 Z" fill="url(#avatarFace)" stroke="url(#avatarStroke)" stroke-width="2.5" opacity=".9"/>
          <path d="M100 58 C142 58 168 88 168 128 L168 148 C168 148 158 172 146 150 C138 166 128 148 118 162 C110 174 100 156 90 162 C80 168 72 174 64 150 C52 172 42 148 42 128 C42 88 58 58 100 58 Z" fill="url(#avatarFace)" stroke="url(#avatarStroke)" stroke-width="3"/>
          <ellipse cx="72" cy="78" rx="24" ry="13" fill="#ffffff" opacity=".4"/>
          <ellipse cx="62" cy="118" rx="11" ry="7" fill="#ff8f6b" opacity=".45"/>
          <ellipse cx="138" cy="118" rx="11" ry="7" fill="#ff8f6b" opacity=".45"/>
          <g class="avatar-eye avatar-eye-l">
            <ellipse cx="80" cy="104" rx="7" ry="9" fill="#2a2418"/>
            <circle cx="82.5" cy="99" r="2" fill="#fff"/>
          </g>
          <g class="avatar-eye avatar-eye-r">
            <ellipse cx="120" cy="104" rx="7" ry="9" fill="#2a2418"/>
            <circle cx="122.5" cy="99" r="2" fill="#fff"/>
          </g>
          <rect id="avatarMouth" x="90" y="126" width="20" height="4" rx="2" fill="#2a2418"/>
        </g>`,
    },
    robot: {
      viewBox: '0 0 200 220',
      height: 141,
      transformOrigin: '100px 150px',
      mouth: { closed: { h: 5, y: 108, rx: 2.5 }, open: { h: 14, y: 103, rx: 4 } },
      markup: `
        <defs>
          <linearGradient id="avatarStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ff9ec4"/>
            <stop offset="100%" stop-color="#ff6fa8"/>
          </linearGradient>
          <radialGradient id="avatarFace" cx="32%" cy="20%" r="95%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="60%" stop-color="#fbf7fa"/>
            <stop offset="100%" stop-color="#f3e3ec"/>
          </radialGradient>
          <linearGradient id="avatarShoulder" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="100%" stop-color="#ffd6e6"/>
          </linearGradient>
          <radialGradient id="avatarGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ff9ec4" stop-opacity=".32"/>
            <stop offset="100%" stop-color="#ff9ec4" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="avatarEyeGlow" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#e6fff9"/>
            <stop offset="45%" stop-color="#5eead4"/>
            <stop offset="100%" stop-color="#14b8a6"/>
          </radialGradient>
          <linearGradient id="avatarScreen" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#333a63"/>
            <stop offset="100%" stop-color="#181c34"/>
          </linearGradient>
          <radialGradient id="avatarBall" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#ffe3ef"/>
            <stop offset="100%" stop-color="#ff6fa8"/>
          </radialGradient>
        </defs>
        <circle class="avatar-glow" cx="100" cy="112" r="100" fill="url(#avatarGlow)"/>
        <text class="avatar-sparkle avatar-sparkle-1" x="18" y="56" font-size="13">✨</text>
        <text class="avatar-sparkle avatar-sparkle-2" x="168" y="46" font-size="10">✨</text>
        <path d="M20 220 C22 178 48 158 78 154 L122 154 C152 158 178 178 180 220 Z" fill="url(#avatarShoulder)" stroke="url(#avatarStroke)" stroke-width="2.5"/>
        <path d="M84 156 Q100 172 116 156" fill="none" stroke="url(#avatarStroke)" stroke-width="2.5" opacity=".7"/>
        <circle cx="100" cy="196" r="7" fill="#fff" stroke="url(#avatarStroke)" stroke-width="2"/>
        <circle cx="100" cy="196" r="4.5" fill="url(#avatarEyeGlow)"/>
        <path d="M22 198 Q6 205 9 216" fill="none" stroke="url(#avatarStroke)" stroke-width="9" stroke-linecap="round"/>
        <circle cx="9" cy="217" r="8" fill="url(#avatarShoulder)" stroke="url(#avatarStroke)" stroke-width="2.5"/>
        <path d="M178 198 Q194 205 191 216" fill="none" stroke="url(#avatarStroke)" stroke-width="9" stroke-linecap="round"/>
        <circle cx="191" cy="217" r="8" fill="url(#avatarShoulder)" stroke="url(#avatarStroke)" stroke-width="2.5"/>
        <rect x="88" y="140" width="24" height="20" rx="8" fill="#f3e3ec"/>
        <g class="avatar-head">
          <path d="M100 38 L100 20" stroke="url(#avatarStroke)" stroke-width="4" stroke-linecap="round"/>
          <circle class="avatar-sparkle" cx="100" cy="16" r="9" fill="#ff9ec4" opacity=".25"/>
          <circle cx="100" cy="16" r="6" fill="url(#avatarBall)" stroke="#fff" stroke-width="1"/>
          <ellipse cx="36" cy="104" rx="15" ry="20" fill="url(#avatarStroke)"/>
          <ellipse cx="164" cy="104" rx="15" ry="20" fill="url(#avatarStroke)"/>
          <ellipse cx="33" cy="98" rx="7" ry="12" fill="#fff" opacity=".85"/>
          <ellipse cx="167" cy="98" rx="7" ry="12" fill="#fff" opacity=".85"/>
          <circle cx="36" cy="104" r="3" fill="#fff" opacity=".6"/>
          <circle cx="164" cy="104" r="3" fill="#fff" opacity=".6"/>
          <rect x="42" y="38" width="116" height="112" rx="42" fill="url(#avatarFace)" stroke="url(#avatarStroke)" stroke-width="3"/>
          <ellipse cx="76" cy="62" rx="26" ry="12" fill="#ffffff" opacity=".6"/>
          <path d="M52 128 Q100 148 148 128 L148 140 Q100 156 52 140 Z" fill="#ffd6e6" opacity=".4"/>
          <ellipse cx="55" cy="118" rx="10" ry="6" fill="#ff9ec4" opacity=".4"/>
          <ellipse cx="145" cy="118" rx="10" ry="6" fill="#ff9ec4" opacity=".4"/>
          <rect x="62" y="66" width="76" height="58" rx="26" fill="url(#avatarScreen)" stroke="#4a5085" stroke-width="1.5"/>
          <ellipse cx="82" cy="78" rx="18" ry="8" fill="#4a5085" opacity=".4"/>
          <g class="avatar-eye avatar-eye-l">
            <circle cx="84" cy="94" r="11" fill="#5eead4" opacity=".35"/>
            <circle cx="84" cy="94" r="9" fill="url(#avatarEyeGlow)"/>
            <circle cx="84" cy="94" r="4.5" fill="#e6fff9"/>
            <circle cx="81" cy="91" r="2.2" fill="#fff"/>
          </g>
          <g class="avatar-eye avatar-eye-r">
            <circle cx="116" cy="94" r="11" fill="#5eead4" opacity=".35"/>
            <circle cx="116" cy="94" r="9" fill="url(#avatarEyeGlow)"/>
            <circle cx="116" cy="94" r="4.5" fill="#e6fff9"/>
            <circle cx="113" cy="91" r="2.2" fill="#fff"/>
          </g>
          <rect id="avatarMouth" x="88" y="108" width="24" height="5" rx="2.5" fill="url(#avatarEyeGlow)"/>
        </g>`,
    },
    human: {
      viewBox: '0 0 200 220',
      height: 141,
      transformOrigin: '100px 172px',
      mouth: { closed: { h: 7, y: 146, rx: 3.5 }, open: { h: 22, y: 138, rx: 10 } },
      markup: `
        <defs>
          <linearGradient id="avatarStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="100%" stop-color="#cfe6f7"/>
          </linearGradient>
          <radialGradient id="avatarFace" cx="35%" cy="20%" r="90%">
            <stop offset="0%" stop-color="#9adcf3"/>
            <stop offset="55%" stop-color="#57c2ea"/>
            <stop offset="100%" stop-color="#2f97c9"/>
          </radialGradient>
          <linearGradient id="avatarHair" x1="10%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="45%" stop-color="#f2f8fc"/>
            <stop offset="100%" stop-color="#dceaf4"/>
          </linearGradient>
          <linearGradient id="avatarShoulder" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#6fd4f2"/>
            <stop offset="100%" stop-color="#2f97c9"/>
          </linearGradient>
          <radialGradient id="avatarGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#6fd4f2" stop-opacity=".3"/>
            <stop offset="100%" stop-color="#6fd4f2" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle class="avatar-glow" cx="100" cy="112" r="100" fill="url(#avatarGlow)"/>
        <text class="avatar-sparkle avatar-sparkle-1" x="18" y="56" font-size="13">✨</text>
        <text class="avatar-sparkle avatar-sparkle-2" x="168" y="46" font-size="10">✨</text>
        <path d="M14 220 C18 172 46 152 78 148 L122 148 C154 152 182 172 186 220 Z" fill="url(#avatarShoulder)"/>
        <path d="M76 150 Q100 145 124 150 L120 168 Q100 173 80 168 Z" fill="#eef7fc" opacity=".55"/>
        <g class="avatar-head">
          <ellipse cx="42" cy="112" rx="9" ry="14" fill="url(#avatarFace)" stroke="url(#avatarStroke)" stroke-width="1.5"/>
          <ellipse cx="158" cy="112" rx="9" ry="14" fill="url(#avatarFace)" stroke="url(#avatarStroke)" stroke-width="1.5"/>
          <path d="M100 40 C148 40 162 76 156 110 C153 144 128 168 100 168 C72 168 47 144 44 110 C38 76 52 40 100 40 Z" fill="url(#avatarFace)" stroke="url(#avatarStroke)" stroke-width="2.5"/>
          <ellipse cx="78" cy="62" rx="20" ry="10" fill="#ffffff" opacity=".22"/>
          <path d="M36 70 Q24 26 88 10 Q104 6 116 10 Q168 20 166 62 Q168 74 156 76 Q152 52 122 42 Q140 62 130 80 Q120 54 96 48 Q108 68 98 82 Q88 54 66 50 Q76 70 64 80 Q52 58 44 74 Q38 72 36 70 Z" fill="url(#avatarHair)" stroke="#cfe0ec" stroke-width="1.3"/>
          <path d="M35 71 Q100 52 165 71 Q163 84 100 88 Q37 84 35 71 Z" fill="#ffffff" stroke="#cfe0ec" stroke-width="1.2"/>
          <ellipse cx="70" cy="76" rx="20" ry="5" fill="#ffffff" opacity=".55"/>
          <path d="M63 87 Q76 80 89 87" fill="none" stroke="#2f7ea3" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>
          <path d="M111 87 Q124 80 137 87" fill="none" stroke="#2f7ea3" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>
          <g class="avatar-eye avatar-eye-l">
            <ellipse cx="79" cy="100" rx="11.5" ry="9.5" fill="#fff"/>
            <circle cx="81" cy="101" r="5.6" fill="#25201a"/>
            <circle cx="83.4" cy="98" r="2.1" fill="#fff"/>
          </g>
          <g class="avatar-eye avatar-eye-r">
            <ellipse cx="121" cy="100" rx="11.5" ry="9.5" fill="#fff"/>
            <circle cx="119" cy="101" r="5.6" fill="#25201a"/>
            <circle cx="121.4" cy="98" r="2.1" fill="#fff"/>
          </g>
          <ellipse cx="100" cy="120" rx="11" ry="8.5" fill="url(#avatarFace)" stroke="#2f97c9" stroke-width="1.3"/>
          <ellipse cx="96" cy="117" rx="3.2" ry="2.2" fill="#fff" opacity=".55"/>
          <ellipse cx="58" cy="124" rx="11" ry="6" fill="#ff9ec4" opacity=".3"/>
          <ellipse cx="142" cy="124" rx="11" ry="6" fill="#ff9ec4" opacity=".3"/>
          <rect id="avatarMouth" x="82" y="146" width="36" height="7" rx="3.5" fill="#b74f63"/>
          <ellipse cx="90" cy="147" rx="3" ry="1.3" fill="#fff" opacity=".4"/>
        </g>`,
    },
    western: {
      viewBox: '0 0 200 220',
      height: 141,
      transformOrigin: '100px 172px',
      mouth: { closed: { h: 7, y: 145, rx: 3.5 }, open: { h: 22, y: 137, rx: 10 } },
      markup: `
        <defs>
          <linearGradient id="avatarStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffab91"/>
            <stop offset="100%" stop-color="#ff8a65"/>
          </linearGradient>
          <radialGradient id="avatarFace" cx="35%" cy="20%" r="90%">
            <stop offset="0%" stop-color="#fff5ee"/>
            <stop offset="55%" stop-color="#ffe3cc"/>
            <stop offset="100%" stop-color="#f0c19f"/>
          </radialGradient>
          <linearGradient id="avatarHair" x1="10%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%" stop-color="#f9e6ae"/>
            <stop offset="45%" stop-color="#eccb77"/>
            <stop offset="100%" stop-color="#d4a94a"/>
          </linearGradient>
          <linearGradient id="avatarShoulder" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffb199"/>
            <stop offset="100%" stop-color="#ff8a71"/>
          </linearGradient>
          <radialGradient id="avatarGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ff8a71" stop-opacity=".28"/>
            <stop offset="100%" stop-color="#ff8a71" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle class="avatar-glow" cx="100" cy="112" r="100" fill="url(#avatarGlow)"/>
        <text class="avatar-sparkle avatar-sparkle-1" x="18" y="56" font-size="13">✨</text>
        <text class="avatar-sparkle avatar-sparkle-2" x="168" y="46" font-size="10">✨</text>
        <path d="M14 220 C18 172 46 152 78 148 L122 148 C154 152 182 172 186 220 Z" fill="url(#avatarShoulder)"/>
        <path d="M78 149 Q100 168 122 149 L120 160 Q100 176 80 160 Z" fill="#e8735a" opacity=".35"/>
        <rect x="86" y="144" width="28" height="30" rx="12" fill="url(#avatarFace)"/>
        <g class="avatar-head">
          <path d="M36 92 Q24 128 31 162 Q35 190 48 205 Q56 198 51 178 Q46 148 52 112 Z" fill="url(#avatarHair)"/>
          <path d="M164 92 Q176 128 169 162 Q165 190 152 205 Q144 198 149 178 Q154 148 148 112 Z" fill="url(#avatarHair)"/>
          <path d="M40 122 Q36 150 41 176" fill="none" stroke="#c99a3f" stroke-width="1.3" stroke-linecap="round" opacity=".4"/>
          <path d="M160 122 Q164 150 159 176" fill="none" stroke="#c99a3f" stroke-width="1.3" stroke-linecap="round" opacity=".4"/>
          <path d="M32 106 Q24 40 100 27 Q176 40 168 106 Q170 82 150 74 Q142 50 100 46 Q58 50 50 74 Q30 82 32 106 Z" fill="url(#avatarHair)"/>
          <ellipse cx="88" cy="42" rx="34" ry="13" fill="#ffffff" opacity=".14"/>
          <ellipse cx="42" cy="112" rx="8" ry="14" fill="url(#avatarFace)"/>
          <ellipse cx="158" cy="112" rx="8" ry="14" fill="url(#avatarFace)"/>
          <path d="M100 40 C144 40 156 74 152 106 C150 138 128 165 100 165 C72 165 50 138 48 106 C44 74 56 40 100 40 Z" fill="url(#avatarFace)" stroke="url(#avatarStroke)" stroke-width="2.5"/>
          <ellipse cx="78" cy="64" rx="18" ry="9" fill="#ffffff" opacity=".3"/>
          <path d="M56 96 Q47 118 54 140" fill="none" stroke="url(#avatarHair)" stroke-width="5" stroke-linecap="round"/>
          <path d="M144 96 Q153 118 146 140" fill="none" stroke="url(#avatarHair)" stroke-width="5" stroke-linecap="round"/>
          <path d="M38 90 Q30 46 100 38 Q170 46 162 90 Q152 58 122 52 Q136 70 126 82 Q118 56 100 55 Q82 56 74 82 Q64 70 78 52 Q48 58 38 90 Z" fill="url(#avatarHair)"/>
          <path d="M62 87 Q73 80 86 86" fill="none" stroke="#b8873a" stroke-width="2.1" stroke-linecap="round"/>
          <path d="M114 86 Q127 80 138 87" fill="none" stroke="#b8873a" stroke-width="2.1" stroke-linecap="round"/>
          <g class="avatar-eye avatar-eye-l">
            <path d="M62 100 Q68.5 92.5 77 93.5 Q85.5 92.5 90 98.5 Q81 107 74 107 Q66.5 107 62 100 Z" fill="#fff"/>
            <circle cx="77" cy="100.5" r="6.4" fill="#5c9ead"/>
            <circle cx="77" cy="100.5" r="3.1" fill="#1c2e30"/>
            <circle cx="79.3" cy="97.5" r="2.1" fill="#fff"/>
          </g>
          <g class="avatar-eye avatar-eye-r">
            <path d="M138 100 Q131.5 92.5 123 93.5 Q114.5 92.5 110 98.5 Q119 107 126 107 Q133.5 107 138 100 Z" fill="#fff"/>
            <circle cx="123" cy="100.5" r="6.4" fill="#5c9ead"/>
            <circle cx="123" cy="100.5" r="3.1" fill="#1c2e30"/>
            <circle cx="125.3" cy="97.5" r="2.1" fill="#fff"/>
          </g>
          <path d="M98 109 Q95.5 121 100 125 Q103.5 125 102.5 121.5" fill="none" stroke="#dba57e" stroke-width="1.8" stroke-linecap="round"/>
          <g fill="#c98a5c" opacity=".55">
            <circle cx="68" cy="112" r="1.1"/>
            <circle cx="74" cy="117" r="1"/>
            <circle cx="80" cy="112" r="1"/>
            <circle cx="94" cy="115" r="1"/>
            <circle cx="106" cy="115" r="1"/>
            <circle cx="120" cy="112" r="1"/>
            <circle cx="126" cy="117" r="1"/>
            <circle cx="132" cy="112" r="1.1"/>
          </g>
          <ellipse cx="59" cy="124" rx="11" ry="6" fill="#ff9e80" opacity=".35"/>
          <ellipse cx="141" cy="124" rx="11" ry="6" fill="#ff9e80" opacity=".35"/>
          <rect id="avatarMouth" x="84" y="145" width="32" height="7" rx="3.5" fill="#e2705a"/>
        </g>`,
    },
  };

  // 部分国产手机浏览器内核（如一些WebView套壳浏览器）对 SVG 元素的 innerHTML setter
  // 支持不完整，直接赋值有时会静默失败，切换头像没反应。改用 DOMParser 按 XML 方式
  // 解析后逐个搬运节点，兼容性更好；万一解析失败还会兜底退回 innerHTML。
  function setSvgContent(svg, markup) {
    try {
      const doc = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
        'image/svg+xml'
      );
      const root = doc.documentElement;
      if (!root || root.querySelector('parsererror')) throw new Error('SVG parse error');
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      Array.from(root.childNodes).forEach(node => svg.appendChild(document.importNode(node, true)));
    } catch {
      svg.innerHTML = markup;
    }
  }

  function applyAvatarStyle(key) {
    const cfg = AVATAR_STYLES[key] || AVATAR_STYLES.ghost;
    key = AVATAR_STYLES[key] ? key : 'ghost';
    state.avatarStyle = key;
    // 视觉切换放在存偏好设置之前：就算 localStorage 写入失败（比如iOS隐私浏览模式），
    // 头像也必须先换成功，不能让存储失败连累整个切换动作
    const svg = $('#aiAvatar');
    if (!svg) return;
    svg.setAttribute('viewBox', cfg.viewBox);
    setSvgContent(svg, cfg.markup);
    svg.style.height = cfg.height + 'px';
    const head = svg.querySelector('.avatar-head');
    if (head) head.style.transformOrigin = cfg.transformOrigin;
    $all('.avatar-style-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.style === key));
    safeSetItem('lb_avatar_style', key);
  }

  $all('.avatar-style-btn').forEach(btn => {
    btn.addEventListener('click', () => applyAvatarStyle(btn.dataset.style));
  });

  applyAvatarStyle(safeGetItem('lb_avatar_style') || 'ghost');

  // ---------- AI 头像：嘴型随语音张合，配合轻微摆动的"说话姿势" ----------
  // 优先用 SpeechSynthesisUtterance 的 boundary 事件（按实际读到哪个词触发），
  // 让嘴型张合真正跟读音节奏对上，而不是固定间隔瞎动；如果当前浏览器不触发
  // boundary 事件（部分移动端不支持），自动退回到固定间隔的开合动画兜底。
  let avatarMouthTimer = null;
  let mouthCloseTimer = null;

  function setMouthShape(open) {
    const mouth = $('#avatarMouth');
    if (!mouth) return;
    const cfg = (AVATAR_STYLES[state.avatarStyle] || AVATAR_STYLES.ghost).mouth;
    const shape = open ? cfg.open : cfg.closed;
    mouth.setAttribute('height', shape.h);
    mouth.setAttribute('y', shape.y);
    mouth.setAttribute('rx', shape.rx);
  }

  function startFallbackMouthLoop() {
    clearInterval(avatarMouthTimer);
    let open = false;
    avatarMouthTimer = setInterval(() => {
      open = !open;
      setMouthShape(open);
    }, 150);
  }

  function setAvatarTalking(talking) {
    const avatar = $('#aiAvatar');
    if (!avatar) return; // 头像只在 AI 对话页存在，其他页面朗读（背单词等）不触发
    const status = $('#avatarStatus');
    clearInterval(avatarMouthTimer);
    clearTimeout(mouthCloseTimer);
    if (talking) {
      avatar.classList.add('talking');
      avatar.classList.remove('idle');
      status.textContent = '正在说话...';
    } else {
      avatar.classList.remove('talking');
      avatar.classList.add('idle');
      status.textContent = '待机中';
      setMouthShape(false);
    }
  }

  // 词库目前仅收录英语单词，发音固定用英语，不随用户的目标语言切换
  function speakVocabWord(word) {
    speakText(word, 'en-US');
  }

  $('#btnSpeakWord').addEventListener('click', () => {
    const word = $('#flashcardWord').textContent;
    if (word && word !== '-') speakVocabWord(word);
  });

  // ---------- 背单词 ----------
  $('#vocabModeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $all('#vocabModeToggle .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    state.vocabMode = btn.dataset.mode;
    if (state.vocabMode === 'browse') {
      $('#btnStartQuiz').hidden = true;
      loadVocabBrowse();
    } else {
      $('#btnStartQuiz').hidden = false;
      loadVocabQueue();
    }
  });

  $('#vocabLevelFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $all('#vocabLevelFilter .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    state.vocabLevel = btn.dataset.level;
    if (state.vocabMode === 'browse') loadVocabBrowse();
    else loadVocabQueue();
  });

  async function loadVocabQueue() {
    state.quiz.active = false;
    setVocabMode('review');
    try {
      const qs = state.vocabLevel ? '?level=' + encodeURIComponent(state.vocabLevel) : '';
      const data = await api('/vocab/review' + qs);
      state.vocabQueue = data.words;
      state.vocabIndex = 0;
      state.vocabStats = data.stats;
      renderVocabStats();
      renderFlashcard();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderVocabStats() {
    const s = state.vocabStats;
    if (!s) return;
    $('#vocabStats').innerHTML = `
      <span>总词汇 ${s.total}</span>
      <span>已掌握 ${s.known}</span>
      <span>学习中 ${s.learning}</span>
      <span>未学 ${s.new}</span>
    `;
  }

  function renderFlashcard() {
    const queue = state.vocabQueue;
    const idx = state.vocabIndex;
    $('#flashcardReveal').hidden = true;
    $('#flashcardActions').hidden = true;
    $('#flashcardPreActions').hidden = false;
    $('#flashcardRootHint').hidden = true;

    if (!queue.length || idx >= queue.length) {
      $('#flashcardArea').hidden = true;
      $('#vocabEmpty').hidden = false;
      return;
    }
    $('#flashcardArea').hidden = false;
    $('#vocabEmpty').hidden = true;

    const w = queue[idx];
    $('#flashcardProgress').textContent = `${idx + 1} / ${queue.length}`;
    $('#flashcardWord').textContent = w.word;
    $('#flashcardPos').textContent = `${w.pos} · ${VOCAB_LEVEL_ZH[w.level] || w.level || ''}`;
    $('#flashcardMeaning').textContent = w.meaning_zh;
    $('#flashcardExampleEn').textContent = w.example_en;
    $('#flashcardExampleZh').textContent = w.example_zh;

    // 词根词缀作为回忆前的联想线索先展示，释义/例句要点"显示释义"才揭晓
    if (w.root) {
      $('#flashcardRootText').textContent = w.root;
      $('#flashcardRootHint').hidden = false;
    }
    if (w.note) {
      $('#flashcardNote').textContent = '💡 ' + w.note;
      $('#flashcardNote').hidden = false;
    } else {
      $('#flashcardNote').hidden = true;
    }

    if (w.previews) {
      $('#intervalAgain').textContent = w.previews.again || '';
      $('#intervalHard').textContent = w.previews.hard || '';
      $('#intervalGood').textContent = w.previews.good || '';
      $('#intervalEasy').textContent = w.previews.easy || '';
    }

    if (state.autoSpeak) speakVocabWord(w.word);
  }

  $('#btnRevealCard').addEventListener('click', () => {
    $('#flashcardReveal').hidden = false;
    $('#flashcardActions').hidden = false;
    $('#flashcardPreActions').hidden = true;
  });

  async function submitVocabReview(rating, skip) {
    const w = state.vocabQueue[state.vocabIndex];
    if (!w) return;
    try {
      await api('/vocab/review', { method: 'POST', body: { word: w.word, rating, skip: !!skip } });
    } catch (err) {
      toast(err.message);
    }
    state.vocabIndex++;
    renderFlashcard();
  }
  $('#btnAgain').addEventListener('click', () => submitVocabReview('again'));
  $('#btnHard').addEventListener('click', () => submitVocabReview('hard'));
  $('#btnGood').addEventListener('click', () => submitVocabReview('good'));
  $('#btnEasy').addEventListener('click', () => submitVocabReview('easy'));
  $('#btnSkipWord').addEventListener('click', () => submitVocabReview('easy', true));

  // ---------- 浏览全部单词（不受复习到期限制） ----------
  let vocabSearchTimer = null;
  $('#vocabSearchInput').addEventListener('input', (e) => {
    state.vocabSearch = e.target.value;
    clearTimeout(vocabSearchTimer);
    vocabSearchTimer = setTimeout(loadVocabBrowse, 300);
  });
  $('#vocabStatusFilter').addEventListener('change', (e) => {
    state.vocabStatusF = e.target.value;
    loadVocabBrowse();
  });

  async function loadVocabBrowse() {
    setVocabMode('browse');
    try {
      const params = new URLSearchParams();
      if (state.vocabLevel) params.set('level', state.vocabLevel);
      if (state.vocabSearch.trim()) params.set('q', state.vocabSearch.trim());
      if (state.vocabStatusF) params.set('status', state.vocabStatusF);
      const data = await api('/vocab/list?' + params.toString());
      state.vocabBrowseWords = data.words;
      renderVocabBrowse();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderVocabBrowse() {
    const words = state.vocabBrowseWords;
    $('#vocabBrowseCount').textContent = `共 ${words.length} 个单词`;
    if (!words.length) {
      $('#vocabBrowseList').innerHTML = '<p class="empty-state">没有找到匹配的单词</p>';
      return;
    }
    $('#vocabBrowseList').innerHTML = words.map(w => `
      <div class="vocab-browse-item">
        <div class="vocab-browse-main">
          <span class="vocab-browse-word">${escapeHtml(w.word)}</span>
          <span class="vocab-browse-pos">${escapeHtml(w.pos || '')}</span>
          <button type="button" class="btn-orbit-mini" data-word="${escapeHtml(w.word)}" title="查看词根关联星球">🪐</button>
          <span class="vocab-browse-status status-${w.status}">${VOCAB_STATUS_ZH[w.status] || w.status}</span>
        </div>
        <div class="vocab-browse-meaning">${escapeHtml(w.meaning_zh || '')}</div>
        ${w.root ? `<div class="vocab-browse-root">🔑 ${escapeHtml(w.root)}</div>` : ''}
      </div>
    `).join('');
  }

  $('#vocabBrowseList').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-orbit-mini');
    if (btn) openOrbit(btn.dataset.word);
  });

  // ---------- 单词测试（根据当前学习状态出题） ----------
  function setVocabMode(mode) {
    // mode: 'review' | 'browse' | 'quiz' | 'quiz-result'
    $('#flashcardArea').hidden = mode !== 'review';
    $('#vocabEmpty').hidden = true;
    $('#vocabBrowseArea').hidden = mode !== 'browse';
    $('#quizArea').hidden = mode !== 'quiz';
    $('#quizResult').hidden = mode !== 'quiz-result';
  }

  $('#btnStartQuiz').addEventListener('click', async () => {
    try {
      const qs = state.vocabLevel ? '?level=' + encodeURIComponent(state.vocabLevel) : '';
      const data = await api('/vocab/quiz' + qs);
      if (!data.questions.length) { toast('暂时没有足够的单词生成测试'); return; }
      state.quiz = { questions: data.questions, index: 0, score: 0, active: true };
      setVocabMode('quiz');
      renderQuizQuestion();
    } catch (err) {
      toast(err.message);
    }
  });

  function renderQuizQuestion() {
    const { questions, index } = state.quiz;
    const q = questions[index];
    $('#quizProgress').textContent = `第 ${index + 1} / ${questions.length} 题`;
    $('#quizWord').textContent = q.word;
    $('#quizPos').textContent = q.pos || '';
    $('#quizOptions').innerHTML = q.options.map((opt, i) => `
      <button type="button" class="quiz-option" data-idx="${i}">${String.fromCharCode(65 + i)}. ${escapeHtml(opt)}</button>
    `).join('');
    if (state.autoSpeak) speakVocabWord(q.word);

    Array.from($('#quizOptions').querySelectorAll('.quiz-option')).forEach(btn => {
      btn.addEventListener('click', () => answerQuizQuestion(Number(btn.dataset.idx)));
    });
  }

  async function answerQuizQuestion(selectedIdx) {
    const { questions, index } = state.quiz;
    const q = questions[index];
    const correct = selectedIdx === q.correctIndex;
    if (correct) state.quiz.score++;

    const buttons = $all('#quizOptions .quiz-option');
    buttons.forEach(b => { b.disabled = true; });
    buttons[selectedIdx].classList.add(correct ? 'correct' : 'wrong');
    if (!correct) buttons[q.correctIndex].classList.add('correct');

    api('/vocab/review', { method: 'POST', body: { word: q.word, rating: correct ? 'good' : 'again' } }).catch(() => {});

    setTimeout(() => {
      if (index + 1 < questions.length) {
        state.quiz.index++;
        renderQuizQuestion();
      } else {
        showQuizResult();
      }
    }, 1100);
  }

  function showQuizResult() {
    const { score, questions } = state.quiz;
    setVocabMode('quiz-result');
    $('#quizResultScore').textContent = `${score} / ${questions.length}`;
    const pct = Math.round((score / questions.length) * 100);
    let comment = '再接再厉，多复习几遍就会了！';
    if (pct === 100) comment = '满分！这些词你已经掌握得很牢固了 🎉';
    else if (pct >= 70) comment = '不错，大部分都答对了！';
    $('#quizResultText').textContent = comment;
  }

  $('#btnQuizRetry').addEventListener('click', () => $('#btnStartQuiz').click());
  $('#btnQuizExit').addEventListener('click', () => {
    state.quiz.active = false;
    setVocabMode('review');
    loadVocabQueue();
    renderMetrics();
  });

  // ---------- 词根关联星球 ----------
  // 把和当前单词共享词根/主题的词摆成一个可拖动旋转的球，靠"一族词一起记"来加深印象。
  // 纯 CSS 3D（transform + preserve-3d）实现，不引第三方3D库，手机上也能跑得动。
  const orbit = { rotX: -12, rotY: 0, dragging: false, lastX: 0, lastY: 0, spinTimer: null, moved: false };

  async function openOrbit(word) {
    if (!word) return;
    try {
      const data = await api('/vocab/related?word=' + encodeURIComponent(word));
      if (!data.related.length) { toast('这个词暂时没有找到关联词'); return; }
      renderOrbit(data);
      $('#orbitOverlay').hidden = false;
      startOrbitSpin();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderOrbit(data) {
    const { center, related } = data;
    $('#orbitTitle').textContent = center.word;
    $('#orbitSub').textContent = center.root
      ? `${center.root} · ${center.meaning_zh}`
      : `${center.category || ''} · ${center.meaning_zh}`;
    showOrbitDetail(center);

    // 斐波那契球面分布：让所有词在球面上尽量均匀铺开，不会挤成一团
    const n = related.length;
    // 手机屏窄，球半径要跟着缩，否则两侧的词会被弹窗边缘裁掉
    const stageWidth = $('#orbitStage').clientWidth || 480;
    const radius = Math.min(140, Math.max(78, stageWidth * 0.3), 100 + n * 2.5);
    const nodes = related.map((w, i) => {
      const phi = Math.acos(1 - 2 * (i + 0.5) / n);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      return { w, x, y, z };
    });

    // 中心词固定不随球体旋转，单独放在舞台正中，避免被转过来的节点盖住看不清
    $('#orbitCore').textContent = center.word;
    $('#orbitSphere').innerHTML = `
      ${nodes.map(({ w, x, y, z }) => `
        <button type="button" class="orbit-node orbit-node-${w.relation}"
          data-word="${escapeHtml(w.word)}"
          style="transform: translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px)">
          <span class="orbit-node-inner">${escapeHtml(w.word)}</span>
        </button>
      `).join('')}
    `;
    // 关联词的完整信息挂在闭包里，点击时直接查，省一次请求
    $('#orbitSphere').__nodes = new Map(related.map(w => [w.word, w]));
    applyOrbitRotation();
  }

  function showOrbitDetail(w) {
    const relationLabel = w.relation === 'root'
      ? `🔑 同词根 ${escapeHtml(w.via)}`
      : w.relation === 'category' ? `🏷️ 同主题 ${escapeHtml(w.via)}` : '⭐ 中心词';
    $('#orbitDetail').innerHTML = `
      <div class="orbit-detail-head">
        <strong class="orbit-detail-word">${escapeHtml(w.word)}</strong>
        <span class="orbit-detail-pos">${escapeHtml(w.pos || '')}</span>
        <span class="orbit-detail-tag">${relationLabel}</span>
        <button type="button" class="btn-icon-sm" id="orbitSpeak" title="发音">🔊</button>
      </div>
      <div class="orbit-detail-meaning">${escapeHtml(w.meaning_zh || '')}</div>
      ${w.root ? `<div class="orbit-detail-root">🔑 ${escapeHtml(w.root)}</div>` : ''}
      ${w.example_en ? `<div class="orbit-detail-example">${escapeHtml(w.example_en)}</div>` : ''}
      ${w.example_zh ? `<div class="orbit-detail-example-zh">${escapeHtml(w.example_zh)}</div>` : ''}
      <button type="button" class="btn btn-outline btn-sm" id="orbitRecenter" data-word="${escapeHtml(w.word)}">以「${escapeHtml(w.word)}」为中心展开</button>
    `;
  }

  function applyOrbitRotation() {
    const sphere = $('#orbitSphere');
    if (!sphere) return;
    sphere.style.transform = `rotateX(${orbit.rotX}deg) rotateY(${orbit.rotY}deg)`;
    // 球体整体旋转会把文字也转歪，这里给每个节点反向旋转，保证任何角度文字都是正的
    sphere.querySelectorAll('.orbit-node-inner').forEach(el => {
      el.style.transform = `rotateY(${-orbit.rotY}deg) rotateX(${-orbit.rotX}deg)`;
    });
  }

  function startOrbitSpin() {
    clearInterval(orbit.spinTimer);
    orbit.spinTimer = setInterval(() => {
      if (orbit.dragging) return;
      orbit.rotY += 0.22;
      applyOrbitRotation();
    }, 40);
  }
  function stopOrbitSpin() { clearInterval(orbit.spinTimer); }

  function orbitPointerDown(clientX, clientY) {
    orbit.dragging = true;
    orbit.moved = false;
    orbit.lastX = clientX;
    orbit.lastY = clientY;
  }
  function orbitPointerMove(clientX, clientY) {
    if (!orbit.dragging) return;
    const dx = clientX - orbit.lastX;
    const dy = clientY - orbit.lastY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) orbit.moved = true;
    orbit.rotY += dx * 0.4;
    orbit.rotX -= dy * 0.4;
    orbit.rotX = Math.max(-80, Math.min(80, orbit.rotX)); // 限制上下翻转，避免转到"倒过来"很迷惑
    orbit.lastX = clientX;
    orbit.lastY = clientY;
    applyOrbitRotation();
  }
  function orbitPointerUp() { orbit.dragging = false; }

  const orbitStage = $('#orbitStage');
  orbitStage.addEventListener('mousedown', (e) => { e.preventDefault(); orbitPointerDown(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => orbitPointerMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', orbitPointerUp);
  orbitStage.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    orbitPointerDown(t.clientX, t.clientY);
  }, { passive: true });
  orbitStage.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    orbitPointerMove(t.clientX, t.clientY);
    if (orbit.dragging) e.preventDefault(); // 拖球时不要把整个页面也跟着滚
  }, { passive: false });
  orbitStage.addEventListener('touchend', orbitPointerUp);

  orbitStage.addEventListener('click', (e) => {
    const node = e.target.closest('.orbit-node');
    if (!node || orbit.moved) return; // 刚才是在拖动球体，不算点击选词
    const w = $('#orbitSphere').__nodes?.get(node.dataset.word);
    if (!w) return;
    $all('.orbit-node').forEach(n => n.classList.remove('active'));
    node.classList.add('active');
    showOrbitDetail(w);
  });

  $('#orbitDetail').addEventListener('click', (e) => {
    if (e.target.id === 'orbitSpeak') {
      const word = $('.orbit-detail-word')?.textContent;
      if (word) speakVocabWord(word);
    }
    if (e.target.id === 'orbitRecenter') {
      openOrbit(e.target.dataset.word);
    }
  });

  function closeOrbit() {
    $('#orbitOverlay').hidden = true;
    stopOrbitSpin();
  }
  $('#orbitClose').addEventListener('click', closeOrbit);
  $('#orbitOverlay').addEventListener('click', (e) => { if (e.target.id === 'orbitOverlay') closeOrbit(); });

  $('#btnOpenOrbit').addEventListener('click', () => {
    const w = state.vocabQueue[state.vocabIndex];
    if (w) openOrbit(w.word);
  });

  // ---------- 语法 ----------
  async function renderGrammarList() {
    $('#grammarDetail').hidden = true;
    $('#grammarList').hidden = false;
    try {
      const data = await api('/grammar/list');
      state.grammarLessons = data.lessons;
      $('#grammarList').innerHTML = data.lessons.map(l => `
        <div class="grammar-item" data-id="${l.id}">
          <h4>${escapeHtml(l.title)}</h4>
          <p>${escapeHtml(l.summary)}</p>
        </div>
      `).join('');
      $all('.grammar-item').forEach(el => {
        el.addEventListener('click', () => renderGrammarDetail(el.dataset.id));
      });
    } catch (err) {
      toast(err.message);
    }
  }

  $('#btnBackToList').addEventListener('click', () => {
    $('#grammarDetail').hidden = true;
    $('#grammarList').hidden = false;
  });

  async function renderGrammarDetail(id) {
    try {
      const data = await api('/grammar/' + id);
      const lesson = data.lesson;
      state.currentGrammarId = id;
      $('#grammarList').hidden = true;
      $('#grammarDetail').hidden = false;
      $('#grammarTitle').textContent = lesson.title;
      $('#grammarSummaryText').textContent = lesson.summary;
      $('#grammarStructure').textContent = lesson.structure;
      $('#grammarExplanation').textContent = lesson.explanation;
      $('#grammarExamples').innerHTML = lesson.examples.map(ex => `
        <li>${escapeHtml(ex.en)}<br><span class="zh">${escapeHtml(ex.zh)}</span></li>
      `).join('');
      $('#grammarPractice').innerHTML = lesson.practice.map((p, i) => `
        <div class="practice-item" data-idx="${i}">
          <div class="practice-q">${i + 1}. ${escapeHtml(p.question)}</div>
          <div class="practice-options">
            ${p.options.map((opt, oi) => `<button class="practice-opt" data-oi="${oi}">${escapeHtml(opt)}</button>`).join('')}
          </div>
          <div class="practice-explain"></div>
        </div>
      `).join('');

      $all('#grammarPractice .practice-item').forEach((item, i) => {
        const p = lesson.practice[i];
        item.querySelectorAll('.practice-opt').forEach(btn => {
          btn.addEventListener('click', () => {
            const oi = Number(btn.dataset.oi);
            const opts = item.querySelectorAll('.practice-opt');
            opts.forEach(o => o.classList.remove('correct', 'wrong'));
            if (oi === p.answerIndex) {
              btn.classList.add('correct');
            } else {
              btn.classList.add('wrong');
              opts[p.answerIndex].classList.add('correct');
            }
            const explain = item.querySelector('.practice-explain');
            explain.textContent = p.explanation;
            explain.classList.add('show');
          });
        });
      });

      const needMember = !state.user.isMember;
      $('#grammarCheckerPaywall').hidden = !needMember;
      $('#grammarCheckerPanel').hidden = needMember;
      $('#grammarCheckInput').value = '';
      $('#grammarCheckResult').classList.remove('show');
      $('#grammarCheckResult').textContent = '';
    } catch (err) {
      toast(err.message);
    }
  }

  $('#btnGrammarCheck').addEventListener('click', async () => {
    const sentence = $('#grammarCheckInput').value.trim();
    if (!sentence) return toast('请输入一句话');
    const btn = $('#btnGrammarCheck');
    btn.disabled = true;
    try {
      const data = await api('/grammar/check', { method: 'POST', body: { sentence } });
      const resEl = $('#grammarCheckResult');
      resEl.textContent = data.result;
      resEl.classList.add('show');
    } catch (err) {
      if (err.needMembership) {
        toast('需要开通会员才能使用 AI 批改');
        renderGrammarDetail(state.currentGrammarId);
      } else {
        toast(err.message);
      }
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- 美式口语 ----------
  async function renderColloquial() {
    try {
      const data = await api('/colloquial/list');
      state.colloquialPhrases = data.phrases;
      state.colloquialCategory = state.colloquialCategory || '全部';
      const cats = ['全部', ...data.categories];
      $('#colloquialFilterChips').innerHTML = cats.map(c => `
        <button class="chip ${c === state.colloquialCategory ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>
      `).join('');
      $all('#colloquialFilterChips .chip').forEach(btn => {
        btn.addEventListener('click', () => {
          state.colloquialCategory = btn.dataset.cat;
          renderColloquialList();
          $all('#colloquialFilterChips .chip').forEach(b => b.classList.toggle('active', b === btn));
        });
      });
      renderColloquialList();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderColloquialList() {
    const list = state.colloquialCategory === '全部'
      ? state.colloquialPhrases
      : state.colloquialPhrases.filter(p => p.category === state.colloquialCategory);
    $('#colloquialList').innerHTML = list.map(p => `
      <div class="colloquial-card" data-id="${p.id}">
        <div class="colloquial-card-head">
          <div class="colloquial-head-text">
            <span class="colloquial-phrase">${escapeHtml(p.phrase)}</span>
            <span class="colloquial-meaning">${escapeHtml(p.meaning)}</span>
            <div><span class="colloquial-category">${escapeHtml(p.category)}</span></div>
          </div>
          <button class="btn btn-icon btn-icon-sm colloquial-speak" data-phrase="${escapeHtml(p.phrase)}" title="发音">🔊</button>
        </div>
        <div class="colloquial-card-body">
          <div class="colloquial-example">${escapeHtml(p.example)}</div>
          <div class="colloquial-example-zh">${escapeHtml(p.exampleZh)}</div>
          <div class="colloquial-note">💡 ${escapeHtml(p.note)}</div>
        </div>
      </div>
    `).join('');

    $all('.colloquial-card').forEach(card => {
      card.addEventListener('click', () => {
        card.querySelector('.colloquial-card-body').classList.toggle('show');
      });
    });
    $all('.colloquial-speak').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakText(btn.dataset.phrase, 'en-US');
      });
    });
  }

  // ---------- AI 错题本 ----------
  async function renderMistakes() {
    $('#mistakesPaywall').hidden = state.user.isMember;
    $('#mistakesPanel').hidden = false;
    resetMistakeUpload();
    resetMistakeTextInput();
    setMistakeInputMode('image');
    await loadMistakes();
  }

  $('#btnMistakesUpgrade').addEventListener('click', upgradeMembership);

  function resetMistakeUpload() {
    state.mistakeFile = null;
    $('#mistakeFileInput').value = '';
    $('#mistakeUploadEmpty').hidden = false;
    $('#mistakeUploadPreviewWrap').hidden = true;
    $('#mistakeUploadActions').hidden = true;
    $('#mistakeUploadStatus').textContent = '';
    $('#mistakeExamType').value = '';
  }

  function resetMistakeTextInput() {
    $('#mistakeTextInput').value = '';
    $('#mistakeTextExamType').value = '';
    $('#mistakeTextStatus').textContent = '';
  }

  function setMistakeInputMode(mode) {
    $('#tabImageMode').classList.toggle('active', mode === 'image');
    $('#tabTextMode').classList.toggle('active', mode === 'text');
    $('#mistakeImageMode').hidden = mode !== 'image';
    $('#mistakeTextMode').hidden = mode !== 'text';
  }
  $('#tabImageMode').addEventListener('click', () => setMistakeInputMode('image'));
  $('#tabTextMode').addEventListener('click', () => setMistakeInputMode('text'));

  $('#btnClearTextInput').addEventListener('click', resetMistakeTextInput);

  $('#btnAnalyzeTextMistake').addEventListener('click', async () => {
    const questionText = $('#mistakeTextInput').value.trim();
    if (!questionText) { toast('请先输入错题内容'); return; }
    const btn = $('#btnAnalyzeTextMistake');
    btn.disabled = true;
    $('#mistakeTextStatus').textContent = '🔍 AI 正在分析中，请稍候...';
    try {
      const examType = $('#mistakeTextExamType').value.trim();
      const data = await api('/mistakes/submit-text', { method: 'POST', body: { questionText, examType } });
      $('#mistakeTextStatus').textContent = '✅ 解析完成！';
      resetMistakeTextInput();
      renderMistakeDetail(data.mistake, true);
      await loadMistakes();
    } catch (err) {
      if (err.needMembership) {
        toast('需要开通会员才能使用错题本');
        renderMistakes();
      } else if (err.needPhoneVerify) {
        toast(err.message);
        showView('profile');
      } else {
        $('#mistakeTextStatus').textContent = '❌ ' + err.message;
      }
    } finally {
      btn.disabled = false;
    }
  });

  // 「选择图片」按钮在上传区里面，点它会先触发按钮自己的处理器、再冒泡到外层上传区，
  // 于是同一次点击里 fileInput.click() 被调了两次。手机浏览器对文件选择框有严格的
  // 用户手势校验，第二次合成点击不再被认为可信，导致选择框弹出后立刻关闭甚至不弹——
  // 表现就是"点了没反应"。这里阻止冒泡，保证一次点击只触发一次。
  $('#btnPickImage').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#mistakeFileInput').click();
  });
  $('#mistakeUploadDrop').addEventListener('click', () => {
    if (!state.mistakeFile) $('#mistakeFileInput').click();
  });
  $('#mistakeFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setMistakeFile(file);
  });

  // 支持 Ctrl+V 直接粘贴截图
  document.addEventListener('paste', (e) => {
    if ($('#view-mistakes').hidden) return;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) setMistakeFile(file);
        e.preventDefault();
        break;
      }
    }
  });

  async function setMistakeFile(file) {
    if (!file.type.startsWith('image/')) { toast('请上传图片文件'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('图片不能超过 8MB'); return; }

    let finalFile = file;
    try {
      finalFile = await downscaleImage(file, 1600, 0.85);
    } catch {
      // 压缩失败就直接用原图，不阻断上传
    }

    state.mistakeFile = finalFile;
    $('#mistakeUploadPreview').src = URL.createObjectURL(finalFile);
    $('#mistakeUploadEmpty').hidden = true;
    $('#mistakeUploadPreviewWrap').hidden = false;
    $('#mistakeUploadActions').hidden = false;
    $('#mistakeUploadStatus').textContent = '';
  }

  // 手机拍照的原图往往很大，压缩到最长边 maxDim 以内再上传，
  // 既能省流量，也能大幅降低视觉模型的 token 消耗，避免超出免费额度
  function downscaleImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width <= maxDim && height <= maxDim) {
          resolve(file);
          return;
        }
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(new File([blob], (file.name || 'image').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
          else reject(new Error('图片压缩失败'));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
      img.src = url;
    });
  }

  $('#btnCancelUpload').addEventListener('click', resetMistakeUpload);

  async function uploadMistakeImage(file, examType) {
    const formData = new FormData();
    formData.append('image', file);
    if (examType) formData.append('examType', examType);

    // 这里不能走 api()（那个会强制 JSON 请求头），但同样需要：
    //   1. 用 API_BASE —— 打包成App后页面是本地加载的，写死 /api 会打到本地包里 404
    //   2. 带上 token —— App 里跨站请求发不出 cookie，不带 token 就是未登录
    //   3. 超时 —— 图片上传 + AI识图本来就慢，手机网络下 fetch 可能永远挂着不返回
    const headers = {};
    const token = getAuthToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000); // 识图比纯文本慢，给足90秒
    let res;
    try {
      res = await fetch(API_BASE + '/mistakes/upload', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: formData,
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('上传超时了，可能是图片较大或网络较慢，请重试');
      throw new Error('网络连接失败，请检查网络后重试');
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || '上传失败');
      err.needMembership = data.needMembership;
      err.needPhoneVerify = data.needPhoneVerify;
      throw err;
    }
    return data;
  }

  $('#btnAnalyzeMistake').addEventListener('click', async () => {
    if (!state.mistakeFile) return;
    const btn = $('#btnAnalyzeMistake');
    btn.disabled = true;
    $('#mistakeUploadStatus').textContent = '🔍 AI 正在识别解析中，可能需要几秒到十几秒，请稍候...';
    try {
      const examType = $('#mistakeExamType').value.trim();
      const data = await uploadMistakeImage(state.mistakeFile, examType);
      $('#mistakeUploadStatus').textContent = '✅ 解析完成！';
      resetMistakeUpload();
      renderMistakeDetail(data.mistake, true);
      await loadMistakes();
    } catch (err) {
      if (err.needMembership) {
        toast('需要开通会员才能使用错题本');
        renderMistakes();
      } else if (err.needPhoneVerify) {
        toast(err.message);
        showView('profile');
      } else {
        $('#mistakeUploadStatus').textContent = '❌ ' + err.message;
      }
    } finally {
      btn.disabled = false;
    }
  });

  async function loadMistakes() {
    try {
      const params = new URLSearchParams();
      if (state.mistakeFilter.category) params.set('category', state.mistakeFilter.category);
      const qs = params.toString();
      const data = await api('/mistakes/list' + (qs ? '?' + qs : ''));
      state.mistakes = data.mistakes;
      $('#mistakeCount').textContent = data.stats.total;
      renderMistakeFilterChips(data.stats);
      renderMistakeList();
    } catch (err) {
      toast(err.message);
    }
  }

  function renderMistakeFilterChips(stats) {
    const el = $('#mistakeFilterChips');
    if (!stats.categories.length) { el.innerHTML = ''; return; }
    const chips = [`<button class="chip ${!state.mistakeFilter.category ? 'active' : ''}" data-value="">全部</button>`];
    stats.categories.forEach(c => {
      chips.push(`<button class="chip ${state.mistakeFilter.category === c ? 'active' : ''}" data-value="${escapeHtml(c)}">${escapeHtml(c)}</button>`);
    });
    el.innerHTML = chips.join('');
    Array.from(el.querySelectorAll('.chip')).forEach(btn => {
      btn.addEventListener('click', () => {
        state.mistakeFilter.category = btn.dataset.value;
        loadMistakes();
      });
    });
  }

  function renderMistakeList() {
    const list = state.mistakes;
    $('#mistakeListEmpty').hidden = list.length > 0;
    $('#mistakeList').innerHTML = list.map(m => `
      <div class="mistake-list-item" data-id="${m.id}">
        ${m.imageUrl ? `<img src="${m.imageUrl}" alt="缩略图">` : `<div class="mistake-list-item-thumb-placeholder">⌨️</div>`}
        <div class="mistake-list-item-body">
          <h4>${escapeHtml(m.category)}${m.mastered ? '<span class="mistake-mastered-badge">✔已掌握</span>' : ''}</h4>
          <p>${escapeHtml((m.questionText || '').slice(0, 40))}</p>
        </div>
      </div>
    `).join('');
    Array.from($('#mistakeList').querySelectorAll('.mistake-list-item')).forEach(item => {
      item.addEventListener('click', () => {
        const m = state.mistakes.find(x => x.id === item.dataset.id);
        if (m) renderMistakeDetail(m, true);
      });
    });
  }

  function renderMistakeDetail(m, scroll) {
    const el = $('#mistakeResultCard');
    const tagsHtml = (m.tags || []).map(t => `<span class="mistake-tag">#${escapeHtml(t)}</span>`).join('');
    const similarHtml = (m.similarQuestions || []).map((sq, i) => `
      <div class="similar-q-item">
        <div class="practice-q">${i + 1}. ${escapeHtml(sq.question)}</div>
        <button type="button" class="btn btn-ghost btn-sm similar-q-toggle" data-idx="${i}">查看答案</button>
        <div class="similar-q-answer" id="similarAnswer-${i}">
          <strong>答案：</strong>${escapeHtml(sq.answer)}<br>${escapeHtml(sq.explanation || '')}
        </div>
      </div>
    `).join('');

    const imageHtml = m.imageUrl
      ? `<img class="mistake-detail-img" src="${m.imageUrl}" alt="错题图片">`
      : `<div class="mistake-detail-img mistake-detail-img-placeholder">⌨️</div>`;

    el.innerHTML = `
      <div class="mistake-detail-header">
        ${imageHtml}
        <div>
          <div class="mistake-badges">
            <span class="mistake-badge">${escapeHtml(m.subject)}</span>
            ${m.examType ? `<span class="mistake-badge">${escapeHtml(m.examType)}</span>` : ''}
            <span class="mistake-badge">${escapeHtml(m.category)}</span>
          </div>
          <div class="mistake-badges">${tagsHtml}</div>
        </div>
      </div>
      <div class="mistake-detail-block">
        <div class="mistake-detail-label">题目</div>
        <p>${escapeHtml(m.questionText)}</p>
      </div>
      ${m.userAnswer ? `<div class="mistake-detail-block"><div class="mistake-detail-label">你的作答</div><p>${escapeHtml(m.userAnswer)}</p></div>` : ''}
      <div class="mistake-detail-block">
        <div class="mistake-detail-label">正确答案</div>
        <p>${escapeHtml(m.correctAnswer)}</p>
      </div>
      <div class="mistake-detail-block">
        <div class="mistake-detail-label">解析</div>
        <p>${escapeHtml(m.explanation)}</p>
      </div>
      <div class="mistake-detail-block">
        <div class="mistake-detail-label">举一反三</div>
        ${similarHtml || '<p>暂无</p>'}
      </div>
      <div class="mistake-detail-block">
        <button type="button" class="btn ${m.mastered ? 'btn-success' : 'btn-outline'} btn-sm" id="btnToggleMastered">${m.mastered ? '✅ 已掌握' : '标记为已掌握'}</button>
        <button type="button" class="btn btn-danger btn-sm" id="btnDeleteMistake">删除</button>
      </div>
    `;
    el.hidden = false;
    el.dataset.id = m.id;

    Array.from(el.querySelectorAll('.similar-q-toggle')).forEach(btn => {
      btn.addEventListener('click', () => {
        $('#similarAnswer-' + btn.dataset.idx).classList.toggle('show');
      });
    });
    $('#btnToggleMastered').addEventListener('click', () => toggleMastered(m.id, !m.mastered));
    $('#btnDeleteMistake').addEventListener('click', () => deleteMistake(m.id));

    if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function toggleMastered(id, mastered) {
    try {
      const data = await api('/mistakes/' + id, { method: 'PATCH', body: { mastered } });
      if ($('#mistakeResultCard').dataset.id === id) renderMistakeDetail(data.mistake, false);
      await loadMistakes();
    } catch (err) {
      toast(err.message);
    }
  }

  async function deleteMistake(id) {
    try {
      await api('/mistakes/' + id, { method: 'DELETE' });
      if ($('#mistakeResultCard').dataset.id === id) $('#mistakeResultCard').hidden = true;
      toast('已删除');
      await loadMistakes();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- 作文批改 ----------
  function renderEssay() {
    $('#essayPaywall').hidden = state.user.isMember;
    $('#essayPanel').hidden = false;
    $('#essayResult').hidden = true;
    $('#essayStatus').textContent = '';
    state.essayMode = state.essayMode || 'general';
    setEssayMode(state.essayMode);
    updateEssayCharCount();
  }

  $('#btnEssayUpgrade').addEventListener('click', upgradeMembership);

  function setEssayMode(mode) {
    state.essayMode = mode;
    $all('#essayModeTabs .mistake-input-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    $('#essayExamType').hidden = mode === 'english';
    $('#essayExamTypeSelect').hidden = mode !== 'english';
    $('#essayInput').placeholder = mode === 'english'
      ? '粘贴你的英语考试作文，AI 会按对应考试评分标准打分并逐句批改...'
      : '把你写的作文粘贴或输入进来，AI 会逐句逐词批改，给出修改建议和整体点评...';
  }
  $all('#essayModeTabs .mistake-input-tab').forEach(btn => {
    btn.addEventListener('click', () => setEssayMode(btn.dataset.mode));
  });

  function updateEssayCharCount() {
    const len = $('#essayInput').value.length;
    $('#essayCharCount').textContent = `${len} / 3000`;
  }
  $('#essayInput').addEventListener('input', updateEssayCharCount);

  $('#btnCheckEssay').addEventListener('click', async () => {
    const essayText = $('#essayInput').value.trim();
    if (!essayText) { toast('请先输入作文内容'); return; }
    const btn = $('#btnCheckEssay');
    btn.disabled = true;
    $('#essayResult').hidden = true;
    $('#essayStatus').textContent = '✍️ AI 正在逐句批改中，作文较长可能需要十几秒到半分钟，请耐心等待...';
    try {
      const mode = state.essayMode || 'general';
      const examType = mode === 'english' ? $('#essayExamTypeSelect').value : $('#essayExamType').value.trim();
      const data = await api('/essay/check', { method: 'POST', body: { essayText, examType, mode } });
      $('#essayStatus').textContent = '';
      renderEssayResult(data);
      renderMetrics();
    } catch (err) {
      if (err.needMembership) {
        toast('需要开通会员才能使用作文批改');
        renderEssay();
      } else if (err.needPhoneVerify) {
        toast(err.message);
        showView('profile');
      } else {
        $('#essayStatus').textContent = '❌ ' + err.message;
      }
    } finally {
      btn.disabled = false;
    }
  });

  function renderEssayResult(data) {
    $('#essayScoreBlock').hidden = !data.scoreEstimate;
    $('#essayScore').textContent = data.scoreEstimate || '';
    const hasRubric = data.rubric && (data.rubric.content || data.rubric.organization || data.rubric.language);
    $('#essayRubricBlock').hidden = !hasRubric;
    if (hasRubric) {
      $('#essayRubricContent').textContent = data.rubric.content || '';
      $('#essayRubricOrganization').textContent = data.rubric.organization || '';
      $('#essayRubricLanguage').textContent = data.rubric.language || '';
    }
    $('#essayLevel').textContent = data.estimatedLevel || '（未提供评估）';
    $('#essayComment').textContent = data.overallComment || '';
    $('#essayCorrected').textContent = data.correctedEssay || '';
    $('#essayCorrectionCount').textContent = data.corrections.length;

    if (data.corrections.length) {
      $('#essayCorrections').innerHTML = data.corrections.map(c => `
        <div class="correction-item">
          <div class="correction-original">${escapeHtml(c.original)}</div>
          <div class="correction-corrected">→ ${escapeHtml(c.corrected)}</div>
          <div class="correction-explanation">${escapeHtml(c.explanation)}</div>
        </div>
      `).join('');
    } else {
      $('#essayCorrections').innerHTML = '<p>没有发现明显问题，写得很棒！</p>';
    }
    $('#essayResult').hidden = false;
    $('#essayResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- 管理后台 ----------
  async function renderAdmin() {
    if (!state.user?.isAdmin) return;
    try {
      const [overview, usersData] = await Promise.all([
        api('/admin/overview'),
        api('/admin/users'),
      ]);
      $('#adminTotalUsers').textContent = overview.totalUsers;
      $('#adminTotalMembers').textContent = overview.totalMembers;
      $('#adminTotalChats').textContent = overview.totalChats;
      $('#adminTotalMistakes').textContent = overview.totalMistakes;
      $('#adminNewToday').textContent = overview.newUsersToday;
      $('#adminNewWeek').textContent = overview.newUsersThisWeek;

      // 公网IP/归属地只有超级管理员能看，普通管理员的接口响应里根本没有这些字段
      const canSeeIp = !!usersData.canSeeIp;
      const isSuper = !!state.user.isSuperAdmin;
      $('#adminRegionSection').hidden = !canSeeIp;
      $all('.admin-col-ip').forEach(el => { el.hidden = !canSeeIp; });
      $('#btnAdminAddUser').hidden = !isSuper;
      $('#adminRoleHint').textContent = isSuper
        ? '当前身份：超级管理员（可查看注册IP/归属地，可新增、删除用户和重置密码）'
        : '当前身份：普通管理员（可查看用户与统计、开通/取消会员；IP归属地等敏感信息仅超级管理员可见）';

      $('#adminRegionBody').innerHTML = (overview.regionBreakdown || []).map(r => `
        <tr><td>${escapeHtml(r.region)}</td><td>${r.count}</td></tr>
      `).join('') || '<tr><td colspan="2">暂无数据</td></tr>';

      $('#adminUsersBody').innerHTML = usersData.users.map(u => {
        const isSelf = u.username === state.user.username;
        const ipCells = canSeeIp ? `
          <td class="admin-col-ip">${escapeHtml(u.registrationIp || '-')}</td>
          <td class="admin-col-ip">${escapeHtml([u.regProvince, u.regCity, u.regDistrict].filter(Boolean).join(' ') || u.registrationRegion || '未知')}${u.regProxy ? ' <span class="admin-proxy-flag">代理</span>' : ''}</td>
          <td class="admin-col-ip">${escapeHtml(u.regIsp || '-')}</td>` : '';
        return `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.nickname)}</td>
          <td>${u.isMember ? '<span class="admin-badge-yes">✔ 会员</span>' : '<span class="admin-badge-no">-</span>'}</td>
          <td>${escapeHtml(langName(u.targetLang))}</td>
          <td>${u.vocabMastered}</td>
          <td>${u.vocabLearning}</td>
          <td>${u.mistakesTotal}</td>
          <td>${u.chatCount}</td>
          <td>${u.streakDays}</td>
          ${ipCells}
          <td>${new Date(u.createdAt).toLocaleDateString('zh-CN')}</td>
          <td class="admin-actions">
            <button type="button" class="btn-admin-action" data-action="toggle-member" data-username="${escapeHtml(u.username)}" data-ismember="${u.isMember ? '1' : ''}">${u.isMember ? '取消会员' : '设为会员'}</button>
            ${isSuper ? `<button type="button" class="btn-admin-action" data-action="reset-pw" data-username="${escapeHtml(u.username)}">重置密码</button>` : ''}
            ${isSuper && !isSelf ? `<button type="button" class="btn-admin-action btn-admin-action-danger" data-action="delete" data-username="${escapeHtml(u.username)}">删除</button>` : ''}
          </td>
        </tr>
      `;
      }).join('');
    } catch (err) {
      toast(err.message);
    }
  }

  $('#adminUsersBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-admin-action');
    if (!btn) return;
    const { action, username } = btn.dataset;
    if (action === 'toggle-member') {
      const nextIsMember = !btn.dataset.ismember;
      try {
        await api(`/admin/users/${encodeURIComponent(username)}/membership`, { method: 'POST', body: { isMember: nextIsMember } });
        toast(nextIsMember ? '已开通会员' : '已取消会员');
        renderAdmin();
      } catch (err) {
        toast(err.message);
      }
    } else if (action === 'reset-pw') {
      $('#adminResetPwTarget').textContent = `为用户 ${username} 设置新密码`;
      $('#adminResetPwForm').dataset.username = username;
      $('#adminResetPwInput').value = '';
      $('#adminResetPwError').textContent = '';
      $('#adminResetPwOverlay').hidden = false;
    } else if (action === 'delete') {
      if (!confirm(`确定要删除用户 "${username}" 吗？该用户的所有学习数据将被永久删除，无法恢复。`)) return;
      try {
        await api(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
        toast('用户已删除');
        renderAdmin();
      } catch (err) {
        toast(err.message);
      }
    }
  });

  $('#btnAdminAddUser').addEventListener('click', () => {
    $('#adminNewUsername').value = '';
    $('#adminNewPassword').value = '';
    $('#adminNewNickname').value = '';
    $('#adminNewIsMember').checked = false;
    $('#adminAddUserError').textContent = '';
    $('#adminAddUserOverlay').hidden = false;
  });
  $('#adminAddUserClose').addEventListener('click', () => { $('#adminAddUserOverlay').hidden = true; });
  $('#adminAddUserOverlay').addEventListener('click', (e) => { if (e.target.id === 'adminAddUserOverlay') $('#adminAddUserOverlay').hidden = true; });

  $('#adminAddUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#adminAddUserError');
    errEl.textContent = '';
    try {
      await api('/admin/users', {
        method: 'POST',
        body: {
          username: $('#adminNewUsername').value.trim(),
          password: $('#adminNewPassword').value,
          nickname: $('#adminNewNickname').value.trim(),
          isMember: $('#adminNewIsMember').checked,
        },
      });
      $('#adminAddUserOverlay').hidden = true;
      toast('用户创建成功');
      renderAdmin();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  $('#adminResetPwClose').addEventListener('click', () => { $('#adminResetPwOverlay').hidden = true; });
  $('#adminResetPwOverlay').addEventListener('click', (e) => { if (e.target.id === 'adminResetPwOverlay') $('#adminResetPwOverlay').hidden = true; });

  $('#adminResetPwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = e.target.dataset.username;
    const errEl = $('#adminResetPwError');
    errEl.textContent = '';
    try {
      await api(`/admin/users/${encodeURIComponent(username)}/reset-password`, {
        method: 'POST',
        body: { newPassword: $('#adminResetPwInput').value },
      });
      $('#adminResetPwOverlay').hidden = true;
      toast(`已重置 ${username} 的密码`);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // ---------- 我的 / Profile ----------
  function renderProfile() {
    $('#profileNickname').value = state.user.nickname;
    $('#profileLang').value = state.user.targetLang;
    $('#profileLevel').value = state.user.level;
    const box = $('#profileMemberBox');
    if (state.user.isMember) {
      const date = new Date(state.user.memberSince).toLocaleDateString('zh-CN');
      const until = state.user.memberUntil
        ? `，有效期至 ${new Date(state.user.memberUntil).toLocaleDateString('zh-CN')}`
        : '';
      box.innerHTML = `✅ 会员已开通（${date}起${until}）
        <button class="btn btn-outline btn-sm" id="btnProfileRenew" style="margin-left:10px;">续费</button>`;
      $('#btnProfileRenew').addEventListener('click', upgradeMembership);
    } else {
      box.innerHTML = `尚未开通会员 <button class="btn btn-primary btn-sm" id="btnProfileUpgrade" style="margin-left:10px;">立即开通</button>`;
      $('#btnProfileUpgrade').addEventListener('click', upgradeMembership);
    }

    $('#profilePhoneVerified').hidden = !state.user.phoneVerified;
    $('#profilePhoneUnverified').hidden = !!state.user.phoneVerified;
    if (state.user.phoneVerified) {
      $('#profilePhoneNumber').textContent = state.user.phone || '';
    } else {
      $('#profileInputPhone').value = '';
      $('#profileInputPhoneCode').value = '';
      $('#profilePhoneHint').textContent = '';
      $('#profilePhoneError').textContent = '';
    }
  }

  let profilePhoneCountdownTimer = null;
  $('#btnProfileSendCode').addEventListener('click', async () => {
    const phone = $('#profileInputPhone').value.trim();
    const errEl = $('#profilePhoneError');
    const hintEl = $('#profilePhoneHint');
    errEl.textContent = '';
    if (!/^1[3-9]\d{9}$/.test(phone)) { errEl.textContent = '请输入正确的11位手机号'; return; }
    try {
      const data = await api('/auth/phone/send-code', { method: 'POST', body: { phone } });
      const btn = $('#btnProfileSendCode');
      let seconds = 60;
      btn.disabled = true;
      btn.textContent = `${seconds}秒后重发`;
      clearInterval(profilePhoneCountdownTimer);
      profilePhoneCountdownTimer = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
          clearInterval(profilePhoneCountdownTimer);
          btn.disabled = false;
          btn.textContent = '获取验证码';
        } else {
          btn.textContent = `${seconds}秒后重发`;
        }
      }, 1000);
      hintEl.textContent = data.devCode
        ? `测试模式（未接入真实短信服务）：验证码是 ${data.devCode}`
        : '验证码已发送，请查收短信';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  $('#btnProfileBindPhone').addEventListener('click', async () => {
    const phone = $('#profileInputPhone').value.trim();
    const code = $('#profileInputPhoneCode').value.trim();
    const errEl = $('#profilePhoneError');
    errEl.textContent = '';
    if (!/^1[3-9]\d{9}$/.test(phone)) { errEl.textContent = '请输入正确的11位手机号'; return; }
    if (!code) { errEl.textContent = '请输入验证码'; return; }
    try {
      const data = await api('/profile/bind-phone', { method: 'POST', body: { phone, code } });
      state.user = data.user;
      updateTopbar();
      renderProfile();
      toast('手机号验证成功，已解锁每日免费额度');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  $('#btnSaveProfile').addEventListener('click', async () => {
    const nickname = $('#profileNickname').value.trim();
    const targetLang = $('#profileLang').value;
    const level = $('#profileLevel').value;
    try {
      const data = await api('/profile', { method: 'POST', body: { nickname, targetLang, level } });
      state.user = data.user;
      updateTopbar();
      toast('设置已保存');
    } catch (err) {
      toast(err.message);
    }
  });

  $('#btnLogout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    clearAuthToken(); // App 端靠 token 认证，退出时必须一并清掉，否则下次打开还是登录态
    state.user = null;
    state.chatHistory = [];
    state.chatHistoryLoaded = false;
    state.mistakes = [];
    state.mistakeFile = null;
    updateTopbar();
    showView('landing');
    toast('已退出登录');
  });

  // 支付完成跳回本站后确认到账：支付平台的异步回调可能比用户跳回来晚几秒，
  // 这里重新拉一次账号状态，没生效就隔两秒再试几次，避免用户看到"付了钱还不是会员"
  async function confirmPaymentAfterReturn() {
    if (!new URLSearchParams(location.search).has('pay')) return;
    history.replaceState(null, '', location.pathname); // 清掉URL上的参数，刷新时不再重复触发
    for (let i = 0; i < 6; i++) {
      try {
        const data = await api('/me');
        if (data.user?.isMember) {
          state.user = data.user;
          updateTopbar();
          showView(currentViewName());
          toast('🎉 支付成功，会员已开通！');
          return;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    toast('支付结果确认中，如已付款请稍后刷新页面');
  }

  // 第三方登录跳回本站后的处理：网页端靠 cookie 已经登录了，
  // App(Capacitor) 端拿不到 cookie，所以后端把 token 放在 URL 上，这里取出来存下
  function handleOAuthReturn() {
    const q = new URLSearchParams(location.search);
    const err = q.get('login_error');
    const token = q.get('login_token');
    if (!err && !token) return;
    history.replaceState(null, '', location.pathname); // 清掉URL上的敏感参数
    if (token) setAuthToken(token);
    if (err) setTimeout(() => toast(err), 300);
  }

  // ---------- 启动 ----------
  async function init() {
    handleOAuthReturn();
    try {
      const data = await api('/me');
      if (data.user) {
        state.user = data.user;
        updateTopbar();
        await loadLanguages();
        showView('dashboard');
        confirmPaymentAfterReturn();
        return;
      }
    } catch {}
    showView('landing');
  }

  init();
})();
