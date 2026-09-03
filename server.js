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
const SF_BASE_URL = process.env.SF_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions';
// 模型名做成可配置：厂商下线模型时（llama-3.3-70b-versatile 就被 Groq 下线过，
// 直接返回404导致全站对话瘫痪）能在环境变量里立刻改，不用重新发版
const SF_MODEL = process.env.SF_MODEL || 'openai/gpt-oss-120b';
const VISION_MODEL = process.env.VISION_MODEL || 'qwen/qwen3.6-27b';

// OpenRouter 配置（备用，免费模型）：Groq 触发限流/报错时自动无缝切换过来救急，
// 每次请求都会重新优先尝试 Groq，Groq 恢复后自动切回，不需要额外的"探测恢复"逻辑
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
// 备用模型要选"指令型"而不是"推理型"：nemotron 那类推理模型会把自己的思考过程
// 当成回复吐出来（用户会看到一大段自言自语），gemma 是指令模型，回复干净
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';

// 国内大模型兜底配置：国内厂商（智谱/阿里百炼/DeepSeek/硅基流动等）基本都兼容 OpenAI 协议，
// 所以只要换 baseUrl + key + model 三个环境变量就能切换厂商，不用改代码。
// 默认指向智谱 GLM-4-Flash（免费模型），只要配上 DOMESTIC_API_KEY 就会自动启用这一级兜底。
const DOMESTIC_API_KEY = process.env.DOMESTIC_API_KEY;
const DOMESTIC_BASE_URL = process.env.DOMESTIC_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const DOMESTIC_MODEL = process.env.DOMESTIC_MODEL || 'glm-4-flash';

// Tavus 数字人（实时视频对话）。按实际通话分钟计费，约 ¥1.7-2.7/分钟，比文本对话贵两三个
// 数量级——包月 ¥29 的会员用满 12 分钟就把整月会费烧光了。所以这个功能必须严格限量：
// 仅会员 + 每月独立分钟额度 + 单次会话硬上限 + 用户离开自动结束。
// 没配 TAVUS_API_KEY / TAVUS_REPLICA_ID 就整体关闭，其余功能不受影响。
const TAVUS_API_KEY = process.env.TAVUS_API_KEY;
const TAVUS_BASE_URL = process.env.TAVUS_BASE_URL || 'https://tavusapi.com/v2';
// Tavus 把 replica 改名成 face、persona 改名成 PAL，接口字段也跟着变了。
// 环境变量两套名字都认，免得照着旧教程配了半天发现不生效。
const TAVUS_FACE_ID = process.env.TAVUS_FACE_ID || process.env.TAVUS_REPLICA_ID; // 数字人形象
const TAVUS_PAL_ID = process.env.TAVUS_PAL_ID || process.env.TAVUS_PERSONA_ID;   // 人设，可留空
const AVATAR_MONTHLY_MINUTES = Number(process.env.AVATAR_MONTHLY_MINUTES || 10);
const AVATAR_MAX_CALL_SECONDS = Number(process.env.AVATAR_MAX_CALL_SECONDS || 300);
const avatarEnabled = () => !!(TAVUS_API_KEY && TAVUS_FACE_ID);

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

function makeAuthToken(username) {
  return `${username}.${signValue(username)}`;
}
// 校验签名并取出用户名，签名不对就返回空
function verifyAuthToken(token) {
  if (!token) return null;
  const sepIdx = token.lastIndexOf('.');
  if (sepIdx <= 0) return null;
  const name = token.slice(0, sepIdx);
  const sig = token.slice(sepIdx + 1);
  return sig === signValue(name) ? name : null;
}

function cookieSession(req, res, next) {
  // 网页端走 cookie；App（Capacitor）里 WebView 的源是 capacitor://localhost，
  // 调线上API属于跨站，httpOnly+SameSite=Lax 的 cookie 浏览器不会发送，
  // 所以同时支持 Authorization: Bearer <token>，token 内容和 cookie 里是同一个签名串。
  const cookies = parseCookies(req.headers.cookie);
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
  let userId = verifyAuthToken(bearer) || verifyAuthToken(cookies[AUTH_COOKIE]) || undefined;

  req.session = {
    get userId() { return userId; },
    set userId(v) {
      userId = v;
      // 同时下发 cookie（网页端用）和把 token 挂到 res.locals（登录类接口会放进响应体给App用）
      res.locals.authToken = makeAuthToken(v);
      res.cookie(AUTH_COOKIE, res.locals.authToken, {
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

  // 登录/注册类接口的响应体里自动附带 token，App 存下来后续请求带在请求头里。
  // 网页端用不上这个字段，无视即可。
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.locals.authToken && body && typeof body === 'object' && !Array.isArray(body) && body.user) {
      body.token = res.locals.authToken;
    }
    return origJson(body);
  };
  next();
}

// App 的 WebView 源和网站不同域，必须显式放行，否则浏览器会拦掉所有请求。
// 只放行已知的几个源，不用 * （带 credentials 时 * 也不合法）
const ALLOWED_APP_ORIGINS = new Set([
  'capacitor://localhost',  // iOS Capacitor
  'ionic://localhost',
  'http://localhost',       // Android Capacitor
  'https://localhost',
]);
// 本地开发时（没配 MONGODB_URI 就认为是本地环境）额外放行任意 localhost 端口，
// 方便用模拟环境把App指向本地服务器调试；线上不会走到这个分支
const IS_LOCAL_DEV = !process.env.MONGODB_URI;
function isAllowedOrigin(origin) {
  if (ALLOWED_APP_ORIGINS.has(origin)) return true;
  return IS_LOCAL_DEV && /^https?:\/\/localhost(:\d+)?$/.test(origin);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

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
// 会员是否仍在有效期内。memberUntil 为空表示永久会员（管理员手动开通的、以及历史数据），
// 有值就按到期时间判断，过期后自动按非会员处理，不需要额外的定时任务去"降级"
function isActiveMember(user) {
  if (!user || !user.isMember) return false;
  if (!user.memberUntil) return true;
  return user.memberUntil > Date.now();
}

function requireMember(req, res, next) {
  const db = loadDB();
  const user = db.users[req.session.userId];
  if (!req.session.userId || !user) return res.status(401).json({ error: '请先登录' });
  if (!isActiveMember(user)) return res.status(403).json({ error: '此功能需要会员权限，请先开通会员', needMembership: true });
  next();
}

// 额度只在请求真正成功后才扣。放在响应的 finish 事件里判断状态码，这样参数错误(4xx)、
// AI 限流或调用失败(5xx)、客户端中途断开都不会消耗用户次数——免费额度本来就不多，
// 因为报错白掉一次对用户很不友好。各业务处理函数不需要关心额度逻辑。
function consumeQuotaOnSuccess(res, userId, mutate) {
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const db = loadDB();
    const user = db.users[userId];
    if (!user) return;
    if (!user.freeUsage) user.freeUsage = {};
    mutate(user.freeUsage);
    saveDB(db);
  });
}

// 未验证手机号的账号（目前只有微信/QQ 登录进来的）给一份很小的尝鲜额度。
// 以前是直接拦死，导致第三方登录用户开箱体验为 0，一点甜头没尝到就流失；
// 注册接口本身强制手机号验证，所以没法靠批量注册小号来刷这份尝鲜额度。
const TRIAL_WINDOW_MS = 60 * 1000; // AI 对话：1 分钟
const TRIAL_COUNT = 1;             // 其余功能：各 1 次

// 非会员每日免费体验额度：会员不限量，非会员每天限量试用，用完后提示开通会员
// type: 'window' 表示从当天第一次使用起计算的时长限额（如AI对话每天5分钟）；'count' 表示每天限次数（如作文批改/错题本/语法批改每天3次）
function allowMemberOrFreeQuota(feature, quota) {
  return (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: '请先登录' });
    const db = loadDB();
    const user = db.users[req.session.userId];
    if (!user) return res.status(401).json({ error: '请先登录' });
    if (isActiveMember(user)) return next();

    // 尝鲜额度单独记在 trial: 前缀下，绑定手机号后立刻拿到一份完整的当日免费额度，
    // 不会被之前试用掉的次数抵扣——这本身也是引导绑定的甜头
    const isTrial = !user.phoneVerified;
    const key = isTrial ? `trial:${feature}` : feature;
    const limit = !isTrial ? quota
      : quota.type === 'window'
        ? { type: 'window', windowMs: TRIAL_WINDOW_MS }
        : { type: 'count', max: TRIAL_COUNT };

    const today = dateKey(new Date());
    const rec = user.freeUsage && user.freeUsage[key];
    const isToday = rec && rec.date === today;

    const denyExhausted = () => {
      if (isTrial) {
        return res.status(403).json({
          error: '试用额度已用完，在"我的"页面验证手机号即可解锁每日免费额度',
          needPhoneVerify: true,
        });
      }
      return res.status(403).json(limit.type === 'window'
        ? { error: `非会员每天可免费体验${Math.round(limit.windowMs / 60000)}分钟AI对话，开通会员畅享无限时长`, needMembership: true }
        : { error: '今日免费试用次数已用完，开通会员畅享无限次使用', needMembership: true });
    };

    if (limit.type === 'window') {
      if (isToday && Date.now() - rec.firstAt >= limit.windowMs) return denyExhausted();
      // 当天首次使用：等这次请求成功了再开始计时，免得第一次就报错却已经把窗口耗掉了
      if (!isToday) {
        consumeQuotaOnSuccess(res, req.session.userId, usage => {
          const cur = usage[key];
          if (!cur || cur.date !== today) usage[key] = { date: today, firstAt: Date.now() };
        });
      }
      return next();
    }

    // type === 'count'
    if (isToday && rec.count >= limit.max) return denyExhausted();
    consumeQuotaOnSuccess(res, req.session.userId, usage => {
      const cur = usage[key];
      if (cur && cur.date === today) cur.count += 1;
      else usage[key] = { date: today, count: 1 };
    });
    return next();
  };
}

