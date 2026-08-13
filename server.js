require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3001;

// Groq API 配置（免费，主力）
const SF_API_KEY = process.env.SF_API_KEY;
const SF_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const SF_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = process.env.VISION_MODEL || 'qwen/qwen3.6-27b';

// OpenRouter 配置（备用，免费模型）：Groq 触发限流/报错时自动无缝切换过来救急，
// 每次请求都会重新优先尝试 Groq，Groq 恢复后自动切回，不需要额外的"探测恢复"逻辑
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const VOCAB_PATH = path.join(DATA_DIR, 'vocab.json');
const GRAMMAR_PATH = path.join(DATA_DIR, 'grammar.json');
const COLLOQUIAL_PATH = path.join(DATA_DIR, 'colloquial.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---- 用户数据持久化 ----
// Render 免费套餐的容器磁盘是临时的：每次重新部署/重启都会用全新容器启动，本地文件
// （包括这个db.json）不会保留，导致用户数据"每次部署就清零"。真正的解决办法是把数据存到
// 独立于容器生命周期的地方——配置了 MONGODB_URI 就存 MongoDB（推荐，持久、不受部署影响）；
// 没配置就退回本地文件（行为和以前完全一样，仅建议本地开发用，生产环境必须配置）。
// 整个db.json常驻内存，loadDB/saveDB全程保持同步调用，业务代码完全不用改。
let dbCache = null;
let mongoCollection = null;
let lastSavePromise = Promise.resolve();

async function initDB() {
  if (process.env.MONGODB_URI) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    mongoCollection = client.db('langbuddy').collection('state');
    const doc = await mongoCollection.findOne({ _id: 'db' });
    dbCache = doc ? doc.data : { users: {} };
    console.log('[DB] 已连接 MongoDB，用户数据将持久化保存，不受部署/重启影响');
  } else {
    dbCache = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) : { users: {} };
    console.warn('[DB] 未配置 MONGODB_URI，使用本地文件存储——仅适合本地开发，部署到 Render 等平台后数据会在下次部署/重启时丢失！');
  }
}

function loadDB() {
  return dbCache;
}
function saveDB(db) {
  dbCache = db;
  if (mongoCollection) {
    lastSavePromise = mongoCollection.replaceOne({ _id: 'db' }, { _id: 'db', data: db }, { upsert: true })
      .catch(err => console.error('[DB] 写入 MongoDB 失败:', err.message));
  } else {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }
}

// Render 部署新版本前会先给旧容器发 SIGTERM 再强制杀掉，这里等最近一次的写入真正落盘/落库后再退出，
// 避免"最后一次操作的数据还没来得及写到 MongoDB，容器就被回收了"
async function gracefulShutdown() {
  try { await Promise.race([lastSavePromise, new Promise(r => setTimeout(r, 5000))]); } catch {}
  process.exit(0);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

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
// 静态资源默认不带 Cache-Control，部分手机浏览器会激进地长期复用旧缓存，
// 导致每次发新版本后，有的用户看到的还是几天前的 app.js/index.html（新功能"看起来没生效"）。
// 用 no-cache 强制浏览器每次都带 ETag 去问一下服务器，没变化时后端仍然返回轻量的 304，
// 内容变了才会重新下载，兼顾"总是拿到最新版本"和"没必要每次全量下载"。
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

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

// 非会员每日免费体验额度：会员不限量，非会员每天限量试用，用完后提示开通会员
// type: 'window' 表示从当天第一次使用起计算的时长限额（如AI对话每天5分钟）；'count' 表示每天限次数（如作文批改/错题本每天1次）
function allowMemberOrFreeQuota(feature, quota) {
  return (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: '请先登录' });
    const db = loadDB();
    const user = db.users[req.session.userId];
    if (!user) return res.status(401).json({ error: '请先登录' });
    if (user.isMember) return next();
    // 防止有人靠无限注册小号白嫖每日免费额度：只有验证过手机号的账号才给免费额度，
    // 用户名密码注册的账号默认没验证过，需要去"我的"页面绑定手机号才能解锁
    if (!user.phoneVerified) {
      return res.status(403).json({ error: '未验证手机号的账号暂不提供每日免费额度，请先在"我的"页面验证手机号解锁', needPhoneVerify: true });
    }

    if (!user.freeUsage) user.freeUsage = {};
    const today = dateKey(new Date());
    const rec = user.freeUsage[feature];

    if (quota.type === 'window') {
      if (!rec || rec.date !== today) {
        user.freeUsage[feature] = { date: today, firstAt: Date.now() };
        saveDB(db);
        return next();
      }
      if (Date.now() - rec.firstAt < quota.windowMs) return next();
      return res.status(403).json({ error: `非会员每天可免费体验${Math.round(quota.windowMs / 60000)}分钟AI对话，开通会员畅享无限时长`, needMembership: true });
    }

    // type === 'count'
    if (!rec || rec.date !== today) {
      user.freeUsage[feature] = { date: today, count: 1 };
      saveDB(db);
      return next();
    }
    if (rec.count < quota.max) {
      rec.count += 1;
      saveDB(db);
      return next();
    }
    return res.status(403).json({ error: '今日免费试用次数已用完，开通会员畅享无限次使用', needMembership: true });
  };
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
    phone: user.phone || null,
    phoneVerified: !!user.phoneVerified,
  };
}

