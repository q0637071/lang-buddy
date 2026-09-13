#!/usr/bin/env node
//
// 列出你 Tavus 账号里能用的数字人形象，并直接生成可以粘到 Render 的环境变量。
//
// 用法（密钥从环境变量读，不要写进命令行历史）：
//   TAVUS_API_KEY=你的key node scripts/tavus-faces.js
// 或者本地 .env 里已经配了 TAVUS_API_KEY 的话：
//   node scripts/tavus-faces.js
//
// 只做 GET，不会改你账号里的任何东西。

try { require('dotenv').config(); } catch { /* 没装 dotenv 也能用，从环境变量读 */ }

const KEY = process.env.TAVUS_API_KEY || process.argv[2] || '';
if (!KEY) {
  console.error('缺少 TAVUS_API_KEY。用法：TAVUS_API_KEY=你的key node scripts/tavus-faces.js');
  process.exit(1);
}

// Tavus 把 replica 改名成了 face（我们发起通话用的就是 face_id），
// 但账号里旧的列表接口可能还在。两个都试一遍，谁能返回就用谁。
const ENDPOINTS = ['/v2/faces', '/v2/replicas'];

// 不同版本的字段名不一样，挨个找；找不到就把原始对象打出来让人自己看
const pick = (o, keys) => keys.map(k => o[k]).find(v => typeof v === 'string' && v);
const idOf = o => pick(o, ['face_id', 'replica_id', 'id', 'uuid']);
const nameOf = o => pick(o, ['face_name', 'replica_name', 'name', 'title']) || '(未命名)';
const statusOf = o => pick(o, ['status', 'training_status', 'state']) || '';
const kindOf = o => pick(o, ['replica_type', 'face_type', 'type', 'category']) || '';

/// 响应可能是数组，也可能包在 data / faces / replicas 里
function listFrom(json) {
  if (Array.isArray(json)) return json;
  for (const k of ['data', 'faces', 'replicas', 'items', 'results']) {
    if (Array.isArray(json?.[k])) return json[k];
  }
  return null;
}

async function tryEndpoint(path) {
  const res = await fetch('https://tavusapi.com' + path, {
    headers: { 'x-api-key': KEY },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 不是 JSON */ }
  return { path, status: res.status, json, text };
}

(async () => {
  let hit = null;
  for (const p of ENDPOINTS) {
    const r = await tryEndpoint(p);
    console.log(`  GET ${p} → HTTP ${r.status}`);
    if (r.status === 401 || r.status === 403) {
      console.error('\n  密钥不对或没有权限。到 Tavus 后台重新复制 API Key 再试。');
      process.exit(1);
    }
    if (r.status === 200 && listFrom(r.json)) { hit = r; break; }
  }

  if (!hit) {
    console.error('\n  两个接口都没拿到列表。把上面的 HTTP 状态发我，我再看。');
    process.exit(1);
  }

  const list = listFrom(hit.json);
  console.log(`\n  账号里共有 ${list.length} 个形象：\n`);
  if (!list.length) {
    console.log('  一个都没有。到 Tavus 后台的形象库里挑几个 Stock Replica 加到账号，再跑一次。');
    return;
  }

  const ready = [];
  for (const o of list) {
    const id = idOf(o);
    if (!id) {   // 字段名对不上就把原始对象打出来，别假装读懂了
      console.log('  ⚠️ 这条认不出 id，原始内容：', JSON.stringify(o).slice(0, 200));
      continue;
    }
    const st = statusOf(o);
    const usable = !st || /ready|completed|active/i.test(st);
    console.log(`  ${usable ? '✅' : '⏳'} ${id}   ${nameOf(o)}${kindOf(o) ? '  [' + kindOf(o) + ']' : ''}${st ? '  status=' + st : ''}`);
    if (usable) ready.push({ id, name: nameOf(o) });
  }

  // data/personas.json 里的六个人设，顺序就是 App 里显示的顺序
  let personas = [];
  try {
    personas = require('../data/personas.json').personas;
  } catch { /* 读不到就只列形象 */ }

  if (ready.length && personas.length) {
    console.log('\n  ── 可以直接粘到 Render 环境变量 ──');
    console.log('  （按顺序配对的，想换谁用哪张脸自己调整；不配的人设会用默认 TAVUS_FACE_ID）\n');
    personas.forEach((p, i) => {
      const face = ready[i % ready.length];
      const key = p.id.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      console.log(`  TAVUS_FACE_${key}=${face.id}     # ${p.name} ${p.title} → ${face.name}`);
    });
    if (ready.length < personas.length) {
      console.log(`\n  注意：只有 ${ready.length} 个可用形象、却有 ${personas.length} 位老师，`);
      console.log('  上面是循环配对的，会有几位长得一样。要各不相同就去 Tavus 再加几个 Stock Replica。');
    }
  }
})();
