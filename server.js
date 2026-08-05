require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3001;

// Groq API 配置（免费）
const SF_API_KEY = process.env.SF_API_KEY;
const SF_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const SF_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = process.env.VISION_MODEL || 'qwen/qwen3.6-27b';

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const VOCAB_PATH = path.join(DATA_DIR, 'vocab.json');
const GRAMMAR_PATH = path.join(DATA_DIR, 'grammar.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { users: {} };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { users: {} };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

app.set('trust proxy', 1);
app.use(express.json());

// ---- 无状态登录态：signed cookie，不依赖服务器内存 ----
// Render 等免费托管平台空闲一段时间会重启进程，内存里的 session 会丢失导致必须重新登录，
// 这里改成把身份信息签名后存进 cookie，服务器重启也不会丢失登录状态。
const SESSION_SECRET = process.env.SESSION_SECRET || 'langbuddy-dev-secret';
const AUTH_COOKIE = 'auth';
const AUTH_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function signValue(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch { out[k] = v; } }
  });
  return out;
}

function cookieSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[AUTH_COOKIE];
  let userId;
  if (token) {
    const sepIdx = token.lastIndexOf('.');
    if (sepIdx > 0) {
      const name = token.slice(0, sepIdx);
      const sig = token.slice(sepIdx + 1);
      if (sig === signValue(name)) userId = name;
    }
  }
  req.session = {
    get userId() { return userId; },
    set userId(v) {
      userId = v;
      res.cookie(AUTH_COOKIE, `${v}.${signValue(v)}`, {
        httpOnly: true,
        maxAge: AUTH_MAX_AGE,
        sameSite: 'lax',
        secure: req.secure,
      });
    },
    destroy(cb) {
      userId = undefined;
      res.clearCookie(AUTH_COOKIE);
      cb();
    },
  };
  next();
}

app.use(cookieSession);
app.use(express.static(path.join(__dirname, 'public')));

// ---- 简易速率限制 ----
const rateLimitMap = new Map();
function rateLimit(max = 20) {
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const timestamps = (rateLimitMap.get(key) || []).filter(t => now - t < 60000);
    if (timestamps.length >= max) {
      return res.status(429).json({ error: '请求太频繁，请稍后再试' });
    }
    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '请先登录' });
  next();
}
function requireMember(req, res, next) {
  const db = loadDB();
  const user = db.users[req.session.userId];
  if (!req.session.userId || !user) return res.status(401).json({ error: '请先登录' });
  if (!user.isMember) return res.status(403).json({ error: '此功能需要会员权限，请先开通会员', needMembership: true });
  next();
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '请先登录' });
  if (!ADMIN_USERNAME || req.session.userId !== ADMIN_USERNAME) {
    return res.status(403).json({ error: '无权限访问' });
  }
  next();
}

function publicUser(user) {
  return {
    username: user.username,
    nickname: user.nickname,
    isMember: user.isMember,
    memberSince: user.memberSince,
    level: user.level,
    targetLang: user.targetLang,
    createdAt: user.createdAt,
    isAdmin: !!ADMIN_USERNAME && user.username === ADMIN_USERNAME,
  };
}

const LEVEL_ZH = { beginner: '初级', intermediate: '中级', advanced: '高级' };
const LANG_NAME = { zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语' };
const LANG_BCP47 = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

// ==================== 账号 & 会员 ====================

app.post('/api/register', rateLimit(10), async (req, res) => {
  const { username, password, nickname } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (typeof username !== 'string' || username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: '用户名长度需为3-30位' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: '密码至少需要6位' });
  }
  const db = loadDB();
  if (db.users[username]) return res.status(400).json({ error: '用户名已被注册' });

  const passwordHash = await bcrypt.hash(password, 10);
  db.users[username] = {
    username,
    nickname: (nickname && String(nickname).slice(0, 30)) || username,
    passwordHash,
    isMember: false,
    memberSince: null,
    level: 'beginner',
    targetLang: 'en',
    createdAt: Date.now(),
    vocabProgress: {},
    mistakes: [],
    activityLog: {},
    chatCount: 0,
  };
  saveDB(db);
  req.session.userId = username;
  res.json({ user: publicUser(db.users[username]) });
});

