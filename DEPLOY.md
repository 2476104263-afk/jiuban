# 部署到 GitHub Pages

> 久伴的网页端是**纯静态站点**：原生 HTML + CSS + ES Modules，不需要后端、不需要构建。只要把仓库根目录的文件推到 GitHub，GitHub Pages 就会自动发布。

## 部署状态（已完成）

| 项目 | 内容 |
| --- | --- |
| **在线地址** | <https://2476104263-afk.github.io/jiuban/> |
| **GitHub 仓库** | <https://github.com/2476104263-afk/jiuban> |
| **部署方式** | GitHub Pages → Source = `Deploy from a branch` → 分支 `main` → 目录 `/ (root)` |
| **当前版本** | v1.7.0（2026-11-07 发布） |
| **HTTPS** | 自动开启（`github.io` 域名默认 HTTPS） |
| **发布触发** | 推送到 `main` 后自动重新构建，通常 1～2 分钟生效 |

---

## 一、访问方式

### 1. 在线地址

浏览器打开：

```text
https://2476104263-afk.github.io/jiuban/
```

手机、平板、任何电脑都可以直接访问，不需要安装；页面是相对路径，也支持被部署到任意子路径。

### 2. 首次使用

1. 打开页面，右上角显示「未连接」；
2. 点击「未连接」或左下角钥匙按钮，粘贴自己的 DeepSeek API Key；
3. 点小刷新按钮测试连通，保存后即可真实对话；不填 Key 也能先用「演示模式」。

> API Key 只保存在**访客自己浏览器**的 localStorage 里，不会上传到仓库，也不会经过本站服务器（本站没有服务器）。

### 3. 如果地址打不开

- 确认仓库 Settings → Pages 中 Source 为 `Deploy from a branch`、分支 `main`、目录 `/ (root)`；
- 等待 1～2 分钟后强制刷新（⌘/Ctrl + Shift + R）；
- 仓库页面 → **Actions** → 查看 `pages build and deployment` 是否成功。

---

## 二、日常维护：改完内容后怎么发布

### 一键发布（推荐）

```bash
cd "/Users/linxipan/Desktop/Memora"
./deploy-github.sh
```

脚本会：提交所有改动 → 推送到 `main` → GitHub Pages 自动重新发布。

### 手动发布

```bash
cd "/Users/linxipan/Desktop/Memora"
git add -A
git commit -m "更新说明"
git push
```

### 发布后验证是否生效

1. 等 1～2 分钟，浏览器打开线上地址并按 **⌘/Ctrl + Shift + R** 强制刷新；
2. 打开「设置」→ 底部「关于」应显示 `久伴 v1.7.0`；
3. 按 F12 打开控制台，应看到 `[久伴] v1.7.0 · …`，且没有红色报错。

也可以直接检查线上 HTML 的版本号：

```bash
curl -s https://2476104263-afk.github.io/jiuban/ | grep -o 'v=[0-9.]*' | sort -u
```

### 修改 JS / CSS 后：升级缓存版本号

GitHub Pages 会缓存静态资源，浏览器也会缓存。修改 `assets/` 下的样式或脚本后，需要让 URL 变化才能让所有人拿到新文件：

- `index.html` 里各 `<link>` / `<script>` 的 `?v=…`；
- `assets/js/app.js` 顶部的 `ASSET_VERSION`（聊天、设置、记忆、日记等页面模块都通过它动态 import）；
- `assets/js/chat.js` 里少数 `?v=…` 的动态 import。

把当前版本号统一改成新值（例如 `1.9.8` → `1.9.9`），提交推送后强刷即可。

> 本次部署已经修复了 `assets/js/app.js` 中一个会导致「页面打开后聊天不加载」的启动报错（`tickClock is not defined`），并把界面显示的版本号统一为 v1.7.0。

### 查看发布状态

- 仓库 **Actions** → `pages build and deployment`：最近一次构建是否成功；
- 仓库 **Settings → Pages**：顶部会显示站点地址和最近部署时间；
- 发布失败时点进 Actions 看日志，修好再推一次即可。

