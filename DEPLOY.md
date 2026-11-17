# 部署到 GitHub Pages

> Memora的网页端是**纯静态站点**：原生 HTML + CSS + ES Modules，不需要后端、不需要构建。只要把仓库根目录的文件推到 GitHub，GitHub Pages 就会自动发布。

## 部署状态（已完成）

| 项目 | 内容 |
| --- | --- |
| **在线地址** | <https://2476104263-afk.github.io/jiuban/> |
| **GitHub 仓库** | <https://github.com/2476104263-afk/jiuban> |
| **部署方式** | GitHub Pages → Source = `Deploy from a branch` → 分支 `main` → 目录 `/ (root)` |
| **当前版本** | v1.17.0（2026-11-17 发布） |
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
2. 打开「设置」→ 底部「关于」应显示 `Memora v1.17.0`；
3. 按 F12 打开控制台，应看到 `[Memora] v1.17.0 · …`，且没有红色报错。

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
HTTPS 方式需要 GitHub 凭据（不要用账号密码）：
- 在 <https://github.com/settings/tokens> 创建 Personal Access Token（classic），勾选 `repo` + `workflow`，推送时粘贴到 Password 处；
- 或安装 GitHub CLI 后执行 `gh auth login`。
本机当前**没有保存长期凭据**（钥匙串写入被系统权限拦截），下次推送仍会要求认证；成功输入一次后，如果系统允许，macOS 会自动把它保存到钥匙串。

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

- **2026-11-17**：发布 v1.17.0（Memora 品牌 / 记忆回环图标 / Apple HIG 布局 / 液态玻璃界面）；
  - 应用更名为 Memora，统一首页、侧栏、页面标题、设置关于与桌面端产品名；保留原有本地数据键与仓库地址以兼容旧数据；
  - 新「记忆回环」图标：白色圆角底座、烟灰玻璃与珍珠银双环、细微虹彩；提供 16–1024 多尺寸 PNG、Apple Touch 与 favicon.ico；
  - 桌面端分组侧栏可收起，紧凑窗口使用五入口底部导航；表单、弹窗与操作层级按 Apple HIG 统一；
  - 新增液态玻璃材质与指针高光（支持减少动效/透明度回退），阅读卡片保持普通表面；
  - 路由改为页面状态缓存，切换模块保留输入与滚动状态；补全独立年度报告构建产物；
  - 发布前验收：记忆库 8+15 测试、年报 4 测试、聊天数据库 6 测试；无头浏览器桌面 6 入口与移动端 390×844 冒烟无报错、无横向溢出。

- **2026-11-17**：发布 v1.16.0 网页端（记忆中心 / 聊天记录导入 / 微信数据库提取 / 年度聊天报告 / 人物档案 / 平行世界）；
  - 新增「记忆中心」二级导航：记忆与认知、决策复盘、导入聊天记录、记忆库服务；
  - 新增聊天记录导入（CSV/JSON/TXT/AI-TXT）与本地微信数据库提取；加密数据库使用用户提供的已有密钥，在浏览器本地解密，密钥不落盘、不上传；
  - 接入 AnnualReport 模板生成本地年度聊天报告（同源 iframe + postMessage，报告页禁止外部网络请求）；
  - 新增 `integrations/` 独立构建目录与 `assets/vendor/` 预构建资源；`serve.mjs` 与桌面端补充 `.wasm` MIME；
  - 新增 AURORA-CAIR 记忆库服务（`memory-service/`）与一键启动 `npm run dev`；
  - 统一版本号 v1.16.0，并升级 `index.html` 与 JS 模块中所有 `?v=` 缓存参数；
  - 发布前验收：记忆库核心/HTTP 测试（8+15 通过）、聊天数据库单元测试（6 通过）、年报统计测试（4 通过）、无头浏览器入口冒烟。

- **2026-11-12**：发布 v1.11.0 网页端（平行世界 / 人物回忆 / 决策复盘 / 时序记忆）；
  - 移除插件系统（`plugins.js`、`plugin-editor.js`、`plugins.css` 及设置页相关入口），改为「平行世界」多智能体群聊；
  - 新增 `decision-view.js`、`people-view.js`、`worlds-view.js` 及对应样式，导航扩展为 7 个入口；
  - 统一版本号 v1.11.0（`package.json`、`index.html` 的 `app.js?v=`、`ASSET_VERSION`、设置页「关于」）；
  - 同步升级本次改动的 `chat.css` / `settings.css` / `memory.css` 缓存版本号，避免访客看到旧样式；
  - 发布前本地无头浏览器验收：7 个视图均能打开、演示模式聊天正常、无 JS 报错与 404。

- **2026-11-07**：发布 v1.7.0 网页端（长期记忆 / 记忆日记 / 个人资料 / 新界面）；
  - 修复 `assets/js/app.js` 启动时调用已删除的 `tickClock()` 导致聊天模块不加载的问题；
  - 同步版本号：`package.json` v1.7.0、设置页「关于」v1.7.0；
  - 忽略 `release/` 桌面端打包产物，避免误传大文件；
  - 仓库补充 `desktop/`、`.github/workflows/`、`package-lock.json`，用于桌面端与 Windows 安装包构建；
  - 本次推送通过 GitHub OAuth 设备授权完成（GitHub CLI 应用，scope：`public_repo` + `workflow`），本地未保存 Token；授权可在 GitHub → **Settings → Applications** 中查看或撤销。
