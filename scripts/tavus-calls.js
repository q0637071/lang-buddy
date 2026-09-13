#!/usr/bin/env node
//
// 列出 Tavus 账号里的通话记录，告诉你每一通是谁打的。
//
// 我们建房间时会把用户名写进房间名（server.js: conversation_name = `LangBuddy-<用户名>`），
// 所以看名字就能认出人。不是 LangBuddy- 开头的，就不是这个网站发起的
// ——可能是你自己在 Tavus 后台点的测试，或者同一个 API Key 被别处用了。
//
// 用法：
//   TAVUS_API_KEY=你的key node scripts/tavus-calls.js
//
// 只做 GET，不会挂断任何通话、也不改账号里的东西。

try { require('dotenv').config(); } catch {}

const KEY = process.env.TAVUS_API_KEY || process.argv[2] || '';
if (!KEY) {
  console.error('缺少 TAVUS_API_KEY。用法：TAVUS_API_KEY=你的key node scripts/tavus-calls.js');
  process.exit(1);
}

const pick = (o, keys) => keys.map(k => o[k]).find(v => typeof v === 'string' && v);
const idOf = o => pick(o, ['conversation_id', 'id', 'uuid']) || '(无 id)';
const nameOf = o => pick(o, ['conversation_name', 'name', 'title']) || '';
const statusOf = o => (pick(o, ['status', 'state']) || '').toLowerCase();
const createdOf = o => pick(o, ['created_at', 'createdAt', 'created', 'start_time']) || '';

function listFrom(json) {
  if (Array.isArray(json)) return json;
  for (const k of ['data', 'conversations', 'items', 'results']) {
    if (Array.isArray(json?.[k])) return json[k];
  }
  return null;
}

function ago(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return m + ' 分钟前';
  if (m < 1440) return Math.round(m / 60) + ' 小时前';
  return Math.round(m / 1440) + ' 天前';
}

(async () => {
  const res = await fetch('https://tavusapi.com/v2/conversations', {
    headers: { 'x-api-key': KEY },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  console.log(`  GET /v2/conversations → HTTP ${res.status}\n`);

  if (res.status === 401 || res.status === 403) {
    console.error('  密钥不对或没权限。到 Tavus 后台重新复制 API Key。');
    process.exit(1);
  }
  const list = listFrom(json);
  if (!list) {
    console.error('  没拿到列表。原始响应前 300 字：\n  ' + text.slice(0, 300));
    process.exit(1);
  }
  if (!list.length) {
    console.log('  一条通话记录都没有。');
    return;
  }

  // 进行中的排前面，其余按时间倒序
  const live = o => /active|in_?progress|joined|started/.test(statusOf(o));
  list.sort((a, b) => (live(b) ? 1 : 0) - (live(a) ? 1 : 0)
    || (Date.parse(createdOf(b)) || 0) - (Date.parse(createdOf(a)) || 0));

  const ours = [], foreign = [];
  for (const o of list) {
    const n = nameOf(o);
    (n.startsWith('LangBuddy-') ? ours : foreign).push(o);
  }

  const show = o => {
    const n = nameOf(o);
    const who = n.startsWith('LangBuddy-') ? n.slice('LangBuddy-'.length) : (n || '(无名字)');
    const c = createdOf(o);
    console.log(`  ${live(o) ? '🔴 进行中' : '   已结束'}  ${who.padEnd(18)} ${statusOf(o).padEnd(12)} ${c ? ago(c) : ''}  ${idOf(o)}`);
  };

  console.log(`  ── 本站发起的（${ours.length} 条）──`);
  console.log('  状态        用户名              status       创建时间     conversation_id');
  ours.forEach(show);

  if (foreign.length) {
    console.log(`\n  ⚠️ ── 不是本站发起的（${foreign.length} 条）──`);
    console.log('  这些房间名不以 LangBuddy- 开头。可能是你自己在 Tavus 后台点的测试通话，');
    console.log('  或者同一个 API Key 被别的地方用了。如果都不是，把 Key 换掉。');
    foreign.forEach(show);
  }

  const liveCount = list.filter(live).length;
  console.log(`\n  进行中的通话：${liveCount} 通`);
  if (liveCount > 0) {
    console.log('  （每通都在按分钟计费。如果是没正常关掉的僵尸会话，去 Tavus 后台手动结束）');
  }
})();
