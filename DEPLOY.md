# 部署到 GitHub Pages

> 久伴是**纯静态网页**，不需要后端、不需要构建。部署到 GitHub Pages 只需要把文件推到 GitHub 仓库，然后在仓库设置里开启 Pages 即可。

> ⚠️ 当前电脑上**没有配置 GitHub 账号/令牌**，所以项目已经准备好本地 git 仓库和首次提交，但**还没有推送到 GitHub**。请按下面步骤完成最后一步（约 2 分钟）。

---

## 一、前置条件

- 一个 GitHub 账号（免费账号即可）
- 仓库建议设为 **Public**（私有仓库使用 Pages 需要 GitHub Pro）
- 本机已有 git（macOS 自带）

---

## 二、创建仓库并推送（二选一）

### 方式 A：使用 GitHub CLI（推荐，最省事）

```bash
# 安装 gh（只需一次）
brew install gh

# 登录 GitHub（按提示在浏览器里授权）
gh auth login

# 在项目目录创建仓库并推送（把 jiuban 换成你想要的仓库名）
cd "/Users/linxipan/Desktop/挑杯项目"
gh repo create jiuban --public --source=. --remote=origin --push
```

### 方式 B：手动在网页创建仓库

1. 打开 <https://github.com/new>
2. 填写仓库名，例如 `jiuban`，选择 **Public**；
3. **不要**勾选 “Add a README file / .gitignore / license”；
4. 点击 Create repository；
5. 回到项目目录执行：

```bash
cd "/Users/linxipan/Desktop/挑杯项目"
./deploy-github.sh https://github.com/你的用户名/jiuban.git
```

脚本会自动提交最新改动、设置 `origin` 并推送到 `main`。

> 首次推送会要求登录 GitHub：HTTPS 方式请使用 **Personal Access Token** 作为密码；SSH 方式需要先配置 SSH key。也可以先用 `gh auth login` 登录后再推送。

---

## 三、开启 GitHub Pages

1. 打开 GitHub 仓库页面 → **Settings** → 左侧 **Pages**；
2. **Source** 选择 **Deploy from a branch**；
3. **Branch** 选择 **main**，目录选择 **/ (root)**；
4. 点击 **Save**；
5. 等待 1～2 分钟，页面顶部会出现站点地址。

不要选择 “GitHub Actions” 作为 Source（本项目不需要构建流程）。

---

## 四、访问地址

### 项目站点（仓库名不是 `用户名.github.io` 时）

```text
https://你的GitHub用户名.github.io/仓库名/
```

例如：

```text
https://linxipan.github.io/jiuban/
```

### 用户主页站点（仓库名必须是 `用户名.github.io`）

```text
https://你的GitHub用户名.github.io/
```

> 本项目所有路径都是相对路径，部署在 `/仓库名/` 子路径下也能正常工作（已实测）。
> 打开页面后，各自点击右上角「未连接 / 已连接」填入自己的 DeepSeek API Key 即可使用。

---

## 五、后续维护方式

### 修改内容

直接编辑项目里的文件，然后：

```bash
cd "/Users/linxipan/Desktop/挑杯项目"
./deploy-github.sh
```

或手动执行：

```bash
git add -A
git commit -m "更新说明"
git push
```

推送到 `main` 后，GitHub Pages 会自动重新发布，通常 **1～2 分钟**生效。

### 如果更新后页面没变化

GitHub Pages 会缓存静态资源，而久伴的 CSS/JS 带版本参数。修改样式或脚本后，建议递增版本号：

把 `1.6.0` 替换成新版本（例如 `1.6.1`），涉及：

- `index.html`（所有 `?v=1.6.0`）
- `assets/js/app.js`（`ASSET_VERSION`）
- `assets/js/chat.js`（动态 import 的 `?v=`）
- `assets/js/settings-view.js`（`APP_VERSION` 与动态 import 的 `?v=`）
- `README.md`、`package.json`（版本描述，可选）

然后提交推送，并在浏览器按 **⌘/Ctrl + Shift + R** 强制刷新。

### 查看发布状态

- 仓库 **Actions** 或 **Settings → Pages** 可以查看部署状态；
- 地址打不开时先确认 Pages 的 Branch 是否为 `main`、目录是否为 `/ (root)`；
- 也可以等待几分钟后再试。

### 回滚到旧版本

```bash
git log --oneline          # 找到要回滚的提交
git revert <提交id>        # 生成一个反向提交
git push                   # Pages 会自动重新发布
```

### 本地预览（可选）

GitHub Pages 不需要 `serve.mjs`，但本地开发仍可用：

```bash
node serve.mjs
```

---

## 六、注意事项

- **不要把 API Key 写进代码**：本项目默认不带任何 Key，访客在浏览器里自己填写；Key 只保存在访客自己的 localStorage。
- **仓库是公开的**：GitHub Pages 会公开仓库内的所有文件（`.qa` 测试目录已通过 `.gitignore` 排除，不会上传）。
- **没有登录/权限控制**：任何拿到网址的人都可以打开页面并使用自己的 Key，这是纯静态应用的正常边界。
- DeepSeek 官方接口已确认允许来自 `github.io` 域名的浏览器跨域请求；如果使用第三方代理，需要代理支持 CORS。
- 自定义域名：可以在 **Settings → Pages → Custom domain** 中绑定，并配置 DNS 与 HTTPS。
- 页面使用相对路径，支持仓库子路径部署；也支持直接作为用户主页站点根目录部署。

---

## 七、当前项目已为你准备好的内容

- `.gitignore`：排除 `.qa`、`.DS_Store`、日志、`node_modules`，避免把测试截图传到 GitHub；
- `.nojekyll`：关闭 Jekyll 处理，确保所有静态资源原样发布；
- `deploy-github.sh`：一键提交并推送；
- 本地 git 仓库已初始化并完成首次提交（等待推送到 GitHub）。