// 两级管理员：
//   ADMIN_USERNAME（普通管理员）——只能看用户列表和统计、给用户开通/取消会员
//   SUPER_ADMIN_USERNAME（超级管理员）——拥有全部权限，额外能看注册公网IP和归属地，
//   以及新增用户、删除用户、重置密码这些敏感操作
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME || 'administrator';

function isSuperAdminName(username) {
  return !!SUPER_ADMIN_USERNAME && username === SUPER_ADMIN_USERNAME;
}
function isAdminName(username) {
  return isSuperAdminName(username) || (!!ADMIN_USERNAME && username === ADMIN_USERNAME);
}

// 普通管理员及以上都能过
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '请先登录' });
  if (!isAdminName(req.session.userId)) return res.status(403).json({ error: '无权限访问' });
  next();
}

// 只有超级管理员能过
function requireSuperAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '请先登录' });
  if (!isSuperAdminName(req.session.userId)) {
    return res.status(403).json({ error: '该操作仅超级管理员可用' });
  }
  next();
}

// ---- 登录/登出行为记录（仅超级管理员可查看）----
// 每个用户只保留最近 50 条，避免长期使用后数据无限膨胀。
// 注意：cookie 到期导致的"自动掉线"不会产生登出记录，因为那是客户端静默失效，
// 服务端并不知情——所以登录记录数量通常会多于登出记录，这是正常的。
const AUTH_LOG_LIMIT = 50;
function recordAuthEvent(user, type, method, req) {
  if (!user) return;
  if (!Array.isArray(user.authLog)) user.authLog = [];
  user.authLog.push({
    type,                       // 'login' | 'logout'
    method: method || '',       // password / phone / register / qq / wechat
    at: Date.now(),
    ip: getClientIp(req),
  });
  if (user.authLog.length > AUTH_LOG_LIMIT) {
    user.authLog = user.authLog.slice(-AUTH_LOG_LIMIT);
  }
  if (type === 'login') user.lastLoginAt = Date.now();
  else user.lastLogoutAt = Date.now();
}

function publicUser(user) {
  return {
    username: user.username,
    nickname: user.nickname,
    // 前端只认这一个字段来判断"现在是不是会员"，过期的会员这里就是 false，不用前端自己算时间
    isMember: isActiveMember(user),
    memberSince: user.memberSince,
    memberUntil: user.memberUntil || null,
    level: user.level,
    targetLang: user.targetLang,
    createdAt: user.createdAt,
    isAdmin: isAdminName(user.username),
    isSuperAdmin: isSuperAdminName(user.username),
    phone: user.phone || null,
    phoneVerified: !!user.phoneVerified,
    avatar: user.avatar || null,
  };
}

// 头像存进数据库而不是磁盘：Render 的容器磁盘是临时的，存成文件的话每次部署
// 所有人的头像都会消失。但整个库是一个 Mongo 文档（16MB上限），所以自定义头像
// 必须足够小——前端会先压到 96×96 再上传，这里再兜底卡一道大小。
const AVATAR_PRESETS = ['🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐧', '🦉', '🐬', '🦄', '🌸', '⭐'];
const MAX_AVATAR_BYTES = 24 * 1024; // base64 后约 24KB，对应 96×96 的 JPEG 绰绰有余

app.post('/api/profile/avatar', requireAuth, (req, res) => {
  const { type, value } = req.body || {};
  if (type === 'preset') {
    if (!AVATAR_PRESETS.includes(value)) return res.status(400).json({ error: '不支持的头像' });
  } else if (type === 'image') {
    if (typeof value !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(value)) {
      return res.status(400).json({ error: '图片格式不支持' });
    }
    if (value.length > MAX_AVATAR_BYTES) {
      return res.status(400).json({ error: '图片过大，请换一张' });
    }
  } else if (type !== 'none') {
    return res.status(400).json({ error: '参数不合法' });
  }

  const db = loadDB();
  const user = db.users[req.session.userId];
  user.avatar = type === 'none' ? null : { type, value };
  saveDB(db);
  res.json({ user: publicUser(user) });
});

app.get('/api/profile/avatar-presets', (req, res) => {
  res.json({ presets: AVATAR_PRESETS });
});

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

