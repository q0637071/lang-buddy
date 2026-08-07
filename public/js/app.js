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
  };

  const LEVEL_ZH = { beginner: '初级', intermediate: '中级', advanced: '高级' };
  const VOCAB_LEVEL_ZH = { cet4: '四级', cet6: '六级', toefl: '托福', gre: 'GRE' };
  const LANG_BCP47 = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

  // ---------- 工具函数 ----------
  const $ = (sel) => document.querySelector(sel);
  const $all = (sel) => Array.from(document.querySelectorAll(sel));

  async function api(path, options = {}) {
    const res = await fetch('/api' + path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || '请求失败');
      err.needMembership = data.needMembership;
      throw err;
    }
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
    if (name === 'vocab') loadVocabQueue();
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
  function rebuildAuthButtons() {
    const authArea = $('#authArea');
    authArea.innerHTML = '';
    const loginBtn = document.createElement('button');
    loginBtn.className = 'btn btn-ghost';
    loginBtn.textContent = '登录';
    loginBtn.id = 'btnShowLogin';
    loginBtn.addEventListener('click', () => openAuthModal('login'));

    const regBtn = document.createElement('button');
    regBtn.className = 'btn btn-primary';
    regBtn.textContent = '免费注册';
    regBtn.id = 'btnShowRegister';
    regBtn.addEventListener('click', () => openAuthModal('register'));

    authArea.appendChild(loginBtn);
    authArea.appendChild(regBtn);
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
  }
  function closeAuthModal() {
    $('#authModalOverlay').hidden = true;
    $('#authForm').reset();
    $('#phoneForm').reset();
    $('#phoneCodeHint').textContent = '';
    $('#phoneError').textContent = '';
  }
  function setAuthMode(mode) {
    state.authMode = mode;
    $('#tabLogin').classList.toggle('active', mode === 'login');
    $('#tabRegister').classList.toggle('active', mode === 'register');
    $('#tabPhone').classList.toggle('active', mode === 'phone');
    $('#authForm').hidden = mode === 'phone';
    $('#phoneForm').hidden = mode !== 'phone';
    $('#rowNickname').hidden = mode !== 'register';
    $('#authSubmitBtn').textContent = mode === 'login' ? '登录' : '注册并进入';
    $('#authError').textContent = '';
  }

  $('#modalClose').addEventListener('click', closeAuthModal);
  $('#authModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'authModalOverlay') closeAuthModal(); });
  $('#tabLogin').addEventListener('click', () => setAuthMode('login'));
  $('#tabRegister').addEventListener('click', () => setAuthMode('register'));
  $('#tabPhone').addEventListener('click', () => setAuthMode('phone'));

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
        data = await api('/register', { method: 'POST', body: { username, password, nickname } });
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
  let phoneCountdownTimer = null;

  function startPhoneCountdown() {
    const btn = $('#btnSendCode');
    let seconds = 60;
    btn.disabled = true;
    btn.textContent = `${seconds}秒后重发`;
    clearInterval(phoneCountdownTimer);
    phoneCountdownTimer = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(phoneCountdownTimer);
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
      startPhoneCountdown();
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

  async function upgradeMembership() {
    try {
      const data = await api('/membership/upgrade', { method: 'POST' });
      state.user = data.user;
      toast('🎉 会员开通成功！');
      showView(currentViewName());
    } catch (err) {
      toast(err.message);
    }
  }

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

  function renderTutor() {
    const needMember = !state.user.isMember;
    $('#tutorPaywall').hidden = !needMember;
    $('#tutorPanel').hidden = needMember;
    if (needMember) return;

    const toggle = $('#autoSpeakToggle');
    toggle.checked = state.autoSpeak;
    toggle.onchange = () => { state.autoSpeak = toggle.checked; };

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

  function populateVoiceSelect() {
    const select = $('#voiceSelect');
    if (!select) return;
    const lang = replyLangBcp47();
    const langPrefix = lang.split('-')[0];
    const matching = availableVoices.filter(v => v.lang.toLowerCase().startsWith(langPrefix));
    const list = matching.length ? matching : availableVoices;

    if (!list.length) {
      select.innerHTML = '<option value="">（当前设备没有可用的语音包）</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const saved = localStorage.getItem(voicePrefKey(lang));
    select.innerHTML = list.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name.replace(/^Microsoft /, ''))}</option>`).join('');
    if (saved && list.some(v => v.name === saved)) select.value = saved;
  }

  $('#voiceSelect').addEventListener('change', () => {
    const lang = replyLangBcp47();
    localStorage.setItem(voicePrefKey(lang), $('#voiceSelect').value);
  });

  $('#btnPreviewVoice').addEventListener('click', () => {
    const sample = { zh: '你好，我是你的语言私教。', en: 'Hello, I am your language tutor.', ja: 'こんにちは、私はあなたの語学の先生です。', ko: '안녕하세요, 저는 당신의 언어 선생님입니다.', fr: 'Bonjour, je suis votre professeur de langue.', de: 'Hallo, ich bin dein Sprachlehrer.', es: 'Hola, soy tu profesor de idiomas.' };
    speakText(sample[state.chatReplyLang] || sample.en);
  });

  function getPreferredVoice(lang) {
    const name = localStorage.getItem(voicePrefKey(lang));
    if (!name) return null;
    return availableVoices.find(v => v.name === name) || null;
  }

  $('#btnTutorUpgrade').addEventListener('click', upgradeMembership);
  $('#btnGrammarUpgrade').addEventListener('click', async () => { await upgradeMembership(); renderGrammarDetail(state.currentGrammarId); });

  function appendMsg(role, text, opts = {}) {
    state.chatHistory.push({ role, content: text });
    const win = $('#chatWindow');
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
    win.appendChild(div);
    win.scrollTop = win.scrollHeight;
    if (role === 'ai' && state.autoSpeak) {
      speakText(text, null, opts.onSpeakEnd);
    } else if (opts.onSpeakEnd) {
      opts.onSpeakEnd();
    }
  }

  async function sendChatMessage(message) {
    appendMsg('user', message);
    $('#chatSendBtn').disabled = true;
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
      appendMsg('ai', data.reply, {
        onSpeakEnd: () => { if (state.voiceCallActive) listenTurn(); },
      });
      if (state.voiceCallActive) setCallStatus('speaking', '🔊 AI 正在说话...');
    } catch (err) {
      if (err.needMembership) {
        toast('需要开通会员才能继续对话');
        stopVoiceCall();
        renderTutor();
      } else {
        toast(err.message);
        if (state.voiceCallActive) setCallStatus('error', '⚠️ 出错了，点击麦克风图标重试');
      }
    } finally {
      $('#chatSendBtn').disabled = false;
    }
  }

  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    sendChatMessage(message);
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
      'network': '语音识别网络异常，请检查网络后重试',
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

  function listenTurn() {
    if (!state.voiceCallActive) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setCallStatus('listening', '🎙️ 正在聆听，请说话...');
    recognition = new SpeechRecognition();
    recognition.lang = inputLangBcp47();
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript.trim();
      if (text) {
        sendChatMessage(text);
      } else if (state.voiceCallActive) {
        setTimeout(listenTurn, 600);
      }
    };
    recognition.onerror = (event) => {
      if (!state.voiceCallActive) return;
      if (event.error === 'not-allowed' || event.error === 'audio-capture') {
        toast(recognitionErrorMessage(event.error) + '，已退出语音对话模式');
        stopVoiceCall();
        return;
      }
      if (event.error === 'no-speech') {
        setCallStatus('listening', '🎙️ 没听到声音，请再说一次');
        setTimeout(() => { if (state.voiceCallActive) listenTurn(); }, 500);
        return;
      }
      setCallStatus('error', '⚠️ ' + recognitionErrorMessage(event.error));
      setTimeout(() => { if (state.voiceCallActive) listenTurn(); }, 1500);
    };
    recognition.start();
  }

  function startVoiceCall() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { toast('当前浏览器不支持语音识别，无法使用语音对话模式'); return; }
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
    if (recognition) { try { recognition.stop(); } catch {} }
    window.speechSynthesis.cancel();
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
    utter.onstart = () => setAvatarTalking(true);
    const finish = () => { setAvatarTalking(false); if (onEnd) onEnd(); };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  }

  // ---------- AI 头像：嘴型随语音张合，配合轻微摆动的"说话姿势" ----------
  let avatarMouthTimer = null;

  function setAvatarTalking(talking) {
    const avatar = $('#aiAvatar');
    if (!avatar) return; // 头像只在 AI 对话页存在，其他页面朗读（背单词等）不触发
    const mouth = $('#avatarMouth');
    const status = $('#avatarStatus');
    clearInterval(avatarMouthTimer);
    if (talking) {
      avatar.classList.add('talking');
      avatar.classList.remove('idle');
      status.textContent = '正在说话...';
      let open = false;
      avatarMouthTimer = setInterval(() => {
        open = !open;
        mouth.setAttribute('height', open ? '14' : '5');
        mouth.setAttribute('y', open ? '103' : '108');
        mouth.setAttribute('rx', open ? '4' : '2.5');
      }, 150);
    } else {
      avatar.classList.remove('talking');
      avatar.classList.add('idle');
      status.textContent = '待机中';
      mouth.setAttribute('height', '5');
      mouth.setAttribute('y', '108');
      mouth.setAttribute('rx', '2.5');
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
  $('#vocabLevelFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $all('#vocabLevelFilter .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    state.vocabLevel = btn.dataset.level;
    loadVocabQueue();
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

    if (state.autoSpeak) speakVocabWord(w.word);
  }

  $('#btnRevealCard').addEventListener('click', () => {
    $('#flashcardReveal').hidden = false;
    $('#flashcardActions').hidden = false;
    $('#flashcardPreActions').hidden = true;
  });

  async function submitVocabReview(remembered, skip) {
    const w = state.vocabQueue[state.vocabIndex];
    if (!w) return;
    try {
      await api('/vocab/review', { method: 'POST', body: { word: w.word, remembered, skip: !!skip } });
    } catch (err) {
      toast(err.message);
    }
    state.vocabIndex++;
    renderFlashcard();
  }
  $('#btnKnew').addEventListener('click', () => submitVocabReview(true));
  $('#btnForgot').addEventListener('click', () => submitVocabReview(false));
  $('#btnSkipWord').addEventListener('click', () => submitVocabReview(true, true));

  // ---------- 单词测试（根据当前学习状态出题） ----------
  function setVocabMode(mode) {
    // mode: 'review' | 'quiz' | 'quiz-result'
    $('#flashcardArea').hidden = mode !== 'review';
    $('#vocabEmpty').hidden = true;
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

    api('/vocab/review', { method: 'POST', body: { word: q.word, remembered: correct } }).catch(() => {});

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
    const needMember = !state.user.isMember;
    $('#mistakesPaywall').hidden = !needMember;
    $('#mistakesPanel').hidden = needMember;
    if (needMember) return;
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
      } else {
        $('#mistakeTextStatus').textContent = '❌ ' + err.message;
      }
    } finally {
      btn.disabled = false;
    }
  });

  $('#btnPickImage').addEventListener('click', () => $('#mistakeFileInput').click());
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
    const res = await fetch('/api/mistakes/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || '上传失败');
      err.needMembership = data.needMembership;
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
    const needMember = !state.user.isMember;
    $('#essayPaywall').hidden = !needMember;
    $('#essayPanel').hidden = needMember;
    if (needMember) return;
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

      $('#adminUsersBody').innerHTML = usersData.users.map(u => `
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
          <td>${new Date(u.createdAt).toLocaleDateString('zh-CN')}</td>
        </tr>
      `).join('');
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- 我的 / Profile ----------
  function renderProfile() {
    $('#profileNickname').value = state.user.nickname;
    $('#profileLang').value = state.user.targetLang;
    $('#profileLevel').value = state.user.level;
    const box = $('#profileMemberBox');
    if (state.user.isMember) {
      const date = new Date(state.user.memberSince).toLocaleDateString('zh-CN');
      box.innerHTML = `✅ 会员已开通（${date}起）`;
    } else {
      box.innerHTML = `尚未开通会员 <button class="btn btn-primary btn-sm" id="btnProfileUpgrade" style="margin-left:10px;">立即开通</button>`;
      $('#btnProfileUpgrade').addEventListener('click', upgradeMembership);
    }
  }

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
    state.user = null;
    state.chatHistory = [];
    state.mistakes = [];
    state.mistakeFile = null;
    updateTopbar();
    showView('landing');
    toast('已退出登录');
  });

  // ---------- 启动 ----------
  async function init() {
    try {
      const data = await api('/me');
      if (data.user) {
        state.user = data.user;
        updateTopbar();
        await loadLanguages();
        showView('dashboard');
        return;
      }
    } catch {}
    showView('landing');
  }

  init();
})();
