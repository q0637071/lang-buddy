// 一键出安卓包。自动找一个可用的 JDK 再调 gradle，省得每次手动设 JAVA_HOME。
//
// 背景：Android Studio 自带的 JDK 是 25，而 Gradle 8.14 只支持到 Java 24
// （报 "Unsupported class file major version 69"），所以要优先用 JDK 21。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const ANDROID_DIR = path.join(PROJECT_ROOT, 'android');

// 按优先级找 JDK：21 > 17 > 环境变量里已有的
function findJdk() {
  if (process.env.LANGBUDDY_JDK && fs.existsSync(process.env.LANGBUDDY_JDK)) {
    return process.env.LANGBUDDY_JDK;
  }
  const candidates = [];
  const searchDirs = [
    path.join(os.homedir(), 'jdk21'),
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Microsoft',
  ];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.existsSync(path.join(full, 'bin', 'java.exe'))) candidates.push(full);
    }
  }
  // 优先 21，其次 17，都没有就用找到的第一个
  return candidates.find(c => /-?21[.\-+]/.test(c))
    || candidates.find(c => /-?17[.\-+]/.test(c))
    || candidates[0]
    || process.env.JAVA_HOME;
}

const jdk = findJdk();
if (!jdk || !fs.existsSync(path.join(jdk, 'bin', 'java.exe'))) {
  console.error('❌ 没找到可用的 JDK。请安装 JDK 21，或设置环境变量 LANGBUDDY_JDK 指向 JDK 目录。');
  process.exit(1);
}
console.log('使用 JDK:', jdk);

const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
const task = process.argv[2] === 'release' ? 'assembleRelease' : 'assembleDebug';

try {
  // 新版 Node 出于安全考虑不允许直接 spawn .bat/.cmd，必须走 shell。
  // task 是本文件里写死的固定值（assembleDebug/assembleRelease），不来自外部输入，
  // 直接拼进命令串没有注入风险，这样写还能避开 shell:true 传数组参数的弃用告警。
  execSync(`"${path.join(ANDROID_DIR, 'gradlew.bat')}" ${task}`, {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
    env: { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk },
  });
} catch {
  console.error('\n❌ 构建失败，上面是 Gradle 的报错信息');
  process.exit(1);
}

const outDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', task === 'assembleRelease' ? 'release' : 'debug');
const apk = fs.existsSync(outDir) ? fs.readdirSync(outDir).find(f => f.endsWith('.apk')) : null;
if (apk) {
  console.log('\n✅ 安装包已生成：');
  console.log('   ' + path.join(outDir, apk));
  console.log('   把这个文件传到安卓手机上点击安装即可（需允许"安装未知来源应用"）');
}