### 回滚到旧版本

```bash
git log --oneline          # 找到要回到的提交
git revert <提交id>        # 生成一个反向提交（保留历史，更安全）
git push                   # Pages 自动重新发布
```

### 本地预览（可选）

```bash
cd "/Users/linxipan/Desktop/Memora"
node serve.mjs             # 打开 http://127.0.0.1:5188
```

本地服务器默认禁用缓存，改完刷新即可看到效果。

---

## 三、哪些文件会被公开 / 不会被上传

- **会发布**：`index.html`、`assets/**`、`docs/**`、`README.md` 等仓库根目录下的所有文件；
- **不会发布**：`.qa/`（本地验收脚本与截图）、`node_modules/`、`release/`（桌面端打包产物，单文件可能超过 GitHub 100MB 限制）——均已写入 `.gitignore`；
- `.nojekyll` 让 GitHub Pages 关闭 Jekyll 处理，静态资源原样发布；
- 仓库是 **Public**，Pages 上的内容对所有人可见；项目不含任何 API Key，访客各自填自己的 Key。

---

## 四、常见问题

**Q：推送后页面没变化？**
1. 先确认 Actions 里 Pages 构建成功；
2. 再等 1～2 分钟并 **⌘/Ctrl + Shift + R** 强刷；
3. 改了 JS/CSS 却没升级 `?v=` 版本号时，旧缓存可能仍在，按上文升级版本号。

**Q：`git push` 卡住 / 连接 github.com 超时？**
本机访问 GitHub 可能需要代理（当前系统代理为 `127.0.0.1:12000`，GitHub Pages 与 API 可直连，但 `github.com` 推送可能超时）。给推送临时挂代理：

```bash
cd "/Users/linxipan/Desktop/Memora"
HTTPS_PROXY=http://127.0.0.1:12000 ./deploy-github.sh
# 或手动：
HTTPS_PROXY=http://127.0.0.1:12000 git push
```

代理端口以自己代理软件的实际设置为准。

**Q：推送要求登录 / 认证失败？**
HTTPS 方式使用 GitHub **Personal Access Token** 作为密码（不要用账号密码）；本机凭据已保存在 macOS 钥匙串，正常情况下无需重复输入。也可以用 `gh auth login` 登录后再推。

**Q：想绑定自己的域名？**
仓库 **Settings → Pages → Custom domain** 填入域名，按提示配置 DNS（CNAME 指向 `2476104263-afk.github.io`），保存后勾选 Enforce HTTPS。

**Q：桌面端安装包怎么发？**
网页端不需要构建；Windows 安装包由 `.github/workflows/build-windows.yml` 生成：在 GitHub **Actions → Build Windows installer → Run workflow** 手动运行，或推送 `v*` 标签自动构建，产物在对应 Run 的 Artifacts 里下载（不会提交进仓库）。

---

## 五、从零部署到新账号 / 新仓库（备用）

1. 在 GitHub 新建一个 **Public** 仓库（不要勾选初始化 README）；
2. 在项目目录执行：

```bash
cd "/Users/linxipan/Desktop/Memora"
./deploy-github.sh https://github.com/<你的用户名>/<仓库名>.git
```

3. 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，Branch 选 `main`，目录选 `/ (root)`，Save；
4. 1～2 分钟后访问：

```text
https://<你的用户名>.github.io/<仓库名>/
```

> 仓库名如果正好是 `<你的用户名>.github.io`，则站点根地址就是 `https://<你的用户名>.github.io/`。

---

## 六、本次发布记录

- **2026-11-07**：发布 v1.7.0 网页端（长期记忆 / 记忆日记 / 个人资料 / 新界面）；
  - 修复 `assets/js/app.js` 启动时调用已删除的 `tickClock()` 导致聊天模块不加载的问题；
  - 同步版本号：`package.json` v1.7.0、设置页「关于」v1.7.0；
  - 忽略 `release/` 桌面端打包产物，避免误传大文件；
  - 仓库补充 `desktop/`、`.github/workflows/`、`package-lock.json`，用于桌面端与 Windows 安装包构建。