// 统一的文本AI调用入口：三级兜底，前一级限流就自动降到下一级，用户端无感知。
//   1) Groq（主力，速度最快，但免费额度有限：约12000 tokens/分钟、100000 tokens/天）
//   2) OpenRouter 免费模型（第一备用）
//   3) 国内大模型（第二备用，兼容OpenAI协议，配了 DOMESTIC_API_KEY 才启用）
// 每次调用都重新从第一级开始试，Groq 恢复后自动切回，不需要额外的"探测恢复"逻辑。
const AI_PROVIDERS = [
  { name: 'Groq', url: () => SF_BASE_URL, key: () => SF_API_KEY, model: () => SF_MODEL },
  { name: 'OpenRouter', url: () => OPENROUTER_BASE_URL, key: () => OPENROUTER_API_KEY, model: () => OPENROUTER_MODEL },
  { name: '国内大模型', url: () => DOMESTIC_BASE_URL, key: () => DOMESTIC_API_KEY, model: () => DOMESTIC_MODEL },
];

async function callChatAPI(opts) {
  const available = AI_PROVIDERS.filter(p => p.key());
  if (!available.length) throw new Error('AI 服务未配置，请联系管理员');

  let lastError = null;
  for (let i = 0; i < available.length; i++) {
    const p = available[i];
    try {
      return await callTextModel(p.url(), p.key(), p.model(), opts);
    } catch (e) {
      lastError = e;
      const isLast = i === available.length - 1;
      if (isLast) throw e;
      // 任何错误都降级到下一家，不只是限流。
      // 教训：之前只在限流时降级，结果 Groq 下线了某个模型返回 404，
      // 这个错误不匹配"限流"就被直接抛出，压根没去试明明是好的 OpenRouter，
      // 导致全站对话瘫痪。上游厂商随时可能下线模型/改鉴权/挂掉，
      // 只要还有备用通道就应该试，试不通再报错。
      const reason = isRateLimitError(e) ? '触发限流' : `调用失败(${e.status || '?'})`;
      console.warn(`${p.name} ${reason}，自动切换到 ${available[i + 1].name}:`, e.message);
    }
  }
  throw lastError;
}

// ==================== 账号 & 会员 ====================

// 注册必须同时提供手机号+验证码，杜绝"只填用户名密码"就能无限开小号防刷免费额度的漏洞——
// 一个手机号只能注册一个账号，验证码复用 /api/auth/phone/send-code 发送的那套（一次性使用）
app.post('/api/register', rateLimit(10), async (req, res) => {
  const { username, password, nickname, phone, code } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (typeof username !== 'string' || username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: '用户名长度需为3-30位' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: '密码至少需要6位' });
  }
  if (!isValidPhone(phone)) return res.status(400).json({ error: '请输入正确的11位手机号' });
  if (!code || !String(code).trim()) return res.status(400).json({ error: '请输入验证码' });

  const record = phoneCodeStore.get(phone);
  if (!record || record.code !== String(code).trim()) return res.status(400).json({ error: '验证码错误' });
  if (Date.now() > record.expiresAt) {
    phoneCodeStore.delete(phone);
    return res.status(400).json({ error: '验证码已过期，请重新获取' });
  }

  const db = loadDB();
  if (db.users[username]) return res.status(400).json({ error: '用户名已被注册' });
  const phoneOwner = Object.values(db.users).find(u => u.phone === phone);
  if (phoneOwner) return res.status(400).json({ error: '该手机号已注册过账号，请直接登录或换一个手机号' });

  phoneCodeStore.delete(phone); // 验证码一次性使用
  const passwordHash = await bcrypt.hash(password, 10);
  const clientIp = getClientIp(req);
  db.users[username] = {
    username,
    nickname: (nickname && String(nickname).slice(0, 30)) || username,
    passwordHash,
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
  recordAuthEvent(db.users[username], 'login', 'register', req);
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
  recordAuthEvent(user, 'login', 'password', req);
  saveDB(db);
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
  const clientIp = getClientIp(req);
  // 一个手机号只能对应一个账号：必须按 phone 字段找主人，不能只看"用户名是否等于手机号"——
  // 否则手机号已经绑在别的用户名（如 alice）上时会查不到，又给同一个手机号建出第二个账号
  const owner = Object.values(db.users).find(u => u.phone === phone);
  const isNewUser = !owner;
  const userId = owner ? owner.username : phone;

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
  }
  recordAuthEvent(db.users[userId], 'login', isNewUser ? 'register' : 'phone', req);
  saveDB(db);
  req.session.userId = userId;
  res.json({ user: publicUser(db.users[userId]) });
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

// ==================== 第三方授权登录（微信 / QQ） ====================
// 两家都是标准 OAuth2 授权码流程，差别只在接口地址和字段名，这里抽象成同一套配置。
//
// 申请门槛（配置前必须先拿到资质）：
//   微信：open.weixin.qq.com 注册"网站应用"，要求开发者主体是【企业】并完成认证
//         （认证费300元/年），个人主体申请不了。
//   QQ  ：connect.qq.com（QQ互联），【个人开发者可以申请】，需要备案域名。
// 没配对应的 APP_ID/SECRET 时，前端会自动隐藏该入口，不影响其他登录方式。
const OAUTH_PROVIDERS = {
  wechat: {
    name: '微信',
    appId: process.env.WECHAT_APP_ID || '',
    appSecret: process.env.WECHAT_APP_SECRET || '',
    authUrl: 'https://open.weixin.qq.com/connect/qrconnect',
    scope: 'snsapi_login',
  },
  qq: {
    name: 'QQ',
    appId: process.env.QQ_APP_ID || '',
    appSecret: process.env.QQ_APP_KEY || '',
    // 接口域名做成可配置，正式环境用默认值，本地可以指向 mock 服务做端到端测试
    apiBase: process.env.QQ_API_BASE || 'https://graph.qq.com',
    get authUrl() { return `${this.apiBase}/oauth2.0/authorize`; },
    scope: 'get_user_info',
  },
};
const oauthEnabled = (p) => !!(OAUTH_PROVIDERS[p]?.appId && OAUTH_PROVIDERS[p]?.appSecret);
const oauthRedirectUri = (p) => `${SITE_URL}/api/auth/${p}/callback`;

// state 用来防 CSRF：发起授权时生成并记住，回调时必须能对上。
// 存内存即可——它只需要活几分钟，服务重启导致的失效只会让用户重点一次登录。
const oauthStateStore = new Map();
function issueOAuthState(provider) {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStateStore.set(state, { provider, createdAt: Date.now() });
  // 顺手清理过期的，避免内存无限增长
  const now = Date.now();
  for (const [k, v] of oauthStateStore) {
    if (now - v.createdAt > 10 * 60 * 1000) oauthStateStore.delete(k);
  }
  return state;
}
function consumeOAuthState(state, provider) {
  const rec = oauthStateStore.get(state);
  if (!rec || rec.provider !== provider) return false;
  oauthStateStore.delete(state); // 一次性使用
  return Date.now() - rec.createdAt <= 10 * 60 * 1000;
}

// 前端据此决定显示哪些第三方登录按钮
app.get('/api/auth/oauth/available', (req, res) => {
  res.json({
    wechat: oauthEnabled('wechat'),
    qq: oauthEnabled('qq'),
  });
});