app.post('/api/login', rateLimit(20), async (req, res) => {
  const { username, password } = req.body || {};
  const db = loadDB();
  const user = db.users[username];
  if (!user) return res.status(400).json({ error: '用户名或密码错误' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(400).json({ error: '用户名或密码错误' });
  req.session.userId = username;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const db = loadDB();
  const user = db.users[req.session.userId];
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user) });
});

app.post('/api/profile', requireAuth, (req, res) => {
  const { nickname, level, targetLang } = req.body || {};
  const db = loadDB();
  const user = db.users[req.session.userId];
  if (nickname) user.nickname = String(nickname).slice(0, 30);
  if (level && ['beginner', 'intermediate', 'advanced'].includes(level)) user.level = level;
  if (targetLang && LANG_NAME[targetLang]) user.targetLang = targetLang;
  saveDB(db);
  res.json({ user: publicUser(user) });
});

// 演示版会员开通：不接入真实支付，直接标记为会员
app.post('/api/membership/upgrade', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  user.isMember = true;
  user.memberSince = Date.now();
  saveDB(db);
  res.json({ user: publicUser(user) });
});

app.get('/api/meta/languages', (req, res) => {
  res.json({
    languages: Object.keys(LANG_NAME).map(code => ({ code, name: LANG_NAME[code], bcp47: LANG_BCP47[code] })),
  });
});

// ==================== AI 1对1 对话 ====================

app.post('/api/chat', requireMember, rateLimit(15), async (req, res) => {
  const { message, history, inputLang, replyLang } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: '消息不能为空' });
  if (message.length > 500) return res.status(400).json({ error: '消息过长（最多500字符）' });

  const db = loadDB();
  const user = db.users[req.session.userId];
  const replyLangName = LANG_NAME[replyLang] || LANG_NAME[user.targetLang] || '英语';
  const inputLangName = LANG_NAME[inputLang] || '中文';
  const levelZh = LEVEL_ZH[user.level] || '初级';
  const sameLang = (inputLang || 'zh') === (replyLang || user.targetLang);

  const systemPrompt = `你是一位耐心友好的${replyLangName}私教，正在与一位${levelZh}水平的学生进行1对1对话练习。
规则：
1. 你必须使用${replyLangName}回复，难度贴合${levelZh}水平。
2. 学生主要使用${inputLangName}和你交流${sameLang ? '' : `（TA正在学习${replyLangName}，可能中途夹杂${replyLangName}）`}。
${sameLang
  ? `3. 如果学生的${replyLangName}表达有语法或用词错误，先温和指出并给出正确说法，再继续对话。`
  : `3. 如果学生用${replyLangName}尝试表达但有错误，先温和纠正；如果学生只用${inputLangName}提问，就直接用${replyLangName}自然地回答或示范表达，必要时可用括号给出简短${inputLangName}提示。`}
4. 回复简洁自然，像真实对话，每次不超过80个词，多用提问引导学生继续说下去。
5. 不要长篇大论讲课，保持轻松的对话感。
6. 极其重要：无论历史对话中出现过什么语言，你自己的每一句回复都必须整体用${replyLangName}书写（括号里的简短提示除外）。绝不能整句改用${inputLangName}回复。`;

  const languageReminder = `（提醒：接下来请只用${replyLangName}回复，不要用${inputLangName}回复整句话）`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(history)
      ? history.slice(-10).map(h => ({
          role: h.role === 'ai' ? 'assistant' : 'user',
          content: String(h.content || '').slice(0, 500),
        }))
      : []),
    { role: 'user', content: String(message).trim() },
    { role: 'system', content: languageReminder },
  ];

  try {
    const response = await fetch(SF_BASE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SF_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: SF_MODEL, max_tokens: 400, temperature: 0.5, messages }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API错误 ${response.status}`);
    }
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';
    user.chatCount = (user.chatCount || 0) + 1;
    recordActivity(user);
    saveDB(db);
    res.json({ reply });
  } catch (e) {
    console.error('对话失败:', e.message);
    res.status(500).json({ error: 'AI 回复失败：' + e.message });
  }
});

// ==================== 语法 AI 批改 ====================

app.post('/api/grammar/check', requireMember, rateLimit(15), async (req, res) => {
  const { sentence } = req.body || {};
  if (!sentence || !String(sentence).trim()) return res.status(400).json({ error: '句子不能为空' });
  if (sentence.length > 300) return res.status(400).json({ error: '句子过长（最多300字符）' });

  const db = loadDB();
  const user = db.users[req.session.userId];
  const langName = LANG_NAME[user.targetLang] || '英语';

  const prompt = `你是一名${langName}语法老师。请检查下面这句学生写的${langName}句子：

"${String(sentence).trim()}"

请用中文简洁地按以下格式输出：
【是否有误】有/没有
【修改后】（如果有误，给出修改后的正确句子；没有则写"无需修改"）
【错误解释】（用1-3句话说明错误类型和原因；没有则写"句子正确，表达自然"）`;

  try {
    const response = await fetch(SF_BASE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SF_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: SF_MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API错误 ${response.status}`);
    }
    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || '';
    recordActivity(user);
    saveDB(db);
    res.json({ result });
  } catch (e) {
    console.error('语法检查失败:', e.message);
    res.status(500).json({ error: 'AI 检查失败：' + e.message });
  }
});

