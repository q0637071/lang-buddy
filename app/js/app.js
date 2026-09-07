/* LangBuddy App。与网站 public/js/app.js 完全独立——改这里不影响网站。
   后端是同一套 API，只是界面按 App 的流程重新组织。 */
(function () {
  'use strict';

  window.__APP_BOOTED__ = true;

  // ---------- 基础 ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // 打包进 App 时页面是 capacitor:// 协议，必须打绝对地址；
  // 用浏览器直接开 app/index.html 调试时走同源的 /api
  const IS_NATIVE = location.protocol === 'capacitor:' || location.protocol === 'file:';
  const API = window.LB_API_BASE || (IS_NATIVE ? 'https://langbuddy.org/api' : '/api');

  const TOKEN_KEY = 'lb_app_token';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  const state = { user: null, questions: [], answers: {}, qIndex: 0 };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const loading = (on) => { $('#loading').hidden = !on; };

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const token = store.get(TOKEN_KEY);
    if (token) headers.Authorization = 'Bearer ' + token;

    // 手机网络不稳时 fetch 可能一直挂着，不加超时用户只会看到按钮点了没反应
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30000);
    let res;
    try {
      res = await fetch(API + path, {
        method, headers, credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? '网络超时，请检查网络后重试' : '网络连接失败，请稍后再试');
    }
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败(${res.status})`);
    if (data.token) store.set(TOKEN_KEY, data.token);
    return data;
  }

  // ---------- 屏幕切换 ----------
  const SCREENS = ['s-welcome', 's-login', 's-register', 's-test-intro', 's-test', 's-result', 's-home'];
  function go(id) {
    SCREENS.forEach(s => { $('#' + s).hidden = s !== id; });
    const body = $('#' + id + ' .screen-body');
    if (body) body.scrollTop = 0;
  }
  $$('[data-go]').forEach(el => el.addEventListener('click', () => go(el.dataset.go)));
  $$('[data-back]').forEach(el => el.addEventListener('click', () => go(el.dataset.back)));

  // ---------- 欢迎 ----------
  $('#btnStart').addEventListener('click', () => go('s-register'));
  $('#btnGoLogin').addEventListener('click', () => go('s-login'));

  // ---------- 登录 ----------
  $('#btnLogin').addEventListener('click', async () => {
    const username = $('#loginUser').value.trim();
    const password = $('#loginPass').value;
    const err = $('#loginErr');
    err.hidden = true;
    if (!username || !password) { err.textContent = '请填写用户名和密码'; err.hidden = false; return; }
    loading(true);
    try {
      const data = await api('/login', { method: 'POST', body: { username, password } });
      state.user = data.user;
      await afterAuth();
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
    } finally { loading(false); }
  });

  // ---------- 注册 ----------
  let codeTimer = null;
  $('#btnSendCode').addEventListener('click', async () => {
    const phone = $('#regPhone').value.trim();
    const hint = $('#regHint'), err = $('#regErr');
    err.hidden = true;
    if (!/^1\d{10}$/.test(phone)) { err.textContent = '请输入正确的 11 位手机号'; err.hidden = false; return; }
    const btn = $('#btnSendCode');
    btn.disabled = true;
    try {
      const data = await api('/auth/phone/send-code', { method: 'POST', body: { phone } });
      // 后端未接短信服务商时会把验证码直接返回，方便本地和内测阶段自测
      hint.textContent = data.devCode ? `测试模式，验证码：${data.devCode}` : '验证码已发送';
      hint.hidden = false;
      let left = 60;
      btn.textContent = left + 's';
      codeTimer = setInterval(() => {
        left--;
        if (left <= 0) { clearInterval(codeTimer); btn.disabled = false; btn.textContent = '获取验证码'; }
        else btn.textContent = left + 's';
      }, 1000);
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      btn.disabled = false;
    }
  });

  $('#btnRegister').addEventListener('click', async () => {
    const body = {
      nickname: $('#regNick').value.trim(),
      username: $('#regUser').value.trim(),
      password: $('#regPass').value,
      phone: $('#regPhone').value.trim(),
      code: $('#regCode').value.trim(),
    };
    const err = $('#regErr');
    err.hidden = true;
    loading(true);
    try {
      const data = await api('/register', { method: 'POST', body });
      state.user = data.user;
      await afterAuth();
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
    } finally { loading(false); }
  });

  // 登录/注册成功后的分流：没测过就先测评，测过直接进首页
  async function afterAuth() {
    let st = null;
    try { st = await api('/placement/status'); } catch {}
    if (st && !st.done) {
      $('#introCount').textContent = st.questionCount || 15;
      go('s-test-intro');
    } else {
      renderHome(st);
      go('s-home');
    }
  }

  // ---------- 测评 ----------
  $('#btnSkipTest').addEventListener('click', () => { renderHome(null); go('s-home'); });

  $('#btnBeginTest').addEventListener('click', async () => {
    loading(true);
    try {
      const data = await api('/placement/questions');
      state.questions = data.questions;
      state.answers = {};
      state.qIndex = 0;
      renderQuestion();
      go('s-test');
    } catch (e) { toast(e.message); } finally { loading(false); }
  });

  const TIER_LABEL = { 1: '入门', 2: '基础', 3: '进阶', 4: '较难', 5: '挑战' };

  function renderQuestion() {
    const q = state.questions[state.qIndex];
    if (!q) return;
    const total = state.questions.length;
    $('#testProgressText').textContent = `${state.qIndex + 1} / ${total}`;
    $('#testProgress').style.width = ((state.qIndex) / total * 100) + '%';
    $('#qTier').textContent = TIER_LABEL[q.tier] || '';
    $('#qText').textContent = q.question;

    const wrap = $('#qOptions');
    wrap.innerHTML = '';
    q.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'q-opt' + (state.answers[q.id] === i ? ' picked' : '');
      b.textContent = opt;
      // 选完稍作停顿再翻页：立刻切走会让人怀疑自己有没有点中
      b.addEventListener('click', () => {
        state.answers[q.id] = i;
        $$('#qOptions .q-opt').forEach(x => x.classList.remove('picked'));
        b.classList.add('picked');
        setTimeout(nextQuestion, 180);
      });
      wrap.appendChild(b);
    });
    $('#btnTestPrev').style.visibility = state.qIndex === 0 ? 'hidden' : 'visible';
  }

  function nextQuestion() {
    if (state.qIndex < state.questions.length - 1) {
      state.qIndex++;
      renderQuestion();
    } else {
      submitTest();
    }
  }
  $('#btnTestSkip').addEventListener('click', nextQuestion);
  $('#btnTestPrev').addEventListener('click', () => {
    if (state.qIndex > 0) { state.qIndex--; renderQuestion(); }
  });

  const LEVEL_ZH = { beginner: '初级', intermediate: '中级', advanced: '高级' };
  const LEVEL_DESC = {
    beginner: '我们会从基础句型和高频词开始，AI 对话时会放慢速度、用简单表达。',
    intermediate: '你已经有不错的基础，接下来重点练表达的自然度和词汇的精准度。',
    advanced: '基础很扎实，之后会用更地道的表达和更复杂的话题来挑战你。',
  };

  async function submitTest() {
    loading(true);
    try {
      const r = await api('/placement/submit', { method: 'POST', body: { answers: state.answers } });
      $('#resCefr').textContent = r.cefr;
      $('#resLevel').textContent = LEVEL_ZH[r.level] || r.level;
      $('#resScore').textContent = `答对 ${r.correct} / ${r.total} 题`;
      $('#resDesc').textContent = LEVEL_DESC[r.level] || '';
      if (state.user) state.user.level = r.level;
      state.lastResult = r;
      go('s-result');
    } catch (e) { toast(e.message); } finally { loading(false); }
  }

  $('#btnResultNext').addEventListener('click', () => {
    renderHome({ level: state.lastResult && state.lastResult.level, cefr: state.lastResult && state.lastResult.cefr });
    go('s-home');
  });

  // ---------- 首页 ----------
  // 第一版先把入口按"今天学什么"的顺序排出来，具体页面后续逐个搬进 App
  const PATH_ITEMS = [
    { icon: '🎧', title: 'AI 视频通话', sub: '和 AI 私教面对面练口语', featured: true, key: 'avatar' },
    { icon: '💬', title: 'AI 对话练习', sub: '打字或语音，随时开口', key: 'chat' },
    { icon: '📚', title: '今日单词', sub: '按遗忘曲线安排复习', key: 'vocab' },
    { icon: '📖', title: '语法精讲', sub: '一次讲透一个知识点', key: 'grammar' },
  ];

  function renderHome(st) {
    const nick = (state.user && (state.user.nickname || state.user.username)) || '同学';
    $('#homeHello').textContent = `你好，${nick}`;
    const lv = (st && st.level) || (state.user && state.user.level) || 'beginner';
    const cefr = st && st.cefr;
    $('#homeLevel').textContent = `当前水平：${LEVEL_ZH[lv] || lv}${cefr ? '（' + cefr + '）' : ''}`;
    $('#btnMe').textContent = nick.trim().charAt(0).toUpperCase();

    const list = $('#pathList');
    list.innerHTML = '';
    PATH_ITEMS.forEach(it => {
      const b = document.createElement('button');
      b.className = 'path-card' + (it.featured ? ' featured' : '');
      b.innerHTML = '<span class="pc-icon"></span>'
        + '<span class="pc-body"><span class="pc-title"></span><span class="pc-sub"></span></span>'
        + '<span class="pc-arrow">›</span>';
      b.querySelector('.pc-icon').textContent = it.icon;
      b.querySelector('.pc-title').textContent = it.title;
      b.querySelector('.pc-sub').textContent = it.sub;
      b.addEventListener('click', () => toast('这个功能正在搬进 App，敬请期待'));
      list.appendChild(b);
    });
  }

  $('#btnMe').addEventListener('click', () => toast('「我的」页面还在做'));

  // ---------- 启动 ----------
  (async function boot() {
    if (!store.get(TOKEN_KEY)) { go('s-welcome'); return; }
    // 有 token 就直接续上，别让老用户每次打开都重新登录
    try {
      const data = await api('/me');
      if (data.user) { state.user = data.user; await afterAuth(); return; }
    } catch { /* token 失效或网络不通，退回欢迎页 */ }
    store.del(TOKEN_KEY);
    go('s-welcome');
  })();
})();