app.get('/api/auth/:provider/login-url', (req, res) => {
  const { provider } = req.params;
  const conf = OAUTH_PROVIDERS[provider];
  if (!conf) return res.status(404).json({ error: '不支持的登录方式' });
  if (!oauthEnabled(provider)) {
    return res.status(501).json({
      error: provider === 'wechat'
        ? '微信登录尚未开通（需企业主体在微信开放平台申请网站应用）'
        : 'QQ登录尚未开通（需在QQ互联申请并通过审核）',
    });
  }
  const state = issueOAuthState(provider);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: conf.appId,
    redirect_uri: oauthRedirectUri(provider),
    scope: conf.scope,
    state,
  });
  // 微信的参数名是 appid 而不是 client_id，且要求URL末尾带 #wechat_redirect
  let url = `${conf.authUrl}?${params.toString()}`;
  if (provider === 'wechat') {
    params.delete('client_id');
    params.set('appid', conf.appId);
    url = `${conf.authUrl}?${params.toString()}#wechat_redirect`;
  }
  res.json({ url });
});

// QQ 的部分接口返回的是 callback(...) 形式的 JSONP，这里统一剥出 JSON
function parseQQResponse(text) {
  const m = text.match(/callback\(\s*([\s\S]*?)\s*\)/);
  if (m) return JSON.parse(m[1]);
  try { return JSON.parse(text); } catch { return null; }
}

// 用授权码换取该用户在本平台的唯一标识（openid）和昵称
async function fetchOAuthProfile(provider, code) {
  const conf = OAUTH_PROVIDERS[provider];
  if (provider === 'wechat') {
    const tokenResp = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${conf.appId}&secret=${conf.appSecret}&code=${encodeURIComponent(code)}&grant_type=authorization_code`);
    const token = await tokenResp.json();
    if (!token.openid) throw new Error(token.errmsg || '微信授权失败');
    const infoResp = await fetch(`https://api.weixin.qq.com/sns/userinfo?access_token=${token.access_token}&openid=${token.openid}`);
    const info = await infoResp.json();
    return {
      // 有 unionid 优先用它：同一主体下多个应用能识别为同一个人
      openid: token.unionid || token.openid,
      nickname: info.nickname || '微信用户',
    };
  }

  // QQ
  const base = conf.apiBase;
  const tokenResp = await fetch(`${base}/oauth2.0/token?grant_type=authorization_code&client_id=${conf.appId}&client_secret=${conf.appSecret}&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(oauthRedirectUri('qq'))}&fmt=json`);
  const token = await tokenResp.json();
  if (!token.access_token) throw new Error(token.error_description || 'QQ授权失败');
  const meResp = await fetch(`${base}/oauth2.0/me?access_token=${token.access_token}&fmt=json`);
  const me = parseQQResponse(await meResp.text());
  if (!me?.openid) throw new Error('未能获取QQ用户标识');
  const infoResp = await fetch(`${base}/user/get_user_info?access_token=${token.access_token}&oauth_consumer_key=${conf.appId}&openid=${me.openid}`);
  const info = await infoResp.json();
  return { openid: me.openid, nickname: info.nickname || 'QQ用户' };
}

// 保证用户名唯一：昵称可能重复或含奇怪字符，这里生成一个稳定可读的账号名
function makeOAuthUsername(db, provider, nickname) {
  const base = String(nickname || '').replace(/[^\w一-龥]/g, '').slice(0, 12) || `${provider}用户`;
  let name = base;
  let i = 1;
  while (db.users[name]) name = `${base}${++i}`;
  return name;
}

app.get('/api/auth/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state } = req.query;
  if (!OAUTH_PROVIDERS[provider] || !oauthEnabled(provider)) {
    return res.redirect('/?login_error=' + encodeURIComponent('该登录方式未开通'));
  }
  if (!code || !consumeOAuthState(state, provider)) {
    return res.redirect('/?login_error=' + encodeURIComponent('授权已过期，请重新登录'));
  }
  try {
    const profile = await fetchOAuthProfile(provider, code);
    const db = loadDB();
    const key = `${provider}:${profile.openid}`;

    // 已经用这个第三方账号登录过就直接进，否则建一个新账号
    let username = Object.keys(db.users).find(u => db.users[u].oauthKey === key);
    if (!username) {
      username = makeOAuthUsername(db, provider, profile.nickname);
      db.users[username] = {
        username,
        nickname: profile.nickname,
        passwordHash: null, // 第三方登录的账号没有密码，只能走第三方入口登录
        oauthKey: key,
        oauthProvider: provider,
        isMember: false,
        memberSince: null,
        memberUntil: null,
        level: 'beginner',
        targetLang: 'en',
        createdAt: Date.now(),
        vocabProgress: {},
        mistakes: [],
        activityLog: {},
        chatCount: 0,
        registrationIp: getClientIp(req),
        registrationRegion: '查询中...',
        // 第三方登录没有手机号，免费额度仍需绑定手机后才发放（防刷策略保持一致）
        phoneVerified: false,
      };
      fillRegistrationRegion(username, getClientIp(req));
    }
    recordAuthEvent(db.users[username], 'login', provider, req);
    saveDB(db);
    req.session.userId = username;
    // 带上 token，App(Capacitor) 端从URL里取出来存本地即可完成登录
    res.redirect('/?login_token=' + encodeURIComponent(makeAuthToken(username)));
  } catch (e) {
    console.error(`[OAuth ${provider}] 登录失败:`, e.message);
    res.redirect('/?login_error=' + encodeURIComponent('第三方登录失败，请重试或改用其他方式'));
  }
});

app.post('/api/logout', (req, res) => {
  // 先记录再销毁会话，否则拿不到是谁登出的
  if (req.session.userId) {
    const db = loadDB();
    const user = db.users[req.session.userId];
    if (user) {
      recordAuthEvent(user, 'logout', '', req);
      saveDB(db);
    }
  }
  req.session.destroy(() => res.json({ ok: true }));
});

