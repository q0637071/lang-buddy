// 列出 Tavus 账号下可用的形象(face)和声音(voice)，用来拿 Render 环境变量需要的 ID。
// 后台页面翻起来麻烦，这个脚本一次全列出来。
//
// 用法（Windows PowerShell）:
//   $env:TAVUS_API_KEY="你的密钥"; node scripts/tavus-list.js
// 用法（Git Bash / Linux / Mac）:
//   TAVUS_API_KEY=你的密钥 node scripts/tavus-list.js

const KEY = process.env.TAVUS_API_KEY;
const BASE = process.env.TAVUS_BASE_URL || 'https://tavusapi.com/v2';

if (!KEY) {
  console.error('❌ 没有设置 TAVUS_API_KEY');
  console.error('   PowerShell: $env:TAVUS_API_KEY="你的密钥"; node scripts/tavus-list.js');
  process.exit(1);
}

async function get(path) {
  const resp = await fetch(BASE + path, { headers: { 'x-api-key': KEY } });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${path} -> HTTP ${resp.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// 各接口返回的包装字段不完全一致，统一取出数组
function items(data) {
  if (Array.isArray(data)) return data;
  for (const k of ['data', 'faces', 'voices', 'pals']) {
    if (Array.isArray(data && data[k])) return data[k];
  }
  return [];
}

function show(title, list, idKeys, nameKeys, envHint) {
  console.log(`\n=== ${title}（${list.length} 个）===`);
  if (!list.length) { console.log('  （空）'); return; }
  for (const it of list) {
    const id = idKeys.map(k => it[k]).find(Boolean) || '(无ID)';
    const name = nameKeys.map(k => it[k]).find(Boolean) || '';
    const status = it.status ? ` [${it.status}]` : '';
    console.log(`  ${id}  ${name}${status}`);
  }
  if (envHint) console.log(`  → 挑一个填到 Render 的 ${envHint}`);
}

(async () => {
  try {
    show('形象 Faces', items(await get('/faces')), ['face_id', 'replica_id', 'id'], ['face_name', 'replica_name', 'name'], 'TAVUS_FACE_ID');
  } catch (e) { console.error('\n❌ 拉取形象失败:', e.message); }

  try {
    show('人设 PALs', items(await get('/pals')), ['pal_id', 'persona_id', 'id'], ['pal_name', 'persona_name', 'name'], 'TAVUS_PAL_ID（可选）');
  } catch (e) { console.error('\n⚠️ 拉取人设失败（可以不配，留空即可）:', e.message); }

  try {
    show('声音 Voices', items(await get('/voices')), ['voice_id', 'id'], ['voice_name', 'name'], null);
  } catch (e) { console.error('\n⚠️ 拉取声音失败:', e.message); }

  console.log('\n提示：TAVUS_FACE_ID 是必填的，没有它数字人功能不会开启。');
})();