// ==================== 词汇 / 背单词 ====================

function readVocab() {
  return JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf-8'));
}

app.get('/api/vocab/list', requireAuth, (req, res) => {
  const vocab = readVocab();
  const { level } = req.query;
  const filtered = level ? vocab.filter(w => w.level === level) : vocab;
  res.json({ words: filtered });
});

function computeStats(vocab, progress) {
  let known = 0, learning = 0, newCount = 0;
  vocab.forEach(w => {
    const p = progress[w.word];
    if (!p) newCount++;
    else if (p.box >= EBBINGHAUS_INTERVALS_MIN.length - 1) known++;
    else learning++;
  });
  return { total: vocab.length, known, learning, new: newCount };
}

// ---- 学习活动记录（用于连续学习天数等指标） ----
function dateKey(d) { return d.toISOString().slice(0, 10); }

function recordActivity(user) {
  if (!user.activityLog) user.activityLog = {};
  user.activityLog[dateKey(new Date())] = true;
}

function computeStreak(activityLog) {
  const dates = new Set(Object.keys(activityLog || {}));
  if (!dates.size) return 0;
  let streak = 0;
  const cursor = new Date();
  // 今天还没学习也没关系，连续天数从昨天往前数依然有效（今天还没"断"）
  if (!dates.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dates.has(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

app.get('/api/vocab/review', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  let vocab = readVocab();
  const { level } = req.query;
  if (level) vocab = vocab.filter(w => w.level === level);
  const progress = user.vocabProgress || {};
  const now = Date.now();

  const due = vocab.filter(w => {
    const p = progress[w.word];
    return !p || p.due <= now;
  });
  // 优先安排已学过但到期的词，再补充新词，最多20个一批
  due.sort((a, b) => {
    const pa = progress[a.word], pb = progress[b.word];
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    return 0;
  });

  res.json({ words: due.slice(0, 20), stats: computeStats(vocab, progress) });
});

// 艾宾浩斯遗忘曲线复习间隔：5分钟-30分钟-12小时-1天-2天-4天-7天-15天-30天
const EBBINGHAUS_INTERVALS_MIN = [5, 30, 12 * 60, 24 * 60, 2 * 24 * 60, 4 * 24 * 60, 7 * 24 * 60, 15 * 24 * 60, 30 * 24 * 60];

app.post('/api/vocab/review', requireAuth, (req, res) => {
  const { word, remembered } = req.body || {};
  if (!word) return res.status(400).json({ error: '缺少单词' });
  const db = loadDB();
  const user = db.users[req.session.userId];
  if (!user.vocabProgress) user.vocabProgress = {};
  // 从未复习过的新词用 -1 作为起点，这样第一次"记住"正好落在box 0（5分钟）档，而不是跳过它
  const prev = user.vocabProgress[word] || { box: -1, due: Date.now() };
  // 记住了：进入下一个更长的复习间隔；忘记了：按艾宾浩斯曲线的做法从头开始重新记忆
  const box = remembered ? Math.min(prev.box + 1, EBBINGHAUS_INTERVALS_MIN.length - 1) : 0;
  const minutes = EBBINGHAUS_INTERVALS_MIN[box];
  const due = Date.now() + minutes * 60 * 1000;
  user.vocabProgress[word] = { box, due, lastReview: Date.now() };
  recordActivity(user);
  saveDB(db);
  res.json({ progress: user.vocabProgress[word] });
});

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 根据用户当前的学习状态出选择题：优先考"学习中"（见过但还没掌握）的词，
// 不够就用已到期复习的词兜底，都没有就从整个词库随机抽，保证测试随时可用
app.get('/api/vocab/quiz', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  let vocab = readVocab();
  const { level } = req.query;
  if (level) vocab = vocab.filter(w => w.level === level);
  if (vocab.length < 4) return res.status(400).json({ error: '该级别词汇量不足，无法生成测试' });

  const progress = user.vocabProgress || {};
  const now = Date.now();
  const learning = vocab.filter(w => {
    const p = progress[w.word];
    return p && p.box < EBBINGHAUS_INTERVALS_MIN.length - 1;
  });
  const due = vocab.filter(w => {
    const p = progress[w.word];
    return p && p.due <= now;
  });

  let pool = learning.length >= 5 ? learning : due.length >= 5 ? due : vocab;
  pool = shuffle(pool).slice(0, 10);

  const questions = pool.map(w => {
    const distractors = shuffle(vocab.filter(x => x.word !== w.word && x.meaning_zh !== w.meaning_zh)).slice(0, 3);
    const options = shuffle([w.meaning_zh, ...distractors.map(d => d.meaning_zh)]);
    return {
      word: w.word,
      pos: w.pos,
      options,
      correctIndex: options.indexOf(w.meaning_zh),
    };
  });

  res.json({ questions });
});

// ==================== 学习数据面板 ====================

app.get('/api/metrics', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  const vocab = readVocab();
  const progress = user.vocabProgress || {};
  const mistakes = user.mistakes || [];

  res.json({
    vocab: computeStats(vocab, progress),
    mistakes: {
      total: mistakes.length,
      mastered: mistakes.filter(m => m.mastered).length,
    },
    chatCount: user.chatCount || 0,
    streakDays: computeStreak(user.activityLog),
    activeDays: Object.keys(user.activityLog || {}).length,
    isMember: user.isMember,
  });
});