// 轻量诊断接口：不暴露任何敏感信息，只用来确认当前是不是接到了持久化数据库
// ==================== 服务端语音识别（浏览器不支持听写时的兜底） ====================
// 微信/QQ 等内置浏览器既没有 speechSynthesis 也没有 SpeechRecognition，
// 这些用户原本完全用不了实时翻译。前端会改成"录一段音上传"，这里用 Whisper 转文字。
const ASR_MODEL = process.env.ASR_MODEL || 'whisper-large-v3-turbo';
const audioUpload = multer({
  storage: multer.memoryStorage(), // 音频转完文字就没用了，不落盘
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.post('/api/transcribe', allowMemberOrFreeQuota('translate', { type: 'count', max: 30 }), rateLimit(20), audioUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到录音' });
  if (!SF_API_KEY) return res.status(501).json({ error: '语音识别未配置' });

  try {
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), req.file.originalname || 'audio.webm');
    form.append('model', ASR_MODEL);
    // 指定语言能显著提高准确率，前端会把"对方说的语言"传过来
    if (req.body?.language && LANG_NAME[req.body.language]) form.append('language', req.body.language);
    form.append('response_format', 'json');

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SF_API_KEY}` },
      body: form,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error('[ASR] 识别失败:', err?.error?.message || resp.status);
      return res.status(502).json({ error: '语音识别暂时不可用，请稍后再试' });
    }
    const data = await resp.json();
    res.json({ text: String(data.text || '').trim() });
  } catch (e) {
    console.error('[ASR] 异常:', e.message);
    res.status(502).json({ error: '语音识别暂时不可用，请稍后再试' });
  }
});

// ==================== 实时翻译 ====================
// 对方说外语 → 识别成文字 → 这里翻译 → 前端用指定语言朗读出来。
// 用途是当场沟通，所以只要译文本身，不要任何解释性废话，否则朗读出来很啰嗦。
app.post('/api/translate', allowMemberOrFreeQuota('translate', { type: 'count', max: 30 }), rateLimit(40), async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const from = req.body?.from;
  const to = req.body?.to;
  if (!text) return res.status(400).json({ error: '没有需要翻译的内容' });
  if (text.length > 500) return res.status(400).json({ error: '单次翻译内容过长' });
  const toName = LANG_NAME[to];
  if (!toName) return res.status(400).json({ error: '目标语言不支持' });
  const fromName = LANG_NAME[from] || '自动识别的语言';

  const systemPrompt = `你是专业的同声传译员。把用户给你的${fromName}内容翻译成${toName}。

严格要求：
1. 只输出译文本身，不要加任何解释、注释、引号或"翻译："之类的前缀。
2. 口语化、自然，像真人现场口译，不要书面腔。
3. 保留原话的语气（疑问就是疑问，命令就是命令）。
4. 如果原文是不完整的片段或听不清的内容，就按字面尽力翻译，不要自行脑补补全。
5. 无论原文是什么语言，译文必须是${toName}。`;

  try {
    const translation = await callChatAPI({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      maxTokens: 500,
      temperature: 0.2, // 翻译要稳定，不需要发挥
    });
    const db = loadDB();
    const user = db.users[req.session.userId];
    if (user) { recordActivity(user); saveDB(db); }
    res.json({ translation: String(translation || '').trim() });
  } catch (e) {
    console.error('翻译失败:', e.message);
    res.status(500).json({ error: friendlyAiError(e) });
  }
});

// ==================== 服务端语音合成（浏览器不支持朗读时的兜底） ====================
// 微信/QQ 等 App 内置浏览器没有 speechSynthesis，这些用户在网页端完全听不到发音。
// 前端会先用浏览器原生朗读（快且不耗额度），只有原生不可用时才调这个接口。
const TTS_MODEL = process.env.TTS_MODEL || 'canopylabs/orpheus-v1-english';
// 该模型仅接受这几个音色：autumn diana hannah austin daniel troy
const TTS_VOICE = process.env.TTS_VOICE || 'hannah';
const TTS_MAX_CHARS = 300;

// 背单词场景同一个词会被反复点，缓存能省掉绝大部分重复合成。
// 只放内存里：容器重启丢了也无所谓，重新合成即可。
const ttsCache = new Map();
const TTS_CACHE_MAX = 300;

app.post('/api/tts', requireAuth, rateLimit(30), async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: '缺少文本' });
  if (text.length > TTS_MAX_CHARS) return res.status(400).json({ error: '文本过长' });
  if (!SF_API_KEY) return res.status(501).json({ error: '服务端朗读未配置' });

  const cacheKey = `${TTS_MODEL}|${TTS_VOICE}|${text}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'audio/wav');
    return res.end(cached);
  }

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SF_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: TTS_MODEL, input: text, voice: TTS_VOICE, response_format: 'wav' }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${resp.status}`;
      // 模型首次使用需要账号管理员在 Groq 控制台接受条款，这个错误要能一眼看懂
      if (/terms acceptance/i.test(msg)) {
        console.error('[TTS] 需要在 Groq 控制台接受模型条款:', msg);
        return res.status(503).json({ error: '服务端朗读尚未启用（管理员需先接受模型条款）' });
      }
      console.error('[TTS] 合成失败:', msg);
      return res.status(502).json({ error: '朗读服务暂时不可用，请稍后再试' });
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    // 简单的先进先出淘汰，避免内存无限增长
    if (ttsCache.size >= TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(cacheKey, buf);

    res.setHeader('Content-Type', 'audio/wav');
    res.end(buf);
  } catch (e) {
    console.error('[TTS] 异常:', e.message);
    res.status(502).json({ error: '朗读服务暂时不可用，请稍后再试' });
  }
});

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

// ==================== 会员支付（ZPay 聚合支付，支持微信/支付宝） ====================
// 没配置 ZPAY_PID/ZPAY_KEY 时自动退回"演示版免费开通"，方便本地开发和未接支付前试用。
// 配好环境变量后自动切换成真实支付，代码不用改。

const ZPAY_PID = process.env.ZPAY_PID || '';
const ZPAY_KEY = process.env.ZPAY_KEY || '';
const ZPAY_GATEWAY = process.env.ZPAY_GATEWAY || 'https://zpayz.cn';
// 回调地址必须是外网能访问到的完整域名，本地开发时支付回调是收不到的
const SITE_URL = process.env.SITE_URL || 'https://langbuddy.org';
const payEnabled = () => !!(ZPAY_PID && ZPAY_KEY);

const MEMBER_PLANS = {
  monthly: { name: 'LangBuddy 会员·包月', days: 30, price: '29.00' },
  yearly: { name: 'LangBuddy 会员·包年', days: 365, price: '199.00' },
};

// ZPay(易支付协议)签名：参数按key的ASCII升序排列，跳过sign/sign_type和空值，
// 拼成 a=1&b=2 后直接拼上商户密钥再做MD5，结果转小写
function zpaySign(params) {
  const str = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] != null)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('md5').update(str + ZPAY_KEY).digest('hex');
}

function newOrderNo() {
  return Date.now() + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
}

// 给用户加会员时长：还没过期就在原到期时间上顺延，过期了/新开通就从现在算起
function grantMembership(user, days) {
  const now = Date.now();
  const base = (user.memberUntil && user.memberUntil > now) ? user.memberUntil : now;
  user.isMember = true;
  if (!user.memberSince) user.memberSince = now;
  user.memberUntil = base + days * 24 * 60 * 60 * 1000;
}

// 旧版前端（浏览器缓存了改版前的 app.js）还会调这个接口。直接删掉会返回404的HTML页面，
// 前端按JSON解析失败只能提示"请求失败"，用户完全不知道发生了什么。这里保留做兼容：
// 未接支付时沿用原来的免费开通行为；已接支付后不能白送，明确提示刷新页面拿新版前端。
app.post('/api/membership/upgrade', requireAuth, (req, res) => {
  if (payEnabled()) {
    return res.status(409).json({ error: '页面版本过旧，请刷新页面（Ctrl+Shift+R）后重新开通' });
  }
  const db = loadDB();
  const user = db.users[req.session.userId];
  grantMembership(user, MEMBER_PLANS.monthly.days);
  saveDB(db);
  res.json({ user: publicUser(user) });
});

app.get('/api/membership/plans', (req, res) => {
  res.json({
    payEnabled: payEnabled(),
    plans: Object.entries(MEMBER_PLANS).map(([id, p]) => ({ id, name: p.name, days: p.days, price: p.price })),
  });
});

// 创建订单：返回一个跳转URL，前端直接把用户送到收银台完成微信/支付宝付款
app.post('/api/membership/create-order', requireAuth, rateLimit(10), (req, res) => {
  const { plan, payType } = req.body || {};
  const conf = MEMBER_PLANS[plan];
  if (!conf) return res.status(400).json({ error: '套餐不存在' });
  if (!['alipay', 'wxpay'].includes(payType)) return res.status(400).json({ error: '请选择支付方式' });

  const db = loadDB();
  const user = db.users[req.session.userId];

  // 未接入支付时保持原来的"演示版免费开通"行为，方便本地和演示环境继续用
  if (!payEnabled()) {
    grantMembership(user, conf.days);
    saveDB(db);
    return res.json({ demo: true, user: publicUser(user) });
  }

  const outTradeNo = newOrderNo();
  if (!db.orders) db.orders = {};
  db.orders[outTradeNo] = {
    outTradeNo,
    username: user.username,
    plan,
    days: conf.days,
    money: conf.price,
    payType,
    status: 'pending',
    createdAt: Date.now(),
  };
  saveDB(db);

  const params = {
    pid: ZPAY_PID,
    type: payType,
    out_trade_no: outTradeNo,
    notify_url: `${SITE_URL}/api/membership/notify`,
    return_url: `${SITE_URL}/api/membership/return`,
    name: conf.name,
    money: conf.price,
    sitename: 'LangBuddy 语伴',
  };
  params.sign = zpaySign(params);
  params.sign_type = 'MD5';

  const payUrl = `${ZPAY_GATEWAY}/submit.php?` +
    Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  res.json({ payUrl, outTradeNo });
});

// 支付平台异步回调：这是真正给用户开通会员的地方（前端跳转回来那条路不可信，可能被伪造）
function handlePayNotify(req, res) {
  const data = { ...req.query, ...req.body };
  if (!payEnabled()) return res.send('fail');

  const expect = zpaySign(data);
  if (expect !== data.sign) {
    console.warn('[ZPay] 回调签名校验失败', data.out_trade_no);
    return res.send('fail');
  }
  if (data.trade_status !== 'TRADE_SUCCESS') return res.send('success'); // 非成功状态直接确认收到，不处理

  const db = loadDB();
  const order = db.orders?.[data.out_trade_no];
  if (!order) {
    console.warn('[ZPay] 回调里的订单号不存在', data.out_trade_no);
    return res.send('fail');
  }
  // 平台可能重复推送同一笔通知，已处理过的直接确认，避免重复加时长
  if (order.status === 'paid') return res.send('success');
  // 金额必须和下单时一致，防止有人改价格
  if (String(data.money) !== String(order.money)) {
    console.warn('[ZPay] 回调金额与订单不符', data.out_trade_no, data.money, order.money);
    return res.send('fail');
  }

  const user = db.users[order.username];
  if (!user) return res.send('fail');

  grantMembership(user, order.days);
  order.status = 'paid';
  order.paidAt = Date.now();
  order.tradeNo = data.trade_no || '';
  saveDB(db);
  console.log(`[ZPay] 支付成功 ${order.username} ${order.plan} ¥${order.money}`);
  res.send('success');
}
app.get('/api/membership/notify', handlePayNotify);
app.post('/api/membership/notify', handlePayNotify);

// 用户付完款后浏览器跳回来的地址：只负责把人送回网站，不在这里开通会员
app.get('/api/membership/return', (req, res) => {
  res.redirect('/?pay=done');
});

// 前端轮询这个接口确认到账（异步回调可能比用户跳回来稍慢几秒）
app.get('/api/membership/order-status', requireAuth, (req, res) => {
  const db = loadDB();
  const order = db.orders?.[req.query.outTradeNo];
  if (!order || order.username !== req.session.userId) return res.status(404).json({ error: '订单不存在' });
  res.json({ status: order.status, user: publicUser(db.users[req.session.userId]) });
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
6. 极其重要：无论历史对话中出现过什么语言，你自己的每一句回复都必须整体用${replyLangName}书写（括号里的简短提示除外）。${sameLang ? '' : `绝不能整句改用${inputLangName}回复。`}`;

  // 输入语言和回复语言相同时（比如都选英语），原来那句"不要用X回复整句话"会和
  // "必须用X回复"直接矛盾，模型会困惑甚至把纠结过程输出出来。这种情况下不加这半句。
  const languageReminder = sameLang
    ? `（提醒：请用${replyLangName}回复）`
    : `（提醒：接下来请只用${replyLangName}回复，不要用${inputLangName}回复整句话）`;

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