const LEVEL_ZH = { beginner: '初级', intermediate: '中级', advanced: '高级' };
const LANG_NAME = { zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语' };
const LANG_BCP47 = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

// 全站所有用户共用同一个 Groq API Key，免费额度有限（按分钟/按天限量）。
// Groq 返回的原始错误信息是给开发者看的技术细节，不应该直接展示给用户，
// 这里统一转换成用户能看懂的提示，同时把原始信息打到服务端日志方便排查。
function friendlyAiError(e) {
  const msg = e?.message || '';
  // 已经是写好的中文提示（比如某个接口针对特定情况提前抛出的友好错误），直接透传，不要覆盖
  if (/[一-龥]/.test(msg)) return msg;
  if (/rate limit/i.test(msg) || /tokens per (minute|day)/i.test(msg) || /requests per (minute|day)/i.test(msg)) {
    return 'AI 助教当前使用人数较多，额度已用完，请等几分钟后再试';
  }
  if (/validate JSON/i.test(msg)) {
    return 'AI 返回内容解析失败，请重试一次';
  }
  return 'AI 服务暂时不可用，请稍后重试';
}

function isRateLimitError(e) {
  const msg = e?.message || '';
  return e?.status === 429 || /rate limit/i.test(msg) || /tokens per (minute|day)/i.test(msg) || /requests per (minute|day)/i.test(msg);
}

async function callTextModel(baseUrl, apiKey, model, { messages, maxTokens, temperature, jsonMode }) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const e = new Error(err?.error?.message || `API错误 ${response.status}`);
    e.status = response.status;
    throw e;
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// 统一的文本AI调用入口：优先用 Groq，触发限流/报错时（如果配置了 OPENROUTER_API_KEY）
// 自动无缝切换到 OpenRouter 的免费模型救急；每次调用都重新优先尝试 Groq，
// Groq 恢复后下一次调用会自动切回，不需要额外的"探测恢复"逻辑
async function callChatAPI(opts) {
  try {
    return await callTextModel(SF_BASE_URL, SF_API_KEY, SF_MODEL, opts);
  } catch (e) {
    if (isRateLimitError(e) && OPENROUTER_API_KEY) {
      console.warn('Groq 触发限流，自动切换到 OpenRouter 备用模型:', e.message);
      return await callTextModel(OPENROUTER_BASE_URL, OPENROUTER_API_KEY, OPENROUTER_MODEL, opts);
    }
    throw e;
  }
}

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
  const clientIp = normalizeIp(req.ip);
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
    registrationIp: clientIp,
    registrationRegion: '查询中...',
    phoneVerified: false,
  };
  saveDB(db);
  req.session.userId = username;
  res.json({ user: publicUser(db.users[username]) });
  fillRegistrationRegion(username, clientIp);
});

