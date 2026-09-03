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
  const VIEWS = ['landing', 'dashboard', 'tutor', 'vocab', 'grammar', 'translate', 'colloquial', 'mistakes', 'essay', 'profile', 'admin'];

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
    if (name === 'translate') renderTranslate();
    if (name !== 'translate') stopTranslateListening(); // 离开页面就停掉麦克风，别一直占着
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
    const av = state.user.avatar;
    const avatarHtml = av?.type === 'image'
      ? `<img class="topbar-avatar" src="${escapeHtml(av.value)}" alt="">`
      : av?.type === 'preset'
        ? `<span class="topbar-avatar">${escapeHtml(av.value)}</span>`
        : `<span class="topbar-avatar topbar-avatar-letter">${escapeHtml((state.user.nickname || 'U').trim().charAt(0).toUpperCase())}</span>`;
    authArea.innerHTML = `${avatarHtml}<span class="topbar-name">${escapeHtml(state.user.nickname)}</span>`;
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

  // 免费额度提示文案。未绑手机号的账号（微信/QQ 登录进来的）只有一份很小的尝鲜额度，
  // 给它们换一套文案并指向手机验证。数值要和后端 allowMemberOrFreeQuota 里的
  // TRIAL_WINDOW_MS / TRIAL_COUNT 以及各路由的正常额度保持一致。
  function renderQuotaHint(bannerId, freeText, trialText) {
    const el = document.querySelector('#' + bannerId + ' p');
    if (el) el.textContent = state.user.phoneVerified ? freeText : trialText;
  }

  async function renderTutor() {
    $('#tutorPaywall').hidden = state.user.isMember;
    renderQuotaHint('tutorPaywall',
      '🎁 非会员每天可免费体验 5 分钟 AI 对话，开通会员畅享无限时长。',
      '🎁 当前可试用 1 分钟 AI 对话，在"我的"页面验证手机号即可解锁每天 5 分钟。');
    $('#tutorPanel').hidden = false;
    refreshAvatarButton();

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
    // getVoices() 首次调用常常是空的，标准做法是等 onvoiceschanged。
    // 但部分安卓浏览器（含国产机型）这个事件根本不触发，只靠它会永远停在空列表，
    // 所以再补一个短时轮询兜底：拿到音色就停，最多试10次（约5秒）。
    let voicePollLeft = 10;
    const voicePoll = setInterval(() => {
      if (availableVoices.length || --voicePollLeft <= 0) {
        clearInterval(voicePoll);
        return;
      }
      loadVoiceList();
    }, 500);
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
      // 拿不到音色列表 ≠ 不能朗读。很多国产安卓机自带 TTS 引擎但不向网页暴露音色清单，
      // 这时不指定 voice 直接朗读依然是正常出声的。所以这里只说"用系统默认声音"，
      // 不要写成"没有可用语音包"，那会让用户误以为功能坏了。
      select.innerHTML = '<option value="">系统默认声音</option>';
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


  // 生成聊天气泡旁边的小头像。用户没设头像就用昵称首字显示成彩色圆底，
  // 这样即使从没设置过也不会是空白的灰圈
  function buildAvatarEl(role) {
    const el = document.createElement('div');
    el.className = 'msg-avatar ' + (role === 'user' ? 'msg-avatar-user' : 'msg-avatar-ai');
    if (role === 'ai') {
      // 用当前所选形象的缩小版，保证聊天里的小头像和上方大图是同一个形象
      el.innerHTML = miniAvatarSvg(state.avatarStyle, 34) || '🌟';
      return el;
    }
    const av = state.user?.avatar;
    if (av?.type === 'image') {
      const img = document.createElement('img');
      img.src = av.value;
      img.alt = '';
      el.appendChild(img);
    } else if (av?.type === 'preset') {
      el.textContent = av.value;
    } else {
      el.textContent = (state.user?.nickname || 'U').trim().charAt(0).toUpperCase();
      el.classList.add('msg-avatar-letter');
    }
    return el;
  }

  function buildMsgEl(role, text) {
    // 外层负责排版（头像 + 气泡左右分布），气泡本身还是原来那个 .msg
    const row = document.createElement('div');
    row.className = 'msg-row ' + (role === 'user' ? 'msg-row-user' : 'msg-row-ai');

    const bubble = document.createElement('div');
    bubble.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-ai');
    bubble.textContent = text;
    if (role === 'ai') {
      const speak = document.createElement('span');
      speak.className = 'msg-speak';
      speak.textContent = '🔊';
      speak.title = '朗读';
      speak.addEventListener('click', () => speakText(text));
      bubble.appendChild(speak);
    }

    row.appendChild(buildAvatarEl(role));
    row.appendChild(bubble);
    return row;
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
    const row = document.createElement('div');
    row.className = 'msg-row msg-row-ai';
    row.id = 'chatTyping';
    const bubble = document.createElement('div');
    bubble.className = 'msg msg-ai msg-typing';
    bubble.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    row.appendChild(buildAvatarEl('ai'));
    row.appendChild(bubble);
    win.appendChild(row);
    win.scrollTop = win.scrollHeight;
  }
  function hideTypingBubble() {
    document.getElementById('chatTyping')?.remove();
  }

  // 出错时除了 toast，还在对话流里留一条提示。toast 两秒就消失了，
  // 用户如果正好没看到，就只会觉得"发出去石沉大海"
  function appendChatError(text) {
    const win = $('#chatWindow');
    const row = document.createElement('div');
    row.className = 'msg-row msg-row-ai';
    const bubble = document.createElement('div');
    bubble.className = 'msg msg-ai msg-error';
    bubble.textContent = '⚠️ ' + text;
    row.appendChild(buildAvatarEl('ai'));
    row.appendChild(bubble);
    win.appendChild(row);
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
      appendMsg('ai', data.reply, { onSpeakEnd: nextVoiceTurn });
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
    // 绝大多数安卓国产浏览器和App内置浏览器都没有 SpeechRecognition（iOS Safari 有），
    // 原来这里直接把按钮禁用掉，用户的体感就是"能听见AI说话，AI却听不见我"。
    // 现在改走"录一段音传给服务端识别"，和同声传译用的是同一条兜底路径。
    if (!SpeechRecognition) {
      if (!canRecord()) {
        micBtn.disabled = true;
        voiceCallBtn.disabled = true;
        hint.textContent = voiceInputUnavailableHint() + '（朗读仍可用，可改用打字输入）';
        return;
      }
      micBtn.disabled = false;
      voiceCallBtn.disabled = false;
      hint.textContent = CHAT_RECORD_HINT;
      micBtn.onclick = () => {
        unlockSpeechSynthesis();
        if (chatRecorder) stopChatRecording();
        else startChatRecording();
      };
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

  // ---------- 语音输入的服务端兜底（浏览器没有 SpeechRecognition 时） ----------
  // 原生识别是流式的、能自动判断"说完了"；录音兜底做不到，只能让用户点两次麦克风来划定一段。
  const CHAT_RECORD_HINT = '点麦克风开始录音，说完再点一次（当前浏览器不支持实时识别，已改用服务端识别）';
  let chatRecorder = null;
  let chatRecStream = null;

  function setChatVoiceStatus(text) {
    $('#voiceHint').textContent = text;
    if (state.voiceCallActive) setCallStatus('listening', text);
  }

  async function startChatRecording() {
    $('#voiceHint').textContent = '正在获取麦克风权限…';
    let stream;
    try {
      // 和同声传译一样要加超时：部分App内置浏览器会把权限弹窗吞掉，
      // getUserMedia 既不 resolve 也不 reject，界面就永远卡在这
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 6000)),
      ]);
    } catch (e) {
      const msg = e && e.message === 'TIMEOUT'
        ? voiceInputUnavailableHint()
        : '无法使用麦克风，请在浏览器设置中允许麦克风权限后重试';
      $('#voiceHint').textContent = '⚠️ ' + msg;
      toast(msg);
      if (state.voiceCallActive) stopVoiceCall();
      return;
    }
    chatRecStream = stream;
    const chunks = [];
    const rec = new MediaRecorder(stream); // 让浏览器自己挑格式，写死 mime 部分机型会抛错
    chatRecorder = rec;
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (chatRecStream) { chatRecStream.getTracks().forEach(t => t.stop()); chatRecStream = null; }
      chatRecorder = null;
      $('#micBtn').classList.remove('recording');
      if (blob.size > 1000) transcribeChatAudio(blob);
      else setChatVoiceStatus('🎙️ 没录到声音，点麦克风再说一次');
    };
    rec.start();
    $('#micBtn').classList.add('recording');
    setChatVoiceStatus('🔴 录音中…说完后再点一次麦克风');
  }

  function stopChatRecording() {
    const rec = chatRecorder;
    if (!rec) return;
    // 先取局部引用再置空：onstop 是异步触发的，里面用的是 rec，不会读到 null
    chatRecorder = null;
    try { if (rec.state !== 'inactive') rec.stop(); } catch {}
  }

  async function transcribeChatAudio(blob) {
    $('#voiceHint').textContent = '⏳ 识别中…';
    if (state.voiceCallActive) setCallStatus('thinking', '⏳ 正在识别你说的话...');
    try {
      const form = new FormData();
      form.append('audio', blob, 'speech.webm');
      form.append('language', state.chatInputLang || 'zh');
      const headers = {};
      const token = getAuthToken();
      if (token) headers.Authorization = 'Bearer ' + token;
      const resp = await fetch(API_BASE + '/transcribe', { method: 'POST', headers, credentials: 'include', body: form });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || '识别失败');
      const text = (data.text || '').trim();
      if (!text) { setChatVoiceStatus('🎙️ 没听清，点麦克风再说一次'); return; }
      $('#voiceHint').textContent = CHAT_RECORD_HINT;
      // 语音对话模式下直接发出去；单次输入模式填进输入框，让用户能改完再发
      if (state.voiceCallActive) sendChatMessage(text);
      else $('#chatInput').value = text;
    } catch (e) {
      $('#voiceHint').textContent = '⚠️ ' + e.message;
      toast(e.message);
      if (state.voiceCallActive) setCallStatus('error', '⚠️ ' + e.message);
    }
  }

  // 一轮说完之后怎么继续：有原生识别就自动开麦，走录音兜底时提示用户再点一次麦克风
  function nextVoiceTurn() {
    if (!state.voiceCallActive) return;
    if (hasNativeASR()) { listenTurn(); return; }
    setCallStatus('listening', '🎙️ 点麦克风开始说话，说完再点一次');
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
    const useRecording = !hasNativeASR();
    if (useRecording && !canRecord()) { toast(voiceInputUnavailableHint()); return; }
    unlockSpeechSynthesis();
    state.voiceErrorStreak = 0;
    state.voiceCallActive = true;
    state.autoSpeak = true;
    $('#autoSpeakToggle').checked = true;
    $('#autoSpeakToggle').disabled = true;
    // 录音兜底模式要靠用户点麦克风来划定每一段话，所以输入行不能藏起来
    $('#chatForm').hidden = !useRecording;
    $('#callStatusBar').hidden = false;
    $('#btnVoiceCall').hidden = true;
    try { window.speechSynthesis.cancel(); } catch {}
    if (useRecording) setCallStatus('listening', '🎙️ 点麦克风开始说话，说完再点一次');
    else listenTurn();
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
    stopChatRecording();
    if (chatRecStream) { chatRecStream.getTracks().forEach(t => t.stop()); chatRecStream = null; }
    $('#micBtn').classList.remove('recording');
    $('#voiceHint').textContent = hasNativeASR() ? '' : CHAT_RECORD_HINT;
    try { window.speechSynthesis.cancel(); } catch {}
    $('#autoSpeakToggle').disabled = false;
    $('#chatForm').hidden = false;
    $('#callStatusBar').hidden = true;
    $('#btnVoiceCall').hidden = false;
  }

  $('#btnVoiceCall').addEventListener('click', startVoiceCall);
  $('#btnEndVoiceCall').addEventListener('click', stopVoiceCall);

  // ---------- 数字人实时视频对话（Tavus） ----------
  // 按分钟计费，比文字对话贵得多，所以入口只在"后端开启 + 是会员 + 本月还有额度"时才出现。
  // 会话一定要关掉，否则会一直计费：结束按钮、关页面、倒计时到点，三条路都要能关。
  let avatarTimer = null;
  let avatarPingTimer = null;
  let avatarEnding = false;

  function fmtSeconds(s) {
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}分${String(s % 60).padStart(2, '0')}秒` : `${s}秒`;
  }

  async function refreshAvatarButton() {
    const cta = $('#avatarCta');
    const btn = $('#btnAvatarCall');
    if (!cta || !btn) return;
    try {
      const s = await api('/avatar/status');
      // 功能没开、或不是会员：整张卡片不出现（非会员由会员提示条负责引导，
      // 这个功能的单位成本远高于会员费，不能放进免费额度）
      if (!s.enabled || !s.isMember) { cta.hidden = true; return; }
      cta.hidden = false;
      // 全站名额用尽是账单硬顶，管理员也一样打不了，要先判断
      if (s.globalExhausted) {
        btn.disabled = true;
        btn.textContent = '本月名额已满';
        $('#avatarCtaSub').textContent = s.globalLimitSeconds
          ? `全站额度 ${Math.round(s.globalLimitSeconds / 60)} 分钟已用尽，下月 1 日恢复`
          : '本月体验名额已满，下月 1 日恢复';
        return;
      }
      // 超级管理员不限量，用于演示和排查
      if (s.unlimited) {
        btn.disabled = false;
        btn.textContent = '立即连接';
        // 管理员顺带看一眼全站用了多少，好判断离套餐上限还有多远
        $('#avatarCtaSub').textContent = s.globalLimitSeconds
          ? `管理员不限时长 · 全站本月已用 ${fmtSeconds(s.globalUsedSeconds)} / ${Math.round(s.globalLimitSeconds / 60)} 分钟`
          : '管理员账号，不限时长';
        return;
      }
      // 额度用完时不能让入口凭空消失——用户只会觉得"功能怎么突然没了"。
      // 卡片保留、按钮禁用，把原因写在副标题上。
      const out = s.remainingSeconds <= 0;
      btn.disabled = out;
      btn.textContent = out ? '额度已用完' : '立即连接';
      $('#avatarCtaSub').textContent = out
        ? `本月 ${s.monthlyMinutes} 分钟体验额度已用完，下月 1 日重置`
        : `免费体验 ${fmtSeconds(s.remainingSeconds)}（每月 ${s.monthlyMinutes} 分钟）`;
    } catch {
      cta.hidden = true; // 状态查不到就当没开，不要给个点了报错的入口
    }
  }

  async function startAvatarCall() {
    const btn = $('#btnAvatarCall');
    btn.disabled = true;
    $('#avatarStatus').textContent = '正在接通AI 视频通话…';
    $('#avatarStage').innerHTML = '';
    $('#avatarOverlay').hidden = false;
    try {
      const data = await api('/avatar/conversation', { method: 'POST' });
      const frame = document.createElement('iframe');
      // 通话界面真的加载出来了才发第一次心跳——服务端拿到第一跳才开始计费，
      // 点开就退或接通失败一律不扣额度
      frame.addEventListener('load', () => { api('/avatar/ping', { method: 'POST' }).catch(() => {}); });
      frame.src = data.conversationUrl;
      frame.allow = 'camera; microphone; fullscreen; display-capture; autoplay';
      frame.className = 'avatar-frame';
      $('#avatarStage').appendChild(frame);
      avatarEnding = false;
      startAvatarCountdown(data.maxSeconds);
      // 心跳：只要页面还开着就持续上报，服务端据此判断人什么时候真的走了。
      // 没有它，异常退出会被按单次上限满额扣费。
      clearInterval(avatarPingTimer);
      avatarPingTimer = setInterval(() => {
        api('/avatar/ping', { method: 'POST' }).catch(() => {});
      }, 20000);
      $('#avatarStatus').textContent = '接通后请允许摄像头和麦克风权限。';
    } catch (err) {
      $('#avatarStatus').textContent = '⚠️ ' + err.message;
      toast(err.message);
      $('#avatarOverlay').hidden = true;
    } finally {
      btn.disabled = false;
    }
  }

  function startAvatarCountdown(maxSeconds) {
    let left = maxSeconds;
    clearInterval(avatarTimer);
    const tick = () => {
      $('#avatarQuotaHint').textContent = `本次通话剩余 ${fmtSeconds(left)}`;
      if (left <= 0) { endAvatarCall('本次通话时长已到'); return; }
      left--;
    };
    tick();
    avatarTimer = setInterval(tick, 1000);
  }

  async function endAvatarCall(reason) {
    if (avatarEnding) return;
    avatarEnding = true;
    clearInterval(avatarTimer);
    clearInterval(avatarPingTimer);
    $('#avatarStage').innerHTML = ''; // 先卸掉 iframe，媒体流立刻断开
    $('#avatarOverlay').hidden = true;
    if (reason) toast(reason);
    try { await api('/avatar/end', { method: 'POST' }); } catch { /* 失败也不拦用户，服务端会在下次请求时补记 */ }
    refreshAvatarButton();
  }

  $('#btnAvatarCall').addEventListener('click', startAvatarCall);
  $('#btnAvatarEnd').addEventListener('click', () => endAvatarCall());

  // 直接关页面不会触发任何按钮，用 sendBeacon 补一刀，避免会话在服务商那边空转计费
  window.addEventListener('pagehide', () => {
    if (avatarEnding || $('#avatarOverlay').hidden) return;
    try { navigator.sendBeacon(API_BASE + '/avatar/end'); } catch {}
  });

  // 微信/QQ 等 App 内置浏览器普遍没有 speechSynthesis，
  // 只说"不支持"用户完全不知道该怎么办，这里给出可操作的指引
  function speechUnavailableHint() {
    const ua = navigator.userAgent || '';
    if (/MicroMessenger/i.test(ua)) {
      return '微信内置浏览器不支持朗读，请点右上角「···」→「在浏览器打开」';
    }
    if (/QQ\//i.test(ua) || /QQBrowser/i.test(ua)) {
      return 'QQ内置浏览器不支持朗读，请点右上角菜单→用手机自带浏览器打开';
    }
    if (/Weibo/i.test(ua)) {
      return '微博内置浏览器不支持朗读，请用手机自带浏览器打开本站';
    }
    return '当前浏览器不支持语音朗读，建议换用 Chrome 或手机自带浏览器';
  }

  // 常驻提示：toast 两秒就没了容易错过，在会用到朗读的页面上常显一条，
  // 让用户点朗读之前就知道该怎么办
  function setTtsNotice(msg) {
    ['#ttsNoticeVocab', '#ttsNoticeTutor'].forEach(sel => {
      const el = $(sel);
      if (el) { el.textContent = msg; el.hidden = !msg; }
    });
  }
  function renderTtsNotices() {
    if (window.speechSynthesis) return;
    // 没有原生朗读不等于不能听——会自动走服务端合成，只是首次稍慢，
    // 所以这里不要吓唬用户说"不支持"
    setTtsNotice('🔈 当前浏览器不支持原生朗读，已自动改用服务端语音（首次播放稍慢）');
  }

  // 浏览器不支持原生朗读时，改用服务端合成的音频播放。
  // 只在这种情况下才走服务端——原生朗读又快又不耗额度，能用就用。
  let ttsAudio = null;
  let serverTtsBroken = false; // 服务端也不可用时不再重复请求，直接给指引
  async function speakViaServer(text, onEnd) {
    if (serverTtsBroken) { toast(speechUnavailableHint()); if (onEnd) onEnd(); return; }
    try {
      if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
      setAvatarTalking(true);
      const headers = { 'Content-Type': 'application/json' };
      const token = getAuthToken();
      if (token) headers.Authorization = 'Bearer ' + token;
      const resp = await fetch(API_BASE + '/tts', {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        // 未启用/配置问题是持续性的，标记后不再反复请求，避免每点一次都等一次网络
        if (resp.status === 501 || resp.status === 503) {
          serverTtsBroken = true;
          // 服务端这条路也断了，这时才该引导用户换浏览器
          setTtsNotice('🔇 ' + speechUnavailableHint());
        }
        throw new Error(j.error || '朗读失败');
      }
      const url = URL.createObjectURL(await resp.blob());
      ttsAudio = new Audio(url);
      // 服务端音频拿不到词边界事件，用固定间隔让嘴型动起来
      startFallbackMouthLoop();
      const done = () => {
        clearInterval(avatarMouthTimer);
        setAvatarTalking(false);
        URL.revokeObjectURL(url);
        if (onEnd) onEnd();
      };
      ttsAudio.onended = done;
      ttsAudio.onerror = done;
      await ttsAudio.play();
    } catch (e) {
      setAvatarTalking(false);
      clearInterval(avatarMouthTimer);
      toast(e.message === '朗读失败' ? speechUnavailableHint() : e.message);
      if (onEnd) onEnd();
    }
  }

  function speakText(text, lang, onEnd) {
    if (!window.speechSynthesis) {
      speakViaServer(text, onEnd);
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
      transformOrigin: '100px 190px',
      mouth: { closed: { h: 6, y: 156, rx: 3 }, open: { h: 17, y: 150, rx: 8 } },
      markup: `
  <defs>
    <radialGradient id="avatarSkin" cx="38%" cy="32%" r="72%">
      <stop offset="0%" stop-color="#FFE7C9"/><stop offset="62%" stop-color="#FBD2A4"/><stop offset="100%" stop-color="#F0BC85"/>
    </radialGradient>
    <linearGradient id="avatarHair" x1="25%" y1="0%" x2="75%" y2="100%">
      <stop offset="0%" stop-color="#6E4B34"/><stop offset="55%" stop-color="#4B3122"/><stop offset="100%" stop-color="#352016"/>
    </linearGradient>
    <radialGradient id="avatarGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3DD9D2" stop-opacity=".26"/>
      <stop offset="100%" stop-color="#3DD9D2" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle class="avatar-glow" cx="100" cy="110" r="100" fill="url(#avatarGlow)"/>
  <text class="avatar-sparkle avatar-sparkle-1" x="14" y="50" font-size="13">✨</text>
  <text class="avatar-sparkle avatar-sparkle-2" x="170" y="42" font-size="10">✨</text>
  <g class="avatar-head">
    <!-- 头发整体：一大块，两侧垂到脸颊下方且末端是圆的 -->
    <path d="M100 22
             C147 22 174 60 174 108
             C174 140 170 166 164 184
             C158 192 146 192 142 184
             C138 168 138 148 138 136
             L62 136
             C62 148 62 168 58 184
             C54 192 42 192 36 184
             C30 166 26 140 26 108
             C26 60 53 22 100 22 Z" fill="url(#avatarHair)"/>
    <!-- 脸：比头发窄一圈，位置略靠下 -->
    <ellipse cx="100" cy="122" rx="54" ry="58" fill="url(#avatarSkin)"/>
    <!-- 齐刘海：下沿只用一条平滑的弧（之前分段画会出现两个凸起，像美人尖），
         并且压得低一些，额头不要太高，整体更显小孩子气 -->
    <path d="M42 108 C42 62 66 30 100 30 C134 30 158 62 158 108
             C136 118 64 118 42 108 Z" fill="url(#avatarHair)"/>
    <!-- 耳朵 -->
    <ellipse cx="47" cy="126" rx="8" ry="12" fill="url(#avatarSkin)"/>
    <ellipse cx="153" cy="126" rx="8" ry="12" fill="url(#avatarSkin)"/>
    <!-- 眼睛 -->
    <g class="avatar-eye avatar-eye-l">
      <ellipse cx="79" cy="126" rx="8.5" ry="10" fill="#2B1D14"/>
      <circle cx="81.8" cy="122.5" r="3" fill="#fff"/>
    </g>
    <g class="avatar-eye avatar-eye-r">
      <ellipse cx="121" cy="126" rx="8.5" ry="10" fill="#2B1D14"/>
      <circle cx="123.8" cy="122.5" r="3" fill="#fff"/>
    </g>
    <!-- 腮红 -->
    <ellipse cx="62" cy="146" rx="12" ry="6.5" fill="#FF9EB5" opacity=".5"/>
    <ellipse cx="138" cy="146" rx="12" ry="6.5" fill="#FF9EB5" opacity=".5"/>
    <!-- 嘴 -->
    <rect id="avatarMouth" x="89" y="156" width="22" height="6" rx="3" fill="#C4485E"/>
  </g>`,
    },
    western: {
      viewBox: '0 0 200 220',
      height: 141,
      transformOrigin: '100px 172px',
      mouth: { closed: { h: 7, y: 146, rx: 3.5 }, open: { h: 20, y: 140, rx: 9 } },
      markup: `
        <defs>
          <linearGradient id="avatarShoulder" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#6FE0DB"/><stop offset="100%" stop-color="#0ABAB5"/>
          </linearGradient>
          <linearGradient id="avatarSkin" x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stop-color="#FFEAD6"/><stop offset="100%" stop-color="#FBD3B4"/>
          </linearGradient>
          <linearGradient id="avatarHair" x1="15%" y1="0%" x2="85%" y2="100%">
            <stop offset="0%" stop-color="#FFDE8A"/><stop offset="55%" stop-color="#F5C963"/><stop offset="100%" stop-color="#E0A32E"/>
          </linearGradient>
          <radialGradient id="avatarGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#3DD9D2" stop-opacity=".28"/>
            <stop offset="100%" stop-color="#3DD9D2" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle class="avatar-glow" cx="100" cy="112" r="100" fill="url(#avatarGlow)"/>
        <text class="avatar-sparkle avatar-sparkle-1" x="20" y="58" font-size="13">✨</text>
        <text class="avatar-sparkle avatar-sparkle-2" x="166" y="48" font-size="10">✨</text>
        <path d="M22 220 C26 182 56 164 100 164 C144 164 174 182 178 220 Z" fill="url(#avatarShoulder)"/>
        <rect x="88" y="150" width="24" height="26" rx="11" fill="url(#avatarSkin)"/>
        <g class="avatar-head">
          <!-- 披肩长发 -->
          <path d="M30 96 C30 150 34 176 42 196 C50 186 52 160 50 138 L150 138 C148 160 150 186 158 196 C166 176 170 150 170 96 Z" fill="url(#avatarHair)"/>
          <ellipse cx="100" cy="104" rx="68" ry="68" fill="url(#avatarHair)"/>
          <ellipse cx="100" cy="110" rx="55" ry="58" fill="url(#avatarSkin)"/>
          <!-- 中分刘海 -->
          <path d="M43 96 C44 56 68 38 100 38 C132 38 156 56 157 96 C150 70 128 58 104 62 C104 78 96 78 96 62 C72 58 50 70 43 96 Z" fill="url(#avatarHair)"/>
          <ellipse cx="46" cy="116" rx="8" ry="12" fill="url(#avatarSkin)"/>
          <ellipse cx="154" cy="116" rx="8" ry="12" fill="url(#avatarSkin)"/>
          <g class="avatar-eye avatar-eye-l">
            <ellipse cx="78" cy="112" rx="10" ry="12" fill="#3A4A6B"/>
            <circle cx="81.5" cy="107.5" r="3.6" fill="#fff"/>
          </g>
          <g class="avatar-eye avatar-eye-r">
            <ellipse cx="122" cy="112" rx="10" ry="12" fill="#3A4A6B"/>
            <circle cx="125.5" cy="107.5" r="3.6" fill="#fff"/>
          </g>
          <!-- 雀斑 -->
          <circle cx="70" cy="128" r="1.8" fill="#D89A6A" opacity=".65"/>
          <circle cx="78" cy="133" r="1.6" fill="#D89A6A" opacity=".6"/>
          <circle cx="130" cy="128" r="1.8" fill="#D89A6A" opacity=".65"/>
          <circle cx="122" cy="133" r="1.6" fill="#D89A6A" opacity=".6"/>
          <ellipse cx="60" cy="132" rx="11" ry="6" fill="#FF9EB5" opacity=".5"/>
          <ellipse cx="140" cy="132" rx="11" ry="6" fill="#FF9EB5" opacity=".5"/>
          <rect id="avatarMouth" x="86" y="146" width="28" height="7" rx="3.5" fill="#D9556B"/>
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

  // 把某个形象的 SVG 做成缩小版，用于选择器按钮和聊天气泡旁的小头像。
  // 关键：必须给 id 加前缀做隔离。四个小图同时出现在页面上时，
  // 原始 markup 里的 avatarSkin / avatarHair 等渐变 id 会重名，
  // 浏览器只认第一个定义，结果所有头像都会串成同一套配色。
  function miniAvatarSvg(key, size) {
    const cfg = AVATAR_STYLES[key];
    if (!cfg) return '';
    const ns = 'm' + key + '_';
    const markup = cfg.markup
      .replace(/id="([\w-]+)"/g, (_, id) => `id="${ns}${id}"`)
      .replace(/url\(#([\w-]+)\)/g, (_, id) => `url(#${ns}${id})`);
    return `<svg class="mini-avatar-svg" viewBox="${cfg.viewBox}" width="${size}" height="${size}"
                 preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
  }

  // 选择器按钮直接显示各形象的缩小版，而不是另找 emoji 顶替——
  // 之前用 emoji 导致"小图标和大图长得不是一个人"
  function renderAvatarStyleButtons() {
    $all('.avatar-style-btn').forEach(btn => {
      const key = btn.dataset.style;
      if (AVATAR_STYLES[key]) btn.innerHTML = miniAvatarSvg(key, 34);
    });
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

  renderAvatarStyleButtons();
  renderTtsNotices();
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

  // ---------- 同声传译 ----------
  // 流程：连续听写 → 每听清一句就送去翻译 → 译文上屏并朗读。
  // 和"语音对话模式"的区别是这里不需要等AI回复再继续听，是一直听着的。
  let trRecognition = null;
  let trListening = false;
  let trRestartTimer = null;
  let trErrorStreak = 0;
  let trLastText = '';   // 上一句识别结果，用于去重
  let trLastAt = 0;

  function renderTranslate() {
    const opts = state.languages.map(l => `<option value="${l.code}">${escapeHtml(l.name)}</option>`).join('');
    const from = $('#trFromLang'), to = $('#trToLang');
    if (!from.options.length) {
      from.innerHTML = opts;
      to.innerHTML = opts;
      // 默认：对方说英语 → 翻译成中文，符合"听不懂外语"的主场景
      from.value = safeGetItem('lb_tr_from') || 'en';
      to.value = safeGetItem('lb_tr_to') || 'zh';
    }
    // 提示要把"听"和"说"两件事分开讲清楚，用户才知道自己该怎么操作
    const lacks = [];
    if (!hasNativeASR()) lacks.push('语音识别');
    if (!window.speechSynthesis) lacks.push('朗读');
    const el = $('#ttsNoticeTranslate');
    if (lacks.length) {
      el.textContent = `🔈 当前浏览器不支持${lacks.join('和')}，已自动改用服务端处理`
        + (hasNativeASR() ? '（首次播放稍慢）' : '：点「开始录音」，对方说完后再点「停止并翻译」');
      el.hidden = false;
    } else {
      el.hidden = true;
    }
    updateTrMicUI();
  }

  function updateTrMicUI() {
    $('#btnTrMic').classList.toggle('listening', trListening);
    // 两种模式的操作方式不同，按钮文案要如实反映，否则用户不知道该怎么用
    const recMode = !hasNativeASR();
    $('#trMicLabel').textContent = trListening
      ? (recMode ? '停止并翻译' : '停止收听')
      : (recMode ? '开始录音' : '开始收听');
  }

  $('#trFromLang').addEventListener('change', () => {
    safeSetItem('lb_tr_from', $('#trFromLang').value);
    if (trListening) { stopTranslateListening(); startTranslateListening(); } // 换语言要重开识别才生效
  });
  $('#trToLang').addEventListener('change', () => safeSetItem('lb_tr_to', $('#trToLang').value));

  $('#btnTrSwap').addEventListener('click', () => {
    const f = $('#trFromLang').value;
    $('#trFromLang').value = $('#trToLang').value;
    $('#trToLang').value = f;
    safeSetItem('lb_tr_from', $('#trFromLang').value);
    safeSetItem('lb_tr_to', $('#trToLang').value);
    if (trListening) { stopTranslateListening(); startTranslateListening(); }
  });

  $('#btnTrMic').addEventListener('click', () => {
    if (trListening) stopTranslateListening();
    else startTranslateListening();
  });

  $('#btnTrClear').addEventListener('click', () => {
    $('#trResults').innerHTML = '';
    $('#btnTrClear').hidden = true;
  });

  // 浏览器没有 SpeechRecognition 时（微信/QQ内置浏览器）改用"录一段音上传识别"。
  // 这是唯一能让这些用户用上翻译的办法——原来只在状态栏改一行小字，
  // 按钮毫无变化，用户看起来就是"点了没反应"。
  const hasNativeASR = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

  let trMediaRecorder = null;
  let trChunks = [];
  let trStream = null;

  // 语音输入不可用时的指引。之前是拿朗读的提示做字符串替换拼出来的，
  // 对匹配不到的浏览器（比如百度App）替换会失效、说成"不支持朗读"，答非所问。
  function voiceInputUnavailableHint() {
    const ua = navigator.userAgent || '';
    if (/MicroMessenger/i.test(ua)) return '微信内置浏览器不支持语音输入，请点右上角「···」→「在浏览器打开」';
    if (/baiduboxapp|baiduhd/i.test(ua)) return '百度App内置浏览器不支持语音输入，请点右上角菜单→「用其他浏览器打开」';
    if (/QQ\//i.test(ua) || /QQBrowser/i.test(ua)) return 'QQ内置浏览器不支持语音输入，请用手机自带浏览器打开';
    if (/Weibo/i.test(ua)) return '微博内置浏览器不支持语音输入，请用手机自带浏览器打开';
    return '当前浏览器不支持语音输入，建议换用 Chrome / Safari 或手机自带浏览器';
  }

  function failVoiceInput(msg) {
    $('#trStatus').textContent = '⚠️ ' + msg;
    toast(msg);
  }

  function startTranslateListening() {
    unlockSpeechSynthesis();
    if (hasNativeASR()) {
      trListening = true;
      trErrorStreak = 0;
      updateTrMicUI();
      listenTranslateTurn();
      return;
    }
    if (canRecord()) {
      startRecordingMode();
      return;
    }
    failVoiceInput(voiceInputUnavailableHint());
  }

  async function startRecordingMode() {
    // 点了要立刻有反馈，否则等权限的这几秒用户会以为按钮坏了
    $('#trStatus').textContent = '正在获取麦克风权限…';
    try {
      // 必须加超时：部分App内置浏览器（百度、微信等）会把权限弹窗吞掉，
      // getUserMedia 既不resolve也不reject，界面就永远停在这里毫无反应
      trStream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 6000)),
      ]);
    } catch (e) {
      failVoiceInput(e && e.message === 'TIMEOUT'
        ? voiceInputUnavailableHint()          // 权限弹窗被吞，等同于不支持
        : '无法使用麦克风，请在浏览器设置中允许麦克风权限后重试');
      return;
    }
    trChunks = [];
    // 让浏览器自己挑支持的格式，写死 mime 在部分机型上会直接抛错。
    // onstop 里必须用这个局部 rec 而不是 trMediaRecorder：停止时会把外层变量置空，
    // 而 onstop 是异步触发的，读 null.mimeType 会抛错，整段录音就被静默丢弃了。
    const rec = new MediaRecorder(trStream);
    trMediaRecorder = rec;
    rec.ondataavailable = (e) => { if (e.data.size) trChunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(trChunks, { type: rec.mimeType || 'audio/webm' });
      trChunks = [];
      // 音轨要等 onstop 之后再关，提前关会丢掉最后一个数据块
      if (trStream) { trStream.getTracks().forEach(t => t.stop()); trStream = null; }
      if (blob.size > 1000) transcribeAndTranslate(blob);
      else $('#trStatus').textContent = '没录到声音，再试一次';
    };
    rec.start();
    trListening = true;
    updateTrMicUI();
    $('#trStatus').textContent = '🔴 录音中…对方说完后点「停止并翻译」';
  }

  async function transcribeAndTranslate(blob) {
    const from = $('#trFromLang').value;
    $('#trStatus').textContent = '⏳ 识别中…';
    try {
      const form = new FormData();
      form.append('audio', blob, 'speech.webm');
      form.append('language', from);
      const headers = {};
      const token = getAuthToken();
      if (token) headers.Authorization = 'Bearer ' + token;
      const resp = await fetch(API_BASE + '/transcribe', { method: 'POST', headers, credentials: 'include', body: form });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || '识别失败');
      const text = (data.text || '').trim();
      if (!text) { $('#trStatus').textContent = '没听清，再说一次'; return; }
      $('#trStatus').textContent = '点「开始录音」继续';
      translateAndShow(text);
    } catch (e) {
      $('#trStatus').textContent = '⚠️ ' + e.message;
      toast(e.message);
    }
  }

  function stopTranslateListening() {
    if (!trListening && !trRecognition && !trMediaRecorder) return;
    trListening = false;
    trResumeAfterSpeech = false; // 用户主动停了，朗读结束后不要再自动开麦
    clearTimeout(trRestartTimer);
    if (trRecognition) {
      try { trRecognition.abort(); } catch { try { trRecognition.stop(); } catch {} }
      trRecognition = null;
    }
    if (trMediaRecorder) {
      // 录音模式下停止会触发 onstop，那里会把这段音频送去识别翻译，并负责关掉音轨。
      // 这里不能顺手把 trStream 也关了——onstop 还没跑，提前关会丢掉最后一段音频。
      const rec = trMediaRecorder;
      trMediaRecorder = null;
      try { if (rec.state !== 'inactive') rec.stop(); } catch {}
    } else {
      $('#trStatus').textContent = '已停止。点击「开始收听」继续';
      if (trStream) { trStream.getTracks().forEach(t => t.stop()); trStream = null; }
    }
    updateTrMicUI();
  }

  function listenTranslateTurn() {
    if (!trListening) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const fromLang = $('#trFromLang').value;
    $('#trStatus').textContent = '🎙️ 正在收听...';

    // 开新一轮前先确保上一个实例已停：否则异常路径下可能出现多个识别实例
    // 同时在跑，回调叠加会重复触发翻译
    if (trRecognition) {
      try { trRecognition.onresult = trRecognition.onerror = trRecognition.onend = null; } catch {}
      try { trRecognition.abort(); } catch {}
    }
    trRecognition = new SR();
    trRecognition.lang = LANG_BCP47[fromLang] || 'en-US';
    trRecognition.interimResults = false;
    trRecognition.maxAlternatives = 1;

    // 和语音对话模式踩过同样的坑：部分安卓机型 onresult/onerror 都不触发，
    // 会永远卡在"正在收听"。settled 防止兜底和原生回调重复处理同一轮。
    let settled = false;
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(trRestartTimer); fn(); };

    trRecognition.onresult = (e) => finish(() => {
      if (!trListening) return;
      trErrorStreak = 0;
      const said = e.results[0][0].transcript.trim();
      // 去重：环境噪音、回声、或识别器抖动都可能把同一句连着报好几次，
      // 不挡住的话既刷屏又白烧AI额度
      const now = Date.now();
      const isDup = said && said === trLastText && now - trLastAt < 3000;
      if (said && !isDup) {
        trLastText = said;
        trLastAt = now;
        translateAndShow(said);
      }
      // 稍作间隔再开下一轮：不加延迟的话，识别器若快速连续返回会形成失控循环
      trRestartTimer = setTimeout(() => { if (trListening) listenTranslateTurn(); }, 300);
    });

    trRecognition.onerror = (e) => finish(() => handleTrError(e.error));
    trRecognition.onend = () => finish(() => handleTrError('no-speech'));

    try {
      trRecognition.start();
    } catch {
      finish(() => handleTrError('timeout'));
      return;
    }
    trRestartTimer = setTimeout(() => finish(() => {
      try { trRecognition.abort(); } catch {}
      handleTrError('timeout');
    }), 12000);
  }

  function handleTrError(err) {
    if (!trListening) return;
    if (err === 'not-allowed' || err === 'audio-capture') {
      $('#trStatus').textContent = '⚠️ ' + recognitionErrorMessage(err);
      stopTranslateListening();
      return;
    }
    if (err === 'no-speech' || err === 'timeout') {
      // 没人说话是常态，静默重开继续听
      trRestartTimer = setTimeout(() => { if (trListening) listenTranslateTurn(); }, 400);
      return;
    }
    trErrorStreak++;
    if (trErrorStreak >= 3) {
      $('#trStatus').textContent = '⚠️ ' + recognitionErrorMessage(err);
      stopTranslateListening();
      return;
    }
    trRestartTimer = setTimeout(() => { if (trListening) listenTranslateTurn(); }, 1200);
  }

  // 朗读译文期间先把麦克风停掉，读完再恢复监听。两个原因：
  // 1) 手机上麦克风开着时系统会切到"通话模式"，播放走听筒而不是扬声器，
  //    音量小且录屏抓不到声音——录演示视频时会发现只有自己的声音没有译文。
  // 2) 更要紧的是，开着麦克风时AI读出来的译文会被重新听到、再翻译一遍，形成回声循环。
  let trResumeAfterSpeech = false;
  function speakTranslation(text, lang) {
    if (trListening && hasNativeASR()) {
      trResumeAfterSpeech = true;
      clearTimeout(trRestartTimer);
      if (trRecognition) {
        try { trRecognition.onresult = trRecognition.onerror = trRecognition.onend = null; } catch {}
        try { trRecognition.abort(); } catch {}
        trRecognition = null;
      }
      $('#trStatus').textContent = '🔊 正在朗读译文…';
    }
    speakText(text, lang, () => {
      if (!trResumeAfterSpeech) return;
      trResumeAfterSpeech = false;
      // 留一点间隔再开麦，避免尾音被当成新的一句
      trRestartTimer = setTimeout(() => { if (trListening) listenTranslateTurn(); }, 500);
    });
  }

  async function translateAndShow(text) {
    const to = $('#trToLang').value;
    const from = $('#trFromLang').value;
    // 先把原文占位上屏，让用户马上看到"听到了"，翻译回来再填
    const row = document.createElement('div');
    row.className = 'tr-item';
    row.innerHTML = `
      <div class="tr-src">${escapeHtml(text)}</div>
      <div class="tr-dst tr-pending">翻译中...</div>`;
    $('#trResults').prepend(row);
    $('#btnTrClear').hidden = false;

    try {
      const data = await api('/translate', { method: 'POST', body: { text, from, to } });
      const dst = row.querySelector('.tr-dst');
      dst.textContent = data.translation;
      dst.classList.remove('tr-pending');
      const speak = document.createElement('span');
      speak.className = 'msg-speak';
      speak.textContent = '🔊';
      speak.title = '重听';
      speak.addEventListener('click', () => speakTranslation(data.translation, LANG_BCP47[to]));
      dst.appendChild(speak);
      if ($('#trAutoSpeak').checked) speakTranslation(data.translation, LANG_BCP47[to]);
    } catch (err) {
      const dst = row.querySelector('.tr-dst');
      dst.textContent = '⚠️ ' + err.message;
      dst.classList.remove('tr-pending');
      dst.classList.add('tr-failed');
      if (err.needMembership || err.needPhoneVerify) stopTranslateListening();
    }
  }

  // ---------- 语法 ----------
  async function renderGrammarList() {
    $('#grammarDetail').hidden = true;
    $('#grammarList').hidden = false;
    try {
      const data = await api('/grammar/list');
      state.grammarLessons = data.lessons;
      // 课程变多后平铺一长列不好找，按难度分组并标上序号
      const GROUPS = [
        { key: 'basic', label: '基础', desc: '零基础到能说完整句子' },
        { key: 'intermediate', label: '进阶', desc: '时态、语态、非谓语' },
        { key: 'advanced', label: '高级', desc: '各类从句与复杂句式' },
      ];
      $('#grammarList').innerHTML = GROUPS.map(g => {
        const items = data.lessons.filter(l => (l.level || 'basic') === g.key);
        if (!items.length) return '';
        return `
          <div class="grammar-group">
            <div class="grammar-group-head">
              <span class="grammar-group-label grammar-level-${g.key}">${g.label}</span>
              <span class="grammar-group-desc">${g.desc}</span>
              <span class="grammar-group-count">${items.length} 课</span>
            </div>
            ${items.map((l, i) => `
              <div class="grammar-item" data-id="${escapeHtml(l.id)}">
                <h4><span class="grammar-item-no">${i + 1}</span>${escapeHtml(l.title)}</h4>
                <p>${escapeHtml(l.summary)}</p>
              </div>
            `).join('')}
          </div>`;
      }).join('');
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

      // 常见错误是新加的字段，老课程数据可能没有，没有就整块隐藏
      const mistakes = lesson.mistakes || [];
      $('#grammarMistakesBlock').hidden = mistakes.length === 0;
      $('#grammarMistakes').innerHTML = mistakes.map(m => `
        <div class="grammar-mistake">
          <div class="gm-wrong">❌ ${escapeHtml(m.wrong)}</div>
          <div class="gm-right">✅ ${escapeHtml(m.right)}</div>
          <div class="gm-why">${escapeHtml(m.why)}</div>
        </div>
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

      // 语法批改已开放每日3次免费额度：输入面板对所有人可见，非会员额外顶一条额度提示
      $('#grammarCheckerPaywall').hidden = !!state.user.isMember;
      $('#grammarCheckerPanel').hidden = false;
      renderQuotaHint('grammarCheckerPaywall',
        '🎁 非会员每天可免费体验 3 次 AI 语法批改，开通会员畅享无限次使用。',
        '🎁 当前可试用 1 次 AI 语法批改，在"我的"页面验证手机号即可解锁每天 3 次。');
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
        toast(err.message);
        renderGrammarDetail(state.currentGrammarId);
      } else if (err.needPhoneVerify) {
        toast(err.message);
        showView('profile');
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
    renderQuotaHint('mistakesPaywall',
      '🎁 非会员每天可免费体验 3 次错题解析，开通会员畅享无限次使用。',
      '🎁 当前可试用 1 次错题解析，在"我的"页面验证手机号即可解锁每天 3 次。');
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
    renderQuotaHint('essayPaywall',
      '🎁 非会员每天可免费体验 3 次 AI 作文批改，开通会员畅享无限次使用。',
      '🎁 当前可试用 1 次 AI 作文批改，在"我的"页面验证手机号即可解锁每天 3 次。');
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
  function fmtDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const AUTH_METHOD_ZH = {
    password: '账号密码', phone: '手机验证码', register: '注册', qq: 'QQ', wechat: '微信',
  };

  async function openAuthLog(username) {
    try {
      const data = await api(`/admin/users/${encodeURIComponent(username)}/auth-log`);
      $('#authLogTitle').textContent = `${username} 的登录记录`;
      $('#authLogBody').innerHTML = data.log.length
        ? data.log.map(e => `
            <tr>
              <td>${new Date(e.at).toLocaleString('zh-CN')}</td>
              <td>${e.type === 'login' ? '<span class="admin-badge-yes">登录</span>' : '<span class="admin-badge-no">登出</span>'}</td>
              <td>${escapeHtml(AUTH_METHOD_ZH[e.method] || e.method || '—')}</td>
              <td>${escapeHtml(e.ip || '—')}</td>
            </tr>`).join('')
        : '<tr><td colspan="4">暂无记录（该功能上线后产生的登录才会被记录）</td></tr>';
      $('#authLogOverlay').hidden = false;
    } catch (err) {
      toast(err.message);
    }
  }
  $('#authLogClose').addEventListener('click', () => { $('#authLogOverlay').hidden = true; });
  $('#authLogOverlay').addEventListener('click', (e) => { if (e.target.id === 'authLogOverlay') $('#authLogOverlay').hidden = true; });

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
          <td class="admin-col-ip">${escapeHtml(u.regIsp || '-')}</td>
          <td class="admin-col-ip">${fmtDateTime(u.lastLoginAt)}</td>
          <td class="admin-col-ip">${fmtDateTime(u.lastLogoutAt)}</td>` : '';
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
            ${isSuper ? `<button type="button" class="btn-admin-action" data-action="auth-log" data-username="${escapeHtml(u.username)}">登录记录</button>` : ''}
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
    } else if (action === 'auth-log') {
      openAuthLog(username);
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
  // ---------- 我的头像 ----------
  const AVATAR_PRESETS = ['🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐧', '🦉', '🐬', '🦄', '🌸', '⭐'];

  // 头像必须压得很小：整个数据库是一个 Mongo 文档（16MB上限），几KB一张才撑得住。
  // 这里一律重新编码成 96×96 的 JPEG（而不是"够小就原样返回"），
  // 否则一张 96×96 但体积很大的 PNG 会原样上传然后被服务端拒绝，用户会一头雾水。
  // 同时按短边居中裁剪成正方形，避免非正方形头像被拉变形。
  function toAvatarDataUrl(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const S = 96;
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, S, S);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
      img.src = url;
    });
  }

  function renderAvatarPicker() {
    const av = state.user?.avatar;
    const cur = $('#profileAvatarCurrent');
    cur.innerHTML = '';
    if (av?.type === 'image') {
      const img = document.createElement('img');
      img.src = av.value;
      cur.appendChild(img);
    } else if (av?.type === 'preset') {
      cur.textContent = av.value;
    } else {
      cur.textContent = (state.user?.nickname || 'U').trim().charAt(0).toUpperCase();
      cur.classList.add('is-letter');
    }
    if (av) cur.classList.remove('is-letter');

    $('#avatarPresetGrid').innerHTML = AVATAR_PRESETS.map(p => `
      <button type="button" class="avatar-preset${av?.type === 'preset' && av.value === p ? ' active' : ''}" data-preset="${p}">${p}</button>
    `).join('');
  }

  async function saveAvatar(payload) {
    try {
      const data = await api('/profile/avatar', { method: 'POST', body: payload });
      state.user = data.user;
      renderAvatarPicker();
      updateTopbar();
      $('#avatarHint').textContent = '已保存';
      setTimeout(() => { $('#avatarHint').textContent = ''; }, 2000);
    } catch (err) {
      $('#avatarHint').textContent = err.message;
    }
  }

  $('#avatarPresetGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.avatar-preset');
    if (btn) saveAvatar({ type: 'preset', value: btn.dataset.preset });
  });
  $('#btnUploadAvatar').addEventListener('click', (e) => {
    e.stopPropagation(); // 同错题本那个坑：避免冒泡导致文件框被触发两次
    $('#avatarFileInput').click();
  });
  $('#btnClearAvatar').addEventListener('click', () => saveAvatar({ type: 'none' }));

  $('#avatarFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // 允许连续选同一张图
    if (!file) return;
    if (!file.type.startsWith('image/')) { $('#avatarHint').textContent = '请选择图片文件'; return; }
    $('#avatarHint').textContent = '处理中...';
    try {
      await saveAvatar({ type: 'image', value: await toAvatarDataUrl(file) });
    } catch (err) {
      $('#avatarHint').textContent = err.message || '处理失败';
    }
  });

  function renderProfile() {
    $('#profileNickname').value = state.user.nickname;
    $('#profileLang').value = state.user.targetLang;
    $('#profileLevel').value = state.user.level;
    renderAvatarPicker();
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