// ==================== 数字人实时视频对话（Tavus） ====================
// 计费口径：Tavus 按会话实际时长收费，每次最低计 30 秒。所以"会话必须被关掉"是这里
// 最重要的事——用户直接关浏览器不会触发任何前端代码，靠三道保险兜着：
//   1) max_call_duration：Tavus 侧硬性掐断
//   2) participant_left_timeout / participant_absent_timeout：人走了自动关
//   3) settleAvatarSession：用户下次请求时结算上一场没正常结束的会话，防止白嫖额度

function monthKey(d) { return d.toISOString().slice(0, 7); }

async function tavusFetch(pathname, options = {}) {
  const resp = await fetch(TAVUS_BASE_URL + pathname, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-api-key': TAVUS_API_KEY, ...(options.headers || {}) },
  });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非JSON响应按原文报错 */ }
  if (!resp.ok) {
    const err = new Error((data && (data.message || data.error)) || text || `Tavus 请求失败(${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

// 把上一场会话的用量落账。用户正常点结束会走这里；异常退出（关浏览器/断网）则等他
// 下次进来时补记，按"已过去的时间"和单次上限取小值，避免一场没关的会话吃掉整月额度。
function settleAvatarSession(user) {
  const u = user.avatarUsage;
  if (!u || !u.active) return;
  const elapsed = Math.min(Math.round((Date.now() - u.active.startedAt) / 1000), AVATAR_MAX_CALL_SECONDS);
  const thisMonth = monthKey(new Date());
  if (u.month !== thisMonth) { u.month = thisMonth; u.seconds = 0; }
  u.seconds = (u.seconds || 0) + Math.max(elapsed, 30); // Tavus 每场最低计 30 秒
  u.active = null;
}

function avatarQuota(user) {
  if (!user.avatarUsage) user.avatarUsage = { month: monthKey(new Date()), seconds: 0, active: null };
  const u = user.avatarUsage;
  const thisMonth = monthKey(new Date());
  if (u.month !== thisMonth) { u.month = thisMonth; u.seconds = 0; }
  const limit = AVATAR_MONTHLY_MINUTES * 60;
  return { used: u.seconds || 0, limit, remaining: Math.max(0, limit - (u.seconds || 0)) };
}

app.get('/api/avatar/status', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  if (!avatarEnabled()) return res.json({ enabled: false });
  settleAvatarSession(user);
  const q = avatarQuota(user);
  saveDB(db);
  res.json({
    enabled: true,
    isMember: isActiveMember(user),
    monthlyMinutes: AVATAR_MONTHLY_MINUTES,
    usedSeconds: q.used,
    remainingSeconds: q.remaining,
    maxCallSeconds: AVATAR_MAX_CALL_SECONDS,
  });
});

app.post('/api/avatar/conversation', requireMember, rateLimit(6), async (req, res) => {
  if (!avatarEnabled()) return res.status(503).json({ error: '数字人功能尚未开启' });
  const db = loadDB();
  const user = db.users[req.session.userId];

  settleAvatarSession(user);
  const q = avatarQuota(user);
  if (q.remaining <= 0) {
    saveDB(db);
    return res.status(403).json({ error: `本月数字人对话额度（${AVATAR_MONTHLY_MINUTES}分钟）已用完，下月1日重置` });
  }

  const replyLangName = LANG_NAME[user.targetLang] || '英语';
  const levelZh = LEVEL_ZH[user.level] || '初级';
  const context = `你是一位耐心友好的${replyLangName}私教，正在和一位${levelZh}水平的中国学生做面对面口语练习。
请全程使用${replyLangName}交流，难度贴合${levelZh}水平。学生说错时先温和纠正再继续话题。
每次回应简短自然（不超过60个词），多用提问引导学生开口，不要长篇讲课。
学生的昵称是${user.nickname || user.username}。`;

  // 单次时长取"本月剩余"和"单次上限"的小值，防止一场就把剩余额度全部吃掉还超支
  const callSeconds = Math.max(60, Math.min(AVATAR_MAX_CALL_SECONDS, q.remaining));

  try {
    const data = await tavusFetch('/conversations', {
      method: 'POST',
      body: JSON.stringify({
        face_id: TAVUS_FACE_ID,
        ...(TAVUS_PAL_ID ? { pal_id: TAVUS_PAL_ID } : {}),
        conversation_name: `LangBuddy-${user.username}`,
        conversational_context: context,
        properties: {
          max_call_duration: callSeconds,
          participant_left_timeout: 30,  // 人走了30秒就关，别空转烧钱
          participant_absent_timeout: 90, // 创建后90秒没人进来直接关
          enable_recording: false,
          enable_closed_captions: true,
        },
      }),
    });
    user.avatarUsage.active = { conversationId: data.conversation_id, startedAt: Date.now() };
    saveDB(db);
    res.json({
      conversationUrl: data.conversation_url,
      conversationId: data.conversation_id,
      maxSeconds: callSeconds,
      remainingSeconds: q.remaining,
    });
  } catch (e) {
    console.error('创建数字人会话失败:', e.message);
    res.status(502).json({ error: '数字人服务暂时不可用，请稍后再试（也可以继续用文字/语音对话）' });
  }
});

app.post('/api/avatar/end', requireAuth, async (req, res) => {
  const db = loadDB();
  const user = db.users[req.session.userId];
  const active = user.avatarUsage && user.avatarUsage.active;
  settleAvatarSession(user);
  saveDB(db);
  // 先把用量记下来再去关远端会话：就算 Tavus 这一步失败，额度也不会漏记
  if (active && avatarEnabled()) {
    try { await tavusFetch(`/conversations/${active.conversationId}/end`, { method: 'POST' }); }
    catch (e) { console.error('结束数字人会话失败:', e.message); }
  }
  res.json({ ok: true, ...avatarQuota(user) });
});

// ==================== 语法 AI 批改 ====================

app.post('/api/grammar/check', allowMemberOrFreeQuota('grammar', { type: 'count', max: 3 }), rateLimit(15), async (req, res) => {
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

app.post('/api/essay/check', allowMemberOrFreeQuota('essay', { type: 'count', max: 3 }), rateLimit(8), async (req, res) => {
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

// ---- 词根关联（用于"词根星球"可视化） ----
// 纯语法后缀（-tion/-ing/-able 之类）对记忆没有联想价值，谁都能带，会把不相干的词硬凑到一起，
// 这里全部排除，只保留真正有语义的词根/前缀（spect看、port搬、dict说……）
const AFFIX_STOPLIST = new Set([
  'ion', 'ation', 'ate', 'ity', 'ism', 'able', 'ible', 'ing', 'ment', 'ent', 'ant',
  'ize', 'ise', 'ous', 'ive', 'ful', 'less', 'ness', 'ly', 'er', 'or', 'ist', 'al',
  'ial', 'ic', 'ical', 'ary', 'ory', 'age', 'ance', 'ence', 'tion', 'sion', 'ship',
  'hood', 'dom', 'ted', 'est', 'ify', 'fy', 'eous', 'ious', 'uous', 'ative', 'ual', 'ure',
]);

function parseRootParts(rootStr) {
  if (!rootStr) return [];
  return rootStr.split('+').map(part => {
    const m = part.trim().match(/^([A-Za-z()\-]+)/);
    if (!m) return null;
    return m[1].replace(/[()\-]/g, '').toLowerCase();
  }).filter(r => r && r.length >= 3 && !AFFIX_STOPLIST.has(r));
}

let rootIndexCache = null;
function getRootIndex(vocab) {
  if (rootIndexCache) return rootIndexCache;
  const index = new Map();
  vocab.forEach(w => {
    parseRootParts(w.root).forEach(r => {
      if (!index.has(r)) index.set(r, []);
      index.get(r).push(w.word);
    });
  });
  rootIndexCache = index;
  return index;
}

app.get('/api/vocab/related', requireAuth, (req, res) => {
  const { word } = req.query;
  if (!word) return res.status(400).json({ error: '缺少单词' });
  const vocab = readVocab();
  const center = vocab.find(w => w.word.toLowerCase() === String(word).toLowerCase());
  if (!center) return res.status(404).json({ error: '词库中没有这个单词' });

  const rootIndex = getRootIndex(vocab);
  const byWord = new Map(vocab.map(w => [w.word, w]));
  const picked = new Map(); // word -> { ...entry, relation, via }

  // 优先用"越少见越具体"的词根匹配：spect(看) 这种比 con- 这种泛前缀联想价值高得多
  const roots = parseRootParts(center.root)
    .map(r => ({ root: r, mates: rootIndex.get(r) || [] }))
    .filter(x => x.mates.length > 1)
    .sort((a, b) => a.mates.length - b.mates.length);

  for (const { root, mates } of roots) {
    for (const mate of mates) {
      if (picked.size >= 18) break;
      if (mate === center.word || picked.has(mate)) continue;
      const entry = byWord.get(mate);
      if (!entry) continue;
      picked.set(mate, { ...entry, relation: 'root', via: root });
    }
  }

  // 词根凑不够就用同主题分类补齐，保证球体不会太空
  if (picked.size < 16 && center.category) {
    for (const w of vocab) {
      if (picked.size >= 16) break;
      if (w.word === center.word || picked.has(w.word)) continue;
      if (w.category !== center.category) continue;
      picked.set(w.word, { ...w, relation: 'category', via: center.category });
    }
  }

  res.json({ center, related: Array.from(picked.values()) });
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
// 取用户真实公网IP。站点前面挂了 Cloudflare（橙云代理），链路是 用户->Cloudflare->Render->应用，
// 这时 Express 的 req.ip 拿到的往往是中转节点的IP而不是用户的。Cloudflare 会把真实访客IP
// 放在 CF-Connecting-IP 头里，所以优先读它；其次读 X-Real-IP；再退回 X-Forwarded-For 的第一段
// （最左边才是原始客户端，右边都是各级代理）；最后才用 req.ip 兜底。
function getClientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return normalizeIp(cf);
  const real = req.headers['x-real-ip'];
  if (real) return normalizeIp(real);
  const xff = req.headers['x-forwarded-for'];
  if (xff) return normalizeIp(String(xff).split(',')[0].trim());
  return normalizeIp(req.ip);
}

// 用免费的 ip-api.com 查归属地（无需 key，个人/小流量用途够用），查询失败不影响注册本身。
// 返回结构化字段，方便后台按省/市分别统计，同时带上运营商和"是否代理/VPN"用于识别异常注册。
async function lookupIpRegion(ip) {
  const clean = normalizeIp(ip);
  if (isPrivateIp(clean)) {
    return { text: '本地/内网', country: '', province: '', city: '', district: '', isp: '', proxy: false };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const fields = 'status,country,regionName,city,district,isp,proxy,mobile';
    const resp = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=${fields}&lang=zh-CN`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const d = await resp.json();
    if (d.status !== 'success') {
      return { text: '未知', country: '', province: '', city: '', district: '', isp: '', proxy: false };
    }
    return {
      text: [d.country, d.regionName, d.city, d.district].filter(Boolean).join(' ') || '未知',
      country: d.country || '',
      province: d.regionName || '',
      city: d.city || '',
      district: d.district || '',
      isp: d.isp || '',
      proxy: !!d.proxy,
      mobile: !!d.mobile,
    };
  } catch {
    return { text: '未知', country: '', province: '', city: '', district: '', isp: '', proxy: false };
  }
}

