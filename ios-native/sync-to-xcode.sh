#!/bin/bash
#
# 把仓库里的 Swift 源码同步到 Xcode 工程目录。
#
# 为什么需要这个：Xcode 工程里的 .swift 是**复制**进去的，不是引用仓库文件，
# 所以 git pull 之后 Xcode 编译的还是旧副本 —— 表现是一堆
# "Cannot find type 'X' in scope" / "has no member 'y'"，很容易误判成代码写错了。
#
# 用法（在仓库任意位置）：
#   ./ios-native/sync-to-xcode.sh
#
# 工程路径不一样的话用环境变量覆盖：
#   XCODE_SRC=~/somewhere/LangBuddy/LangBuddy ./ios-native/sync-to-xcode.sh

# 不用 set -u：macOS 自带的还是 bash 3.2，空数组展开会直接报 unbound variable
set -eo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/ios-native/LangBuddy"
DST="${XCODE_SRC:-$HOME/Desktop/new_app/LangBuddy/LangBuddy}"

echo "仓库    : $REPO"
echo "Xcode   : $DST"
echo

if [ ! -d "$DST" ]; then
  echo "❌ 找不到 Xcode 工程源码目录：$DST"
  echo "   用 XCODE_SRC=... 指定，例如："
  echo "   XCODE_SRC=~/Desktop/new_app/LangBuddy/LangBuddy $0"
  exit 1
fi

# ---- 1. 拉最新代码 ----
cd "$REPO"
before="$(git rev-parse HEAD)"
git pull --ff-only
after="$(git rev-parse HEAD)"

if [ "$before" = "$after" ]; then
  echo "· 代码已是最新（$(git log --oneline -1)）"
else
  echo "· 更新到 $(git log --oneline -1)"
fi
echo

# ---- 2. 找出新增文件（拷贝之前先记下来）----
# 新增的文件光拷贝不够，Xcode 不认识它，必须手动拖进去才会加入 target
new_files=""
new_count=0
for f in "$SRC"/*.swift; do
  [ -e "$f" ] || continue
  if [ ! -e "$DST/$(basename "$f")" ]; then
    new_files="$new_files$(basename "$f")
"
    new_count=$((new_count + 1))
  fi
done

# ---- 3. 拷贝 ----
cp "$SRC"/*.swift "$DST"/
echo "· 已同步 $(ls -1 "$SRC"/*.swift | wc -l | tr -d ' ') 个 .swift 到 Xcode 工程"
echo

# ---- 4. 副本检查 ----
# 用 Add Files 时勾了 "Copy items if needed" 会生成 "OrbitView 2.swift" 这种副本，
# 报 Invalid redeclaration，踩过两次
dupes="$(find "$DST" -maxdepth 1 -name '* [0-9].swift' -print 2>/dev/null || true)"
if [ -n "$dupes" ]; then
  echo "⚠️  工程目录里有重复副本，会报 Invalid redeclaration，删掉这些："
  echo "$dupes" | sed 's/^/     /'
  echo "     （Xcode 里也要把对应条目 Delete → Move to Trash）"
  echo
fi

# ---- 5. 游离引用检查 ----
# 如果某个文件是从仓库目录拖进 Xcode 的，它的引用就指在仓库里，
# 以后这个脚本同步不到它 —— 表现是"改了没生效"，很难查
proj="$(dirname "$DST")"/*.xcodeproj/project.pbxproj
if compgen -G "$proj" > /dev/null; then
  stray="$(grep -o 'path = [^;]*ios-native[^;]*;' $proj 2>/dev/null || true)"
  if [ -n "$stray" ]; then
    echo "⚠️  Xcode 里有文件引用指向仓库目录（不是工程目录），这个脚本同步不到它："
    echo "$stray" | sed 's/^/     /'
    echo "     修法：Xcode 里右键该文件 → Delete → 选 Remove Reference（不要 Move to Trash），"
    echo "           再从 $DST 重新拖进去，Copy items 不要勾。"
    echo
  fi
fi

# ---- 6. 收尾提示 ----
if [ "$new_count" -gt 0 ]; then
  echo "🔴 有 $new_count 个新文件，光拷贝不够，必须手动拖进 Xcode 才会参与编译："
  printf '%s' "$new_files" | sed 's/^/     /'
  echo
  echo "   访达打开：open \"$DST\""
  echo "   把上面的文件拖到 Xcode 左侧文件列表，弹窗里："
  echo "     · Copy items if needed  → 不要勾（文件已经在工程目录里了）"
  echo "     · Add to targets        → 勾上 LangBuddy"
else
  echo "✅ 没有新文件，直接在 Xcode 里 Cmd+Shift+K 清一下再 Run 就行"
fi