app.post('/api/login', rateLimit(20), async (req, res) => {
  const { username, password } = req.body || {};
  const db = loadDB();
  const user = db.users[username];
  // 手机号验证码注册的账号没有密码，不能走这条登录路径
  if (!user || !user.passwordHash) return res.status(400).json({ error: '用户名或密码错误' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(400).json({ error: '用户名或密码错误' });
  req.session.userId = username;
  res.json({ user: publicUser(user) });
});

// ==================== 手机号验证码登录 ====================
// 短信发送需要接入第三方短信服务商（阿里云/腾讯云等），目前未配置真实服务商时，
// 验证码只会打印到服务器日志、并在接口响应里附带 devCode 字段方便本地联调测试。
// 接入真实服务商后，只需要把 sendSms() 里的实现换成对应 SDK 调用即可，其余逻辑不用改。

const SMS_PROVIDER = process.env.SMS_PROVIDER || '';
const phoneCodeStore = new Map(); // phone -> { code, expiresAt, lastSentAt }

function isValidPhone(phone) {
  return typeof phone === 'string' && /^1[3-9]\d{9}$/.test(phone);
}

async function sendSms(phone, code) {
  if (SMS_PROVIDER === 'aliyun') {
    // TODO: 接入阿里云短信服务，需要环境变量 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET /
    // ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE，调用 @alicloud/dysmsapi20170525 SDK 发送
    throw new Error('阿里云短信服务尚未配置完成，请联系管理员');
  }
  if (SMS_PROVIDER === 'tencent') {
    // TODO: 接入腾讯云短信服务，需要环境变量 TENCENT_SECRET_ID / TENCENT_SECRET_KEY /
    // TENCENT_SMS_SIGN_NAME / TENCENT_SMS_TEMPLATE_ID，调用 tencentcloud-sdk-nodejs 发送
    throw new Error('腾讯云短信服务尚未配置完成，请联系管理员');
  }
  console.log(`[SMS 测试模式，未配置真实短信服务商] 验证码 ${code} -> ${phone}`);
}

app.post('/api/auth/phone/send-code', rateLimit(10), async (req, res) => {
  const { phone } = req.body || {};
  if (!isValidPhone(phone)) return res.status(400).json({ error: '请输入正确的11位手机号' });

  const existing = phoneCodeStore.get(phone);
  if (existing && Date.now() - existing.lastSentAt < 60 * 1000) {
    return res.status(429).json({ error: '发送太频繁，请60秒后再试' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  phoneCodeStore.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000, lastSentAt: Date.now() });

  try {
    await sendSms(phone, code);
    const payload = { ok: true };
    if (!SMS_PROVIDER) payload.devCode = code; // 仅测试模式下返回，接入真实服务商后不会再出现
    res.json(payload);
  } catch (e) {
    console.error('短信发送失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/phone/verify', rateLimit(15), async (req, res) => {
  const { phone, code } = req.body || {};
  if (!isValidPhone(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (!code || !String(code).trim()) return res.status(400).json({ error: '请输入验证码' });

  const record = phoneCodeStore.get(phone);
  if (!record || record.code !== String(code).trim()) return res.status(400).json({ error: '验证码错误' });
  if (Date.now() > record.expiresAt) {
    phoneCodeStore.delete(phone);
    return res.status(400).json({ error: '验证码已过期，请重新获取' });
  }
  phoneCodeStore.delete(phone); // 验证码一次性使用

  const db = loadDB();
  const isNewUser = !db.users[phone];
  const clientIp = normalizeIp(req.ip);
  if (isNewUser) {
    db.users[phone] = {
      username: phone,
      nickname: '用户' + phone.slice(-4),
      passwordHash: null,
      phone,
      isMember: false,
      memberSince: null,
      level: 'beginner',
      targetLang: 'en',
      createdAt: Date.now(),
      vocabProgress: {},
      mistakes: [],
      activityLog: {},
      chatCount: 0,
      registrationIp: clientIp,
      registrationRegion: '查询中...',
      phoneVerified: true,
    };
    saveDB(db);
  }
  req.session.userId = phone;
  res.json({ user: publicUser(db.users[phone]) });
  if (isNewUser) fillRegistrationRegion(phone, clientIp);
});

// 已登录账号绑定并验证手机号，用于解锁每日免费额度（复用 /api/auth/phone/send-code 发验证码）
app.post('/api/profile/bind-phone', requireAuth, rateLimit(15), (req, res) => {
  const { phone, code } = req.body || {};
  if (!isValidPhone(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (!code || !String(code).trim()) return res.status(400).json({ error: '请输入验证码' });

  const record = phoneCodeStore.get(phone);
  if (!record || record.code !== String(code).trim()) return res.status(400).json({ error: '验证码错误' });
  if (Date.now() > record.expiresAt) {
    phoneCodeStore.delete(phone);
    return res.status(400).json({ error: '验证码已过期，请重新获取' });
  }

  const db = loadDB();
  const owner = Object.values(db.users).find(u => u.phone === phone && u.username !== req.session.userId);
  if (owner) return res.status(400).json({ error: '该手机号已被其他账号绑定' });

  phoneCodeStore.delete(phone);
  const user = db.users[req.session.userId];
  user.phone = phone;
  user.phoneVerified = true;
  saveDB(db);
  res.json({ user: publicUser(user) });
});

// ==================== 微信授权登录（占位，尚未接入） ====================
// 网站场景的微信登录必须在微信开放平台（open.weixin.qq.com）注册"网站应用"，
// 且该平台要求开发者主体是企业并完成认证，个人开发者无法申请这个能力。
// 需要 WECHAT_APP_ID / WECHAT_APP_SECRET 环境变量，并实现：
//   1. GET /api/auth/wechat/login-url  生成跳转到微信授权页的 URL（带 state 防CSRF）
//   2. GET /api/auth/wechat/callback   微信跳回后用 code 换 access_token + openid，
//      再用 openid 作为用户唯一标识查找/创建账号并登录
const WECHAT_APP_ID = process.env.WECHAT_APP_ID || '';

app.get('/api/auth/wechat/login-url', (req, res) => {
  if (!WECHAT_APP_ID) {
    return res.status(501).json({ error: '微信登录尚未配置，需要企业主体在微信开放平台申请网站应用后接入' });
  }
  // TODO: WECHAT_APP_ID 配置好之后，在这里拼接真实的微信授权跳转链接并返回
  res.status(501).json({ error: '微信登录尚未实现' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// 轻量诊断接口：不暴露任何敏感信息，只用来确认当前是不是接到了持久化数据库
app.get('/api/health', (req, res) => {
  res.json({ ok: true, dbMode: mongoCollection ? 'mongodb' : 'file' });
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

app.post('/api/chat', allowMemberOrFreeQuota('chat', { type: 'window', windowMs: 5 * 60 * 1000 }), rateLimit(15), async (req, res) => {
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
    const reply = await callChatAPI({ messages, maxTokens: 400, temperature: 0.5 });
    user.chatCount = (user.chatCount || 0) + 1;
    // 把这轮对话存到用户账号下，下次登录（换设备也一样）能接着上次的对话继续，
    // 只保留最近60条（30轮），避免无限增长
    if (!Array.isArray(user.chatHistory)) user.chatHistory = [];
    user.chatHistory.push({ role: 'user', content: String(message).trim() });
    user.chatHistory.push({ role: 'ai', content: reply });
    if (user.chatHistory.length > 60) user.chatHistory = user.chatHistory.slice(-60);
    recordActivity(user);
    saveDB(db);
    res.json({ reply });
  } catch (e) {
    console.error('对话失败:', e.message);
    res.status(500).json({ error: friendlyAiError(e) });
  }
});

app.get('/api/chat/history', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  res.json({ history: Array.isArray(user.chatHistory) ? user.chatHistory : [] });
});

app.post('/api/chat/clear', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  user.chatHistory = [];
  saveDB(db);
  res.json({ ok: true });
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
    const result = await callChatAPI({ messages: [{ role: 'user', content: prompt }], maxTokens: 300 });
    recordActivity(user);
    saveDB(db);
    res.json({ result });
  } catch (e) {
    console.error('语法检查失败:', e.message);
    res.status(500).json({ error: friendlyAiError(e) });
  }
});

// ==================== AI 作文批改 ====================

const ENGLISH_EXAM_RUBRIC = {
  'CET-4': '大学英语四级作文，满分15分，按内容要点、篇章结构、语言准确性与丰富度评分',
  'CET-6': '大学英语六级作文，满分15分，按内容要点、篇章结构、语言准确性与丰富度评分',
  'IELTS': '雅思写作，9分制，按Task Response、Coherence and Cohesion、Lexical Resource、Grammatical Range and Accuracy四项评分',
  'TOEFL': '托福独立写作，30分制，按内容展开、组织结构、语言使用评分',
  '考研英语': '考研英语（一/二）作文，满分20分，按内容切题、语言准确性、篇章连贯评分',
  '其他': '英语考试作文，按内容、结构、语言三方面综合评分',
};

app.post('/api/essay/check', allowMemberOrFreeQuota('essay', { type: 'count', max: 1 }), rateLimit(8), async (req, res) => {
  const { essayText, examType, mode } = req.body || {};
  if (!essayText || !String(essayText).trim()) return res.status(400).json({ error: '请输入作文内容' });
  if (essayText.length > 3000) return res.status(400).json({ error: '作文过长（最多3000字符）' });

  const db = loadDB();
  const user = db.users[req.session.userId];
  const isEnglishMode = mode === 'english';
  // English 批改模式固定按英语考试标准评分，不受用户当前学习语种设置影响
  const langName = isEnglishMode ? '英语' : (LANG_NAME[user.targetLang] || '英语');
  const trimmed = String(essayText).trim();

  let prompt;
  if (isEnglishMode) {
    const examKey = ENGLISH_EXAM_RUBRIC[examType] ? examType : '其他';
    const rubricDesc = ENGLISH_EXAM_RUBRIC[examKey];
    prompt = `你是一位经验丰富的英语考试作文阅卷老师，正在按照${examKey}的评分标准批改一位中国学生的英语作文。评分标准：${rubricDesc}。

学生的作文原文：
"""
${trimmed}
"""

请像真实考试阅卷一样严格评分，并逐句逐词找出所有语法、用词、拼写、时态、句式、标点等问题，严格按照下面的 JSON 格式输出，只输出 JSON，不要输出任何其他文字：

{
  "scoreEstimate": "预估分数或分数区间，需带上满分制式，如'CET-6预估 11-12/15分'",
  "estimatedLevel": "对这篇作文整体水平的一句话评估",
  "rubric": {
    "content": "内容与任务完成度评价，1-2句话",
    "organization": "篇章结构与逻辑连贯性评价，1-2句话",
    "language": "语言使用评价（词汇丰富度、语法准确性、句式多样性），1-2句话"
  },
  "overallComment": "总体点评与提分建议，2-4句话",
  "correctedEssay": "整篇修改后的完整作文全文（保持段落结构，只修正错误，不要过度改写学生的原意和风格）",
  "corrections": [
    { "original": "原文中有问题的一句话或短语（逐字逐句摘录原文，不要改写）", "corrected": "修改后的正确版本", "explanation": "用一两句话说明为什么错、涉及什么语法或用词问题" }
  ]
}

corrections 数组要覆盖原文中每一处修改，按原文顺序排列；如果某句话有多处错误，可以拆成多条记录。如果整篇作文没有任何错误，corrections 输出空数组。`;
  } else {
    prompt = `你是一位经验丰富的${langName}写作老师，正在批改一位中国学生写的${langName}作文。${examType ? `学生说明这是${String(examType).slice(0, 20)}的作文。` : ''}

学生的作文原文：
"""
${trimmed}
"""

请逐句逐词仔细批改这篇作文，找出所有语法、用词、拼写、时态、句式、标点等方面的问题，并严格按照下面的 JSON 格式输出，只输出 JSON，不要输出任何其他文字：

{
  "estimatedLevel": "对这篇作文整体水平的一句话评估，如'CET4及格水平，语言基本准确但表达较简单'",
  "overallComment": "总体点评，2-4句话，包括结构、内容逻辑、语言使用等方面的优缺点",
  "correctedEssay": "整篇修改后的完整作文全文（保持段落结构，只修正错误，不要过度改写学生的原意和风格）",
  "corrections": [
    { "original": "原文中有问题的一句话或短语（逐字逐句摘录原文，不要改写）", "corrected": "修改后的正确版本", "explanation": "用一两句话说明为什么错、涉及什么语法或用词问题" }
  ]
}

corrections 数组要覆盖原文中每一处修改，按原文顺序排列；如果某句话有多处错误，可以拆成多条记录。如果整篇作文没有任何错误，corrections 输出空数组，并在 overallComment 中说明写得很好。`;
  }

  try {
    let raw;
    try {
      raw = await callChatAPI({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 3500,
        temperature: 0.4,
        jsonMode: true,
      });
    } catch (e) {
      if (/validate JSON/i.test(e.message)) throw new Error('作文内容较复杂，AI 批改未能完成，请重试一次或缩短作文长度');
      throw e;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('AI 未能返回有效的批改结果，请重试');
    }

    const result = {
      estimatedLevel: String(parsed.estimatedLevel || '').slice(0, 200),
      overallComment: String(parsed.overallComment || '').slice(0, 1000),
      correctedEssay: String(parsed.correctedEssay || '').slice(0, 4000),
      corrections: Array.isArray(parsed.corrections)
        ? parsed.corrections.slice(0, 60).map(c => ({
            original: String(c?.original || '').slice(0, 500),
            corrected: String(c?.corrected || '').slice(0, 500),
            explanation: String(c?.explanation || '').slice(0, 500),
          }))
        : [],
    };
    if (isEnglishMode) {
      result.scoreEstimate = String(parsed.scoreEstimate || '').slice(0, 100);
      result.rubric = {
        content: String(parsed.rubric?.content || '').slice(0, 300),
        organization: String(parsed.rubric?.organization || '').slice(0, 300),
        language: String(parsed.rubric?.language || '').slice(0, 300),
      };
    }

    recordActivity(user);
    saveDB(db);
    res.json(result);
  } catch (e) {
    console.error('作文批改失败:', e.message);
    res.status(500).json({ error: friendlyAiError(e) });
  }
});

// ==================== 词汇 / 背单词 ====================

function readVocab() {
  return JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf-8'));
}

// 完整词库浏览（不受复习到期时间限制，配合搜索/状态筛选，解决"两千个单词我想都看到"的需求）
app.get('/api/vocab/list', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  const progress = user.vocabProgress || {};
  let vocab = readVocab();
  const { level, q, status } = req.query;
  if (level) vocab = vocab.filter(w => w.level === level);
  if (q) {
    const kw = String(q).trim().toLowerCase();
    vocab = vocab.filter(w => w.word.toLowerCase().includes(kw) || (w.meaning_zh || '').includes(kw));
  }

  const withStatus = vocab.map(w => {
    const p = progress[w.word];
    let wordStatus;
    if (!p) wordStatus = 'new';
    else if ((p.reps || 0) >= LEARNING_STEPS_MIN.length && (p.interval || 0) >= 21) wordStatus = 'known';
    else wordStatus = 'learning';
    return { ...w, status: wordStatus };
  });

  const filtered = status ? withStatus.filter(w => w.status === status) : withStatus;
  res.json({ words: filtered, total: filtered.length });
});

function computeStats(vocab, progress) {
  let known = 0, learning = 0, newCount = 0;
  vocab.forEach(w => {
    const p = progress[w.word];
    if (!p) newCount++;
    // "已掌握"参考 Anki 对"成熟卡片"的标准：至少毕业出学习阶段，且间隔已经拉长到21天以上
    else if ((p.reps || 0) >= LEARNING_STEPS_MIN.length && (p.interval || 0) >= 21) known++;
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

// ---- 注册来源IP归属地查询（用于管理后台统计），本地/内网IP直接跳过 ----
function normalizeIp(ip) {
  return String(ip || '').replace('::ffff:', '');
}
function isPrivateIp(ip) {
  const clean = normalizeIp(ip);
  if (!clean) return true;
  return clean === '::1' || clean === '127.0.0.1' || /^10\./.test(clean) ||
    /^192\.168\./.test(clean) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(clean);
}
// 用免费的 ip-api.com 查归属地（无需 key，个人/小流量用途够用），查询失败不影响注册本身
async function lookupIpRegion(ip) {
  if (isPrivateIp(ip)) return '本地/内网';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(normalizeIp(ip))}?fields=status,country,regionName,city&lang=zh-CN`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await resp.json();
    if (data.status !== 'success') return '未知';
    return [data.country, data.regionName, data.city].filter(Boolean).join(' ') || '未知';
  } catch {
    return '未知';
  }
}
// 注册成功后异步查归属地，不阻塞注册响应；查到了再补写回用户记录
function fillRegistrationRegion(username, ip) {
  lookupIpRegion(ip).then(region => {
    const db = loadDB();
    if (db.users[username]) {
      db.users[username].registrationRegion = region;
      saveDB(db);
    }
  }).catch(() => {});
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
  // 优先安排已学过但到期的词，再补充新词；从20提到50一批，减少"明明还有很多词到期却看不到"的情况
  due.sort((a, b) => {
    const pa = progress[a.word], pb = progress[b.word];
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    return 0;
  });

  const page = due.slice(0, 50).map(w => ({ ...w, previews: previewRatings(progress[w.word]) }));
  res.json({ words: page, stats: computeStats(vocab, progress) });
});

// ---- 复习按钮的"预计下次间隔"提示（不落库，只是模拟四种评价各自的结果供前端展示） ----
function formatDueDelta(ms) {
  const mins = ms / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}分钟`;
  const days = ms / DAY_MS;
  if (days < 1) return `${Math.round(ms / 3600000)}小时`;
  if (days < 30) return `${Math.round(days)}天`;
  return `${Math.round(days / 30)}个月`;
}
function previewRatings(prev) {
  const out = {};
  for (const rating of ['again', 'hard', 'good', 'easy']) {
    out[rating] = formatDueDelta(scheduleReview(prev, rating).due - Date.now());
  }
  return out;
}

// ---- Anki 同款 SM-2 间隔重复算法 ----
// 新词/答错后先经过"学习阶段"（按分钟计的短间隔，对应Anki默认的1分钟→10分钟两级学习步骤），
// 连续两次"良好/简单"评价后"毕业"进入正式复习阶段（按天计，由难度系数ease动态调整间隔）。
// 四档评价（again/hard/good/easy）对应Anki的"忘记/困难/良好/简单"，每档都会微调ease，
// 这样"总是勉强想起来"的词间隔涨得慢，"一看就会"的词间隔涨得快，跟真人记忆曲线更贴近。
const LEARNING_STEPS_MIN = [1, 10];
const MIN_EASE = 1.3;
const GRADUATING_INTERVAL_DAYS = 1;
const EASY_INTERVAL_DAYS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

function scheduleReview(prev, rating) {
  const now = Date.now();
  let ease = prev?.ease ?? 2.5;
  let reps = prev?.reps ?? 0; // 0/1 = 还在学习阶段（对应 LEARNING_STEPS_MIN 下标）；>=2 = 已毕业进入正式复习
  let interval = prev?.interval ?? 0; // 天，仅毕业后有意义
  let lapses = prev?.lapses ?? 0;
  const inLearning = reps < LEARNING_STEPS_MIN.length;
  let dueMs;

  if (rating === 'again') {
    reps = 0;
    interval = 0;
    ease = Math.max(MIN_EASE, ease - 0.2);
    lapses += 1;
    dueMs = now + LEARNING_STEPS_MIN[0] * 60 * 1000;
  } else if (rating === 'hard') {
    ease = Math.max(MIN_EASE, ease - 0.15);
    if (inLearning) {
      dueMs = now + LEARNING_STEPS_MIN[reps] * 60 * 1000;
    } else {
      interval = Math.max(1, Math.round(interval * 1.2));
      dueMs = now + interval * DAY_MS;
    }
  } else if (rating === 'good') {
    if (inLearning) {
      reps += 1;
      if (reps < LEARNING_STEPS_MIN.length) {
        dueMs = now + LEARNING_STEPS_MIN[reps] * 60 * 1000;
      } else {
        interval = GRADUATING_INTERVAL_DAYS;
        dueMs = now + interval * DAY_MS;
      }
    } else {
      interval = Math.max(1, Math.round(interval * ease));
      reps += 1;
      dueMs = now + interval * DAY_MS;
    }
  } else { // easy
    ease = ease + 0.15;
    interval = inLearning ? EASY_INTERVAL_DAYS : Math.max(EASY_INTERVAL_DAYS, Math.round(interval * ease * 1.3));
    reps = Math.max(reps, LEARNING_STEPS_MIN.length) + 1;
    dueMs = now + interval * DAY_MS;
  }

  return {
    ease: Math.round(ease * 100) / 100,
    interval,
    reps,
    lapses,
    due: dueMs,
    lastReview: now,
  };
}

app.post('/api/vocab/review', requireAuth, (req, res) => {
  const { word, rating, skip } = req.body || {};
  if (!word) return res.status(400).json({ error: '缺少单词' });
  if (!skip && !['again', 'hard', 'good', 'easy'].includes(rating)) {
    return res.status(400).json({ error: '评价参数不合法' });
  }
  const db = loadDB();
  const user = db.users[req.session.userId];
  if (!user.vocabProgress) user.vocabProgress = {};
  const prev = user.vocabProgress[word];

  let next;
  if (skip) {
    // 跳过（已掌握）：直接记为成熟卡片，不用像正常复习一样一步步爬升
    next = { ease: 2.5, interval: 30, reps: LEARNING_STEPS_MIN.length + 5, lapses: prev?.lapses || 0, due: Date.now() + 30 * DAY_MS, lastReview: Date.now() };
  } else {
    next = scheduleReview(prev, rating);
  }
  user.vocabProgress[word] = next;
  recordActivity(user);
  saveDB(db);
  res.json({ progress: next });
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
    return p && !(p.reps >= LEARNING_STEPS_MIN.length && p.interval >= 21);
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

// ==================== 美式口语 ====================

function readColloquial() {
  return JSON.parse(fs.readFileSync(COLLOQUIAL_PATH, 'utf-8'));
}

app.get('/api/colloquial/list', requireAuth, (req, res) => {
  const phrases = readColloquial();
  const categories = [...new Set(phrases.map(p => p.category))];
  res.json({ phrases, categories });
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

app.post('/api/mistakes/upload', allowMemberOrFreeQuota('mistake', { type: 'count', max: 1 }), rateLimit(6), mistakeUpload.single('image'), async (req, res) => {
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
    res.status(500).json({ error: friendlyAiError(e) });
  }
});

// 打字手动输入错题（不需要图片，直接用文本模型分析，速度更快、不受视觉模型的额度限制）
app.post('/api/mistakes/submit-text', allowMemberOrFreeQuota('mistake', { type: 'count', max: 1 }), rateLimit(15), async (req, res) => {
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
    const raw = await callChatAPI({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
      temperature: 0.4,
      jsonMode: true,
    });
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
    res.status(500).json({ error: friendlyAiError(e) });
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
  let newUsersToday = 0, newUsersThisWeek = 0;
  const todayKey = dateKey(new Date());
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const regionCounts = {};
  users.forEach(u => {
    totalMistakes += (u.mistakes || []).length;
    totalChats += u.chatCount || 0;
    if (u.isMember) totalMembers++;
    const stats = computeStats(vocab, u.vocabProgress || {});
    totalVocabMastered += stats.known;
    if (u.createdAt && dateKey(new Date(u.createdAt)) === todayKey) newUsersToday++;
    if (u.createdAt && u.createdAt >= weekAgo) newUsersThisWeek++;
    const region = u.registrationRegion || '未知';
    regionCounts[region] = (regionCounts[region] || 0) + 1;
  });
  const regionBreakdown = Object.entries(regionCounts)
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    totalUsers: users.length,
    totalMembers,
    totalMistakes,
    totalChats,
    totalVocabMastered,
    vocabBankSize: vocab.length,
    newUsersToday,
    newUsersThisWeek,
    regionBreakdown,
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
      registrationIp: u.registrationIp || '-',
      registrationRegion: u.registrationRegion || '未知',
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ users });
});

// 管理员手动创建账号：常用于给测试/线下沟通好的用户直接开号，跳过手机验证门槛
// （管理员已经人工核实过，不需要再走一遍防刷验证）
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, password, nickname, isMember } = req.body || {};
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
    isMember: !!isMember,
    memberSince: isMember ? Date.now() : null,
    level: 'beginner',
    targetLang: 'en',
    createdAt: Date.now(),
    vocabProgress: {},
    mistakes: [],
    activityLog: {},
    chatCount: 0,
    registrationIp: '-',
    registrationRegion: '管理员创建',
    phoneVerified: true,
  };
  saveDB(db);
  res.json({ ok: true });
});

// 管理员修改用户会员状态：开通/取消会员
app.post('/api/admin/users/:username/membership', requireAdmin, (req, res) => {
  const { username } = req.params;
  const { isMember } = req.body || {};
  const db = loadDB();
  const user = db.users[username];
  if (!user) return res.status(404).json({ error: '用户不存在' });
  user.isMember = !!isMember;
  if (isMember && !user.memberSince) user.memberSince = Date.now();
  saveDB(db);
  res.json({ ok: true });
});

// 管理员重置用户密码：用户忘记密码时的人工支持手段
app.post('/api/admin/users/:username/reset-password', requireAdmin, async (req, res) => {
  const { username } = req.params;
  const { newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: '密码至少需要6位' });
  }
  const db = loadDB();
  const user = db.users[username];
  if (!user) return res.status(404).json({ error: '用户不存在' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  saveDB(db);
  res.json({ ok: true });
});

// 管理员删除用户：管理员自己的账号不允许在这里删掉（避免误操作把自己权限删没了）
app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  if (ADMIN_USERNAME && username === ADMIN_USERNAME) {
    return res.status(400).json({ error: '不能删除管理员自己的账号' });
  }
  const db = loadDB();
  const user = db.users[username];
  if (!user) return res.status(404).json({ error: '用户不存在' });
  (user.mistakes || []).forEach(m => {
    if (m.imageFile) fs.unlink(path.join(UPLOADS_DIR, m.imageFile), () => {});
  });
  delete db.users[username];
  saveDB(db);
  res.json({ ok: true });
});

// multer / 上传相关错误统一转成 JSON 响应
app.use((err, req, res, next) => {
  if (!err) return next();
  console.error('上传错误:', err.message);
  res.status(400).json({ error: err.message || '上传失败' });
});

initDB().then(() => app.listen(PORT, () => {
  console.log(`\n✅ LangBuddy 语伴已启动`);
  console.log(`   本地访问: http://localhost:${PORT}`);
  console.log(`   使用模型: ${SF_MODEL}\n`);
})).catch(err => {
  console.error('❌ 启动失败，数据库连接出错:', err.message);
  process.exit(1);
});