// 注册成功后异步查归属地，不阻塞注册响应；查到了再补写回用户记录
function fillRegistrationRegion(username, ip) {
  lookupIpRegion(ip).then(geo => {
    const db = loadDB();
    const u = db.users[username];
    if (!u) return;
    u.registrationRegion = geo.text;
    u.registrationGeo = geo;
    saveDB(db);
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
    isMember: isActiveMember(user),
  });
});

// ==================== 语法课程 ====================

function readGrammar() {
  return JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf-8'));
}

app.get('/api/grammar/list', requireAuth, (req, res) => {
  const grammar = readGrammar();
  // level 用于前端按 基础/进阶/高级 分组；老数据没有这个字段时统一归到基础
  res.json({ lessons: grammar.map(g => ({ id: g.id, title: g.title, summary: g.summary, level: g.level || 'basic' })) });
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

app.post('/api/mistakes/upload', allowMemberOrFreeQuota('mistake', { type: 'count', max: 3 }), rateLimit(6), mistakeUpload.single('image'), async (req, res) => {
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
app.post('/api/mistakes/submit-text', allowMemberOrFreeQuota('mistake', { type: 'count', max: 3 }), rateLimit(15), async (req, res) => {
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
    if (isActiveMember(u)) totalMembers++;
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

  const canSeeIp = isSuperAdminName(req.session.userId);
  res.json({
    totalUsers: users.length,
    totalMembers,
    totalMistakes,
    totalChats,
    totalVocabMastered,
    vocabBankSize: vocab.length,
    newUsersToday,
    newUsersThisWeek,
    canSeeIp,
    // 地区分布同样只给超级管理员看
    regionBreakdown: canSeeIp ? regionBreakdown : [],
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const db = loadDB();
  const vocab = readVocab();
  // 公网IP和归属地属于敏感信息，只有超级管理员能看到；普通管理员拿到的响应里根本没有这些字段，
  // 不是靠前端隐藏（前端隐藏拦不住直接调接口的人）
  const canSeeIp = isSuperAdminName(req.session.userId);
  const users = Object.values(db.users || {}).map(u => {
    const vocabStats = computeStats(vocab, u.vocabProgress || {});
    const row = {
      username: u.username,
      nickname: u.nickname,
      isMember: isActiveMember(u),
      memberSince: u.memberSince,
      memberUntil: u.memberUntil || null,
      createdAt: u.createdAt,
      level: u.level,
      targetLang: u.targetLang,
      vocabMastered: vocabStats.known,
      vocabLearning: vocabStats.learning,
      mistakesTotal: (u.mistakes || []).length,
      chatCount: u.chatCount || 0,
      streakDays: computeStreak(u.activityLog),
    };
    if (canSeeIp) {
      const geo = u.registrationGeo || {};
      row.registrationIp = u.registrationIp || '-';
      row.registrationRegion = u.registrationRegion || '未知';
      row.regProvince = geo.province || '';
      row.regCity = geo.city || '';
      row.regDistrict = geo.district || '';
      row.regIsp = geo.isp || '';
      row.regProxy = !!geo.proxy;
      // 登录/登出时间同属敏感信息，只给超级管理员
      row.lastLoginAt = u.lastLoginAt || null;
      row.lastLogoutAt = u.lastLogoutAt || null;
      row.loginCount = (u.authLog || []).filter(e => e.type === 'login').length;
    }
    return row;
  }).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ users, canSeeIp });
});

// 某个用户的完整登录/登出记录，只有超级管理员能看
app.get('/api/admin/users/:username/auth-log', requireSuperAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users[req.params.username];
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({
    username: user.username,
    // 最近的排前面，方便直接看最新动向
    log: (user.authLog || []).slice().reverse(),
  });
});

// 管理员手动创建账号：常用于给测试/线下沟通好的用户直接开号，跳过手机验证门槛
// （管理员已经人工核实过，不需要再走一遍防刷验证）
app.post('/api/admin/users', requireSuperAdmin, async (req, res) => {
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
  if (isMember) {
    if (!user.memberSince) user.memberSince = Date.now();
    user.memberUntil = null; // 管理员手动开通视为不限期，避免被已过期的旧到期时间立刻judge成非会员
  }
  saveDB(db);
  res.json({ ok: true });
});

// 管理员重置用户密码：用户忘记密码时的人工支持手段
app.post('/api/admin/users/:username/reset-password', requireSuperAdmin, async (req, res) => {
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
app.delete('/api/admin/users/:username', requireSuperAdmin, (req, res) => {
  const { username } = req.params;
  // 两个管理员账号都不允许被删掉，避免误操作把后台权限彻底删没了
  if (isAdminName(username)) {
    return res.status(400).json({ error: '不能删除管理员账号' });
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

// 没匹配到任何接口的 /api 请求统一返回 JSON。默认的404是HTML页面，前端按JSON解析会直接抛异常，
// 用户只能看到含糊的"请求失败"——旧版缓存前端调用已下线接口时就是这种情况，这里给出明确提示。
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在，可能是页面版本过旧，请刷新页面（Ctrl+Shift+R）后重试' });
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