// ==================== 语法课程 ====================

function readGrammar() {
  return JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf-8'));
}

app.get('/api/grammar/list', requireAuth, (req, res) => {
  const grammar = readGrammar();
  res.json({ lessons: grammar.map(g => ({ id: g.id, title: g.title, summary: g.summary })) });
});

app.get('/api/grammar/:id', requireAuth, (req, res) => {
  const grammar = readGrammar();
  const lesson = grammar.find(g => g.id === req.params.id);
  if (!lesson) return res.status(404).json({ error: '未找到该语法课程' });
  res.json({ lesson });
});

// ==================== AI 错题本 ====================

const MISTAKE_MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const mistakeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = MISTAKE_MIME_EXT[file.mimetype] || '.jpg';
      cb(null, `${req.session.userId}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (MISTAKE_MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('仅支持 JPG / PNG / WEBP 格式图片'));
  },
});

app.post('/api/mistakes/upload', requireMember, rateLimit(6), mistakeUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传一张错题图片' });

  const cleanupFile = () => fs.unlink(req.file.path, () => {});

  try {
    const { examType } = req.body || {};
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64 = imageBuffer.toString('base64');

    const prompt = `你是一位资深的中国考试（如英语四六级 CET-4/CET-6、考研、中高考等）错题分析老师。请仔细识别这张错题图片中的内容，并严格按照下面的 JSON 格式输出分析结果，只输出 JSON，不要输出任何其他文字：

{
  "subject": "题目所属学科，如 英语/数学/语文 等",
  "examType": "推测的考试类型，如 CET-4/CET-6/考研/中高考 等${examType ? `（用户提示：${String(examType).slice(0, 20)}，如果图片内容与提示不符请以图片实际内容为准）` : ''}",
  "category": "题型分类，如 阅读理解/完形填空/翻译/写作/听力/语法填空/词汇辨析/应用题 等",
  "tags": ["2-4个具体考点标签，如 时态语态、长难句、固定搭配"],
  "questionText": "识别出的题目原文（可适当精简但保留关键信息和选项）",
  "userAnswer": "如果图片中能看出学生的作答/涂改痕迹，提取出来；看不出则填 null",
  "correctAnswer": "正确答案",
  "explanation": "详细解析：为什么这样选、错在哪里，涉及的知识点和解题思路，200字以内",
  "similarQuestions": [
    { "question": "举一反三的同类型新题目1", "answer": "答案", "explanation": "简短解析" },
    { "question": "举一反三的同类型新题目2", "answer": "答案", "explanation": "简短解析" }
  ]
}

如果图片模糊无法识别，请在 questionText 中如实说明"图片不清晰，无法完整识别"，其余字段给出最合理的判断，不要编造与图片无关的内容。`;

    const response = await fetch(SF_BASE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SF_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 5000,
        temperature: 0.4,
        reasoning_format: 'hidden',
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${req.file.mimetype};base64,${base64}` } },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err?.error?.message || '';
      if (/validate JSON/i.test(msg)) {
        console.error('错题解析JSON校验失败，原始错误:', msg, err?.error?.failed_generation?.slice?.(0, 500));
        throw new Error('图片内容较复杂，AI 解析未能完成，请重试一次，或换一张更清晰/单题的图片');
      }
      if (/tokens per minute|rate_limit/i.test(msg)) {
        throw new Error('当前使用人数较多或图片较大，请求超出限额，请稍后重试或换一张更小的图片');
      }
      throw new Error(msg || `API错误 ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const finishReason = data.choices?.[0]?.finish_reason;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
    }
    if (!parsed || typeof parsed !== 'object') {
      if (finishReason === 'length') {
        throw new Error('图片内容较复杂，AI 解析未能在限定长度内完成，请重试一次，或换一张更清晰/单题的图片');
      }
      throw new Error('AI 未能返回有效的解析结果，请重试或换一张更清晰的图片');
    }

    const db = loadDB();
    const user = db.users[req.session.userId];
    if (!user.mistakes) user.mistakes = [];

    const mistake = {
      id: crypto.randomBytes(8).toString('hex'),
      imageFile: req.file.filename,
      subject: String(parsed.subject || '未知').slice(0, 30),
      examType: String(parsed.examType || examType || '').slice(0, 30),
      category: String(parsed.category || '未分类').slice(0, 30),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6).map(t => String(t).slice(0, 20)) : [],
      questionText: String(parsed.questionText || '').slice(0, 2000),
      userAnswer: parsed.userAnswer ? String(parsed.userAnswer).slice(0, 200) : null,
      correctAnswer: String(parsed.correctAnswer || '').slice(0, 500),
      explanation: String(parsed.explanation || '').slice(0, 1000),
      similarQuestions: Array.isArray(parsed.similarQuestions)
        ? parsed.similarQuestions.slice(0, 3).map(sq => ({
            question: String(sq?.question || '').slice(0, 500),
            answer: String(sq?.answer || '').slice(0, 300),
            explanation: String(sq?.explanation || '').slice(0, 500),
          }))
        : [],
      mastered: false,
      createdAt: Date.now(),
    };
    user.mistakes.unshift(mistake);
    recordActivity(user);
    saveDB(db);

    res.json({ mistake: { ...mistake, imageUrl: mistakeImageUrl(mistake) } });
  } catch (e) {
    cleanupFile();
    console.error('错题解析失败:', e.message);
    res.status(500).json({ error: 'AI 解析失败：' + e.message });
  }
});

// 打字手动输入错题（不需要图片，直接用文本模型分析，速度更快、不受视觉模型的额度限制）
app.post('/api/mistakes/submit-text', requireMember, rateLimit(15), async (req, res) => {
  const { questionText, examType } = req.body || {};
  if (!questionText || !String(questionText).trim()) return res.status(400).json({ error: '请输入错题内容' });
  if (String(questionText).length > 2000) return res.status(400).json({ error: '内容过长（最多2000字符）' });

  const trimmed = String(questionText).trim();
  const prompt = `你是一位资深的中国考试（如英语四六级 CET-4/CET-6、考研、中高考等）错题分析老师。学生手动输入了以下错题内容（可能包含题目、选项、TA自己选的答案等）：

"""
${trimmed}
"""
${examType ? `\n学生提示的考试类型：${String(examType).slice(0, 20)}` : ''}

请严格按照下面的 JSON 格式输出分析结果，只输出 JSON，不要输出任何其他文字：

{
  "subject": "题目所属学科，如 英语/数学/语文 等",
  "examType": "推测的考试类型",
  "category": "题型分类，如 阅读理解/完形填空/翻译/写作/听力/语法填空/词汇辨析/应用题 等",
  "tags": ["2-4个具体考点标签"],
  "questionText": "整理后的题目原文（如果学生输入本身已经是完整题目，直接保留；如果比较口语化或不完整，帮TA整理清楚）",
  "userAnswer": "学生的作答，如果文本中提到了就提取，没提到就填 null",
  "correctAnswer": "正确答案",
  "explanation": "详细解析：为什么这样选、错在哪里，涉及的知识点和解题思路，200字以内",
  "similarQuestions": [
    { "question": "举一反三的同类型新题目1", "answer": "答案", "explanation": "简短解析" },
    { "question": "举一反三的同类型新题目2", "answer": "答案", "explanation": "简短解析" }
  ]
}`;

  try {
    const response = await fetch(SF_BASE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SF_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SF_MODEL,
        max_tokens: 1500,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API错误 ${response.status}`);
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('AI 未能返回有效的解析结果，请重试或补充更完整的题目信息');
    }

    const db = loadDB();
    const user = db.users[req.session.userId];
    if (!user.mistakes) user.mistakes = [];

    const mistake = {
      id: crypto.randomBytes(8).toString('hex'),
      imageFile: null,
      subject: String(parsed.subject || '未知').slice(0, 30),
      examType: String(parsed.examType || examType || '').slice(0, 30),
      category: String(parsed.category || '未分类').slice(0, 30),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6).map(t => String(t).slice(0, 20)) : [],
      questionText: String(parsed.questionText || trimmed).slice(0, 2000),
      userAnswer: parsed.userAnswer ? String(parsed.userAnswer).slice(0, 200) : null,
      correctAnswer: String(parsed.correctAnswer || '').slice(0, 500),
      explanation: String(parsed.explanation || '').slice(0, 1000),
      similarQuestions: Array.isArray(parsed.similarQuestions)
        ? parsed.similarQuestions.slice(0, 3).map(sq => ({
            question: String(sq?.question || '').slice(0, 500),
            answer: String(sq?.answer || '').slice(0, 300),
            explanation: String(sq?.explanation || '').slice(0, 500),
          }))
        : [],
      mastered: false,
      createdAt: Date.now(),
    };
    user.mistakes.unshift(mistake);
    recordActivity(user);
    saveDB(db);

    res.json({ mistake: { ...mistake, imageUrl: mistakeImageUrl(mistake) } });
  } catch (e) {
    console.error('文字错题解析失败:', e.message);
    res.status(500).json({ error: 'AI 解析失败：' + e.message });
  }
});

