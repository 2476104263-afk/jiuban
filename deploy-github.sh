#!/usr/bin/env bash
#
# 久伴 · 一键推送到 GitHub（之后 GitHub Pages 会自动更新）
#
# 第一次使用：
#   1. 在 GitHub 新建一个 Public 仓库（不要勾选初始化 README）
#   2. 运行：
#        ./deploy-github.sh https://github.com/你的用户名/仓库名.git
#
# 之后每次更新：
#   ./deploy-github.sh
#   （脚本会沿用上次的 origin）
#
set -euo pipefail
cd "$(dirname "$0")"

if [ "$#" -ge 1 ]; then
  REPO_URL="$1"
elif git remote get-url origin >/dev/null 2>&1; then
  REPO_URL="$(git remote get-url origin)"
else
  echo "用法: ./deploy-github.sh https://github.com/<用户名>/<仓库名>.git" >&2
  exit 1
fi

if [ ! -d .git ]; then
  git init -q
fi

git add -A
if git diff --cached --quiet; then
  echo "没有新的改动需要提交。"
else
  git commit -q -m "更新：$(date '+%Y-%m-%d %H:%M:%S')"
  echo "已提交本地改动。"
fi

git branch -M main
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$REPO_URL"
elif [ "$(git remote get-url origin)" != "$REPO_URL" ]; then
  git remote set-url origin "$REPO_URL"
fi

git push -u origin main
echo ""
echo "推送完成 ✅"
echo "如果这是第一次推送，请到 GitHub 仓库的 Settings → Pages 里："
echo "  Source 选择 Deploy from a branch"
echo "  Branch 选择 main，目录选择 / (root)，然后 Save"
echo "大约 1 分钟后访问：https://<你的用户名>.github.io/<仓库名>/"
