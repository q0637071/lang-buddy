// Windows 上没有 Swift 工具链，编译不了，只能做静态自查。
// 这里收的都是实际在 Xcode 里撞到过的错误——每踩一次就补一条，避免重复犯。
//
// 用法: node scripts/check-swift.js

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'ios-native', 'LangBuddy');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.swift'));
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]));
const issues = [];

for (const [f, s] of Object.entries(src)) {
  // 括号配平：最容易出、也最容易一眼看不出来的
  const ob = (s.match(/\{/g) || []).length, cb = (s.match(/\}/g) || []).length;
  if (ob !== cb) issues.push(`${f} 花括号不配平 {${ob} }${cb}`);
  const op = (s.match(/\(/g) || []).length, cp = (s.match(/\)/g) || []).length;
  if (op !== cp) issues.push(`${f} 圆括号不配平 (${op} )${cp}`);

  // 撞过两次：ObservableObject / @Published 定义在 Combine，
  // 新版 Xcode 不再通过 SwiftUI 隐式导出，不显式 import 就报
  // "does not conform to protocol" 和 "init(wrappedValue:) is not available"
  const usesCombine = /ObservableObject|@Published/.test(s);
  if (usesCombine && !/^import Combine$/m.test(s)) {
    issues.push(`${f} 用了 ObservableObject/@Published 但没有 import Combine`);
  }

  // 撞过一次：视图里引用了 AVFoundation 的类型却没 import，报
  // "not available due to missing import of defining module 'AVFAudio'"。
  // 这类依赖本就不该漏到 UI 层，所以报出来是提醒去封装，而不是去补 import。
  const usesAV = /\bAV(Audio|Capture|Speech)\w*/.test(s);
  if (usesAV && !/^import AVFoundation$/m.test(s) && !/^import AVFAudio$/m.test(s)) {
    issues.push(`${f} 引用了 AVFoundation 的类型但没 import（考虑改成不暴露 AV 类型）`);
  }

  // actor 的成员从外部访问必须 await
  s.split('\n').forEach((l, i) => {
    if (l.includes('API.shared.') && !l.includes('await')) {
      issues.push(`${f}:${i + 1} 调用 actor 未加 await → ${l.trim().slice(0, 60)}`);
    }
  });
}

// 撞过一次：同一个类型被定义两遍会报 Invalid redeclaration
const declared = {};
for (const [f, s] of Object.entries(src)) {
  for (const m of s.matchAll(/^(?:final )?(?:class |struct |enum )(\w+)/gm)) {
    (declared[m[1]] ||= []).push(f);
  }
}
for (const [name, fs_] of Object.entries(declared)) {
  if (fs_.length > 1) issues.push(`类型 ${name} 在多处定义: ${fs_.join(', ')}`);
}

// route 的每个 case 都要在 RootView 的 switch 和 routeKey 里出现，漏一个编译不过
const state = src['AppState.swift'] || '';
const app = src['LangBuddyApp.swift'] || '';
const cases = [...state.matchAll(/^\s{8}case (\w+)/gm)].map(m => m[1]);
for (const c of cases) {
  if (!app.includes(`case .${c}`)) issues.push(`RootView 的 switch 缺 case .${c}`);
}

if (issues.length) {
  console.log(issues.map(i => '  ⚠️ ' + i).join('\n'));
  process.exit(1);
}
console.log(`  ✅ ${files.length} 个 Swift 文件静态检查通过`);
console.log(`  route 分支: ${cases.join(', ')}`);