function mistakeImageUrl(m) {
  return m.imageFile ? `/api/mistakes/image/${m.imageFile}` : null;
}

app.get('/api/mistakes/list', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  const mistakes = user.mistakes || [];
  const { category, tag, examType } = req.query;

  let filtered = mistakes;
  if (category) filtered = filtered.filter(m => m.category === category);
  if (examType) filtered = filtered.filter(m => m.examType === examType);
  if (tag) filtered = filtered.filter(m => m.tags.includes(tag));

  res.json({
    mistakes: filtered.map(m => ({ ...m, imageUrl: mistakeImageUrl(m) })),
    stats: {
      total: mistakes.length,
      mastered: mistakes.filter(m => m.mastered).length,
      categories: [...new Set(mistakes.map(m => m.category))],
      tags: [...new Set(mistakes.flatMap(m => m.tags))],
    },
  });
});

app.get('/api/mistakes/image/:filename', requireAuth, (req, res) => {
  const filename = req.params.filename;
  if (
    typeof filename !== 'string' ||
    !filename.startsWith(req.session.userId + '_') ||
    filename.includes('..') || filename.includes('/') || filename.includes('\\')
  ) {
    return res.status(403).end();
  }
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

app.patch('/api/mistakes/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  const mistake = (user.mistakes || []).find(m => m.id === req.params.id);
  if (!mistake) return res.status(404).json({ error: '未找到该错题' });
  if (typeof req.body?.mastered === 'boolean') mistake.mastered = req.body.mastered;
  saveDB(db);
  res.json({ mistake: { ...mistake, imageUrl: mistakeImageUrl(mistake) } });
});

app.delete('/api/mistakes/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  const list = user.mistakes || [];
  const idx = list.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '未找到该错题' });
  const [removed] = list.splice(idx, 1);
  saveDB(db);
  if (removed.imageFile) fs.unlink(path.join(UPLOADS_DIR, removed.imageFile), () => {});
  res.json({ ok: true });
});

