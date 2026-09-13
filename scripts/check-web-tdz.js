// 检查：模块顶层有没有在 const 声明之前就调用这些辅助函数。
// 这类错 node --check 查不出来（语法是对的），但会在浏览器里直接把整个脚本打挂。
// 我刚就踩了：$safe('#navMenuBtn') 写在 const $safe 之前 → 页面白屏。
const fs = require('fs');
const lines = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8').split('\n');

const helpers = ['$safe', '$all', '$'];
let bad = 0;

for (const name of helpers) {
  const esc = name.replace(/\$/g, '\\$');
  const declRe = new RegExp('^\\s*const ' + esc + '\\s*=');
  const declAt = lines.findIndex(l => declRe.test(l));
  if (declAt < 0) continue;

  // 顶层语句 = IIFE 内缩进正好两个空格、且不是被 function/if/for 包着的行。
  // 粗略判断够用：真正的函数体里缩进都 >= 4。
  // 判断"行首是非空白"必须用零宽断言，不能用 [^\s] 去消耗那个字符——
  // $safe 开头就是 $，被消耗掉之后后面就再也匹配不到了。这条规则第一版就栽在这，
  // 反向验证（故意把 bug 放回去）才发现它根本没报。
  const useRe = new RegExp('^  (?=\\S).*' + esc + '\\s*\\(');
  for (let i = 0; i < declAt; i++) {
    if (useRe.test(lines[i])) {
      console.log(`  ⚠️ 第 ${i + 1} 行在 ${name} 声明（第 ${declAt + 1} 行）之前就调用了它`);
      console.log('     ' + lines[i].trim().slice(0, 80));
      bad++;
    }
  }
}

console.log(bad ? `  ❌ ${bad} 处 TDZ 风险` : '  ✅ 没有在声明前调用辅助函数的顶层代码');
process.exit(bad ? 1 : 0);