// ==================== 管理员后台 ====================

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const db = loadDB();
  const users = Object.values(db.users || {});
  const vocab = readVocab();

  let totalMistakes = 0, totalChats = 0, totalVocabMastered = 0, totalMembers = 0;
  users.forEach(u => {
    totalMistakes += (u.mistakes || []).length;
    totalChats += u.chatCount || 0;
    if (u.isMember) totalMembers++;
    const stats = computeStats(vocab, u.vocabProgress || {});
    totalVocabMastered += stats.known;
  });

  res.json({
    totalUsers: users.length,
    totalMembers,
    totalMistakes,
    totalChats,
    totalVocabMastered,
    vocabBankSize: vocab.length,
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const db = loadDB();
  const vocab = readVocab();
  const users = Object.values(db.users || {}).map(u => {
    const vocabStats = computeStats(vocab, u.vocabProgress || {});
    return {
      username: u.username,
      nickname: u.nickname,
      isMember: u.isMember,
      memberSince: u.memberSince,
      createdAt: u.createdAt,
      level: u.level,
      targetLang: u.targetLang,
      vocabMastered: vocabStats.known,
      vocabLearning: vocabStats.learning,
      mistakesTotal: (u.mistakes || []).length,
      chatCount: u.chatCount || 0,
      streakDays: computeStreak(u.activityLog),
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ users });
});

// multer / 上传相关错误统一转成 JSON 响应
app.use((err, req, res, next) => {
  if (!err) return next();
  console.error('上传错误:', err.message);
  res.status(400).json({ error: err.message || '上传失败' });
});

app.listen(PORT, () => {
  console.log(`\n✅ LangBuddy 语伴已启动`);
  console.log(`   本地访问: http://localhost:${PORT}`);
  console.log(`   使用模型: ${SF_MODEL}\n`);
});
