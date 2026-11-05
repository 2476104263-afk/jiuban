# 久伴 协作契约（CONTRACT）

> **历史协作文档**：自 v1.6.0 起，产品已改为单一好友「久伴」，并移除了多好友/群聊与「AI Chat / 仿 QQ」字样；本文档中与多好友、群聊相关的段落仅作开发记录，不再对应当前产品。
>


> 本文件是三段并行开发（Lead / api-dev / plugin-dev）的唯一接口约定。
> **只读**：除 Lead 外不要修改本文件；需要变更接口时先发消息给 Lead。

## 1. 项目概述

久伴：桌面端聊天网页应用（单一好友「久伴」）。

- 纯静态、零依赖、无构建：原生 ES Modules + CSS 变量。
- 所有资源本地化：**禁止** CDN / 外链字体 / 外链图片（emoji 与内联 SVG 可以）。
- 界面语言：简体中文。
- 深色模式：根节点 `document.documentElement[data-theme="dark"]`。
- 浏览器目标：Chrome / Edge / Safari 最近两年版本。

## 2. 目录与文件归属（写作用域）

| 文件 | 归属 | 说明 |
| --- | --- | --- |
| `index.html` | **Lead** | 应用外壳，已包含所有容器 id |
| `assets/css/tokens.css` | **Lead** | 设计系统 + 共享组件（按钮/表单/开关/弹窗/Toast） |
| `assets/css/layout.css` | **Lead** | 窗口外壳、壁纸、侧栏、会话列表 |
| `assets/css/chat.css` | **Lead** | 聊天区、气泡、输入区、Markdown |
| `assets/js/store.js` | **Lead** | 状态与 localStorage 持久化 |
| `assets/js/util.js` | **Lead** | 工具函数、Markdown、Toast、Modal、图标 |
| `assets/js/data.js` | **Lead** | 预置 AI 好友 / 群聊数据 |
| `assets/js/chat.js` | **Lead** | 聊天列表 + 消息渲染 + 输入区 + 流式对话编排 |
| `assets/js/app.js` | **Lead** | 启动、路由、窗口控制、主题 |
| `assets/js/api.js` | **api-dev** | DeepSeek 客户端（流式 / 函数调用 / 连通性测试） |
| `assets/js/settings-view.js` | **api-dev** | 设置页（API Key 输入页 + 模型参数 + 数据管理） |
| `assets/css/settings.css` | **api-dev** | 仅设置页样式，全部选择器以 `.settings-page` 开头 |
| `assets/js/plugins.js` | **plugin-dev** | 插件注册表、内置插件、函数调用执行、持久化 |
| `assets/js/plugins-view.js` | **plugin-dev** | 插件中心页面（已安装 / 市场 / 自定义插件） |
| `assets/css/plugins.css` | **plugin-dev** | 仅插件中心样式，选择器以 `.plugins-page` 开头 |
| `README.md` | **Lead** | 使用说明 |
| `.qa/**` | **QA/Lead** | 截图、临时验证脚本，不进入产品代码 |

> 不要修改不属于自己的文件。需要加 DOM 节点时，在 `plugin-dev` / `api-dev` 的视图容器内自行创建。视图挂载点：
> - 设置页：`#view-root`（Lead 的动态 import 会调用 `mountSettingsView(#view-root)`）
> - 插件中心：`#view-root`（Lead 会调用 `mountPluginsView(#view-root)`）

## 3. 技术约束

1. **ES Modules**，相对路径导入，例如 `import { store } from './store.js'`。
2. **不要 npm install / 不要构建产物 / 不要新增依赖**。
3. 不要使用 `alert` / `confirm` / `prompt`；使用 `util.js` 的 `toast` / `confirmDialog` / `promptDialog` / `modal`。
4. 不要使用 `innerHTML` 拼接未转义的用户内容；AI / 用户文本走 `escapeHtml` 或 `renderMarkdown`（内部已转义）。
5. 所有用户可持久化数据只放 localStorage（Lead 的 store 或 plugin 自己的 key），不要发往任何第三方。
6. 样式必须复用 `tokens.css` 的变量（`var(--text-1)`、`var(--accent)` 等），不要写死与主题冲突的颜色；深色模式必须可用。
7. 页面布局使用共享类：`.page` / `.page-header` / `.page-title` / `.page-sub` / `.page-body` / `.page-section` / `.section-title` / `.card` / `.empty`。
8. 交互反馈：保存成功/失败、测试连接成功等都要 `toast()`。
9. 字体大小以 13–14px 为主；圆角、阴影遵守 tokens；**不要**引入夸张的渐变/动效。
10. 可访问性：按钮有 `aria-label` 或可见文字；弹窗有 `role="dialog"`；开关使用 `aria-checked`。

## 4. Lead 提供的公共 API

### 4.1 `assets/js/store.js`

```js
import { store } from './store.js';

// 读取
store.state                  // { version, conversations, activeConvId, settings, ui }
store.settings               // 设置对象（getter，见下）
store.conversations          // 会话数组
store.getConversation(id)    // 会话 | null
store.getActiveConversation()// 当前会话 | null

// 设置
store.updateSettings(patch)  // 浅合并 + 持久化 + 触发 'settings:changed'；返回合并后的 settings

// 会话
store.setActiveConversation(convId)          // 触发 'active:changed'
store.createConversation({ name, avatar, personaId, kind, members, systemPrompt })
store.updateConversation(convId, patch)      // 触发 'conversations:changed'
store.deleteConversation(convId)
store.resetChats()                            // 恢复默认会话，触发 'conversations:changed'

// 消息（聊天由 Lead 负责，其他模块一般不用）
store.appendMessage(convId, message)
store.updateMessage(convId, messageId, patch)
store.deleteMessage(convId, messageId)

// 订阅（返回取消函数）
const unsub = store.subscribe('settings:changed', (settings) => {});
const unsubAll = store.subscribe('*', (event, payload) => {});
```

- 事件名：`settings:changed`、`conversations:changed`、`messages:changed`、`active:changed`、`view:changed`。
- 持久化 key：`jiuban.state.v1`（自动迁移旧品牌 `qchat.state.v1`）。localStorage 不可用时静默降级为内存状态。
- `store.settings` 形状与默认值：

```js
{
  apiKey: '',                              // DeepSeek API Key，明文仅存本地
  baseUrl: 'https://api.deepseek.com',     // 可自定义（兼容 OpenAI 协议的代理）
  model: 'deepseek-chat',                  // 或 'deepseek-reasoner'
  temperature: 1.0,                        // 0 ~ 2
  maxTokens: 2048,                         // 128 ~ 8192
  stream: true,                            // 是否流式
  showReasoning: true,                     // 是否展示深度思考内容
  enterToSend: true,                       // Enter 发送
  theme: 'light'                           // 'light' | 'dark'
}
```

- 会话形状：

```js
{
  id, name, kind: 'friend' | 'group',
  avatar: { emoji: '🤖', from: '#4facfe', to: '#00f2fe' },
  personaId, members: [], systemPrompt,
  pinned: false, unread: 0, createdAt, updatedAt,
  messages: [ /* 见下 */ ]
}
```

- 消息形状（Lead 维护，api-dev 只需理解）：

```js
{
  id, role: 'user' | 'assistant',
  content, reasoning, image,
  createdAt, status: 'done' | 'streaming' | 'error', error,
  sender: { name, avatar },                 // 群聊里发言的 AI
  toolCalls: [{ id, name, args, result, status }]
}
```

### 4.2 `assets/js/util.js`

```js
import {
  $, $$, el, escapeHtml, renderMarkdown,
  formatTime, formatDay, relativeTime, uid,
  toast, confirmDialog, promptDialog, modal, copyText,
  icon, debounce, throttle, clamp, formatBytes, download, readFileAsDataURL,
} from './util.js';
```

- `el(tag, attrs?, children?)`：创建元素。`attrs` 支持 `class`、`text`、`html`（已转义内容才可传）、`dataset`、`style`、`on*`、其余为 attribute；`children` 为数组（Node / 字符串）。
- `modal({ title, body, footer, wide, onClose })` → `{ close(), el, body }`；`body`/`footer` 可传 HTML 字符串或 Node/Node[]；自动挂载到 `#modal-root`，支持遮罩点击 / Esc 关闭。**需要自定义表单时优先用它**。
- `confirmDialog({ title, message, confirmText, cancelText, danger })` → `Promise<boolean>`。
- `promptDialog({ title, label, placeholder, value, multiline, confirmText })` → `Promise<string|null>`。
- `toast(message, type = 'info')`，`type`: `'success' | 'error' | 'info' | 'warning'`。
- `escapeHtml(str)` → 字符串。
- `renderMarkdown(text)` → 安全 HTML 字符串（标题 / 列表 / 代码块 / 表格 / 粗体 / 行内代码 / 链接均已支持）。
- `icon(name, size = 18)` → 内联 SVG 字符串。可用名称：
  `key, plug, settings, check, check-circle, x, x-circle, info, warn, alert-triangle,
   search, plus, trash, edit, eye, eye-off, refresh, download, upload, shield, lock,
   sparkles, link, external, copy, chevron-down, chevron-right, loader, code, message,
   image, sliders, zap, bot, layers, terminal, globe, clock, calculator, cloud-sun,
   dice, list-checks, ruler, search-web, brush, translate, star, pin, database, save,
   file-text, wand, users, palette, arrow-left, arrow-right, more, play, power`
  （不确定可直接内联 SVG，但优先使用 `icon()`，尺寸 16–20px。）
- `download(filename, content, mime?)`、`readFileAsDataURL(file)`。
- `relativeTime(ts)`：`刚刚 / x 分钟前 / HH:mm / 昨天 HH:mm / M月D日`。

## 5. api-dev 交付契约

### 5.1 `assets/js/api.js`

```js
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODELS = [
  { id: 'deepseek-chat', label: 'DeepSeek-V3.2 · 通用对话' },
  { id: 'deepseek-reasoner', label: 'DeepSeek-R1 · 深度思考' },
];

// 测试 Key / 网络 / 模型可用性（GET /models）
// 返回 { ok: boolean, message: string, latency?: number, models?: string[] }
export async function testConnection(settings) {}

// 单次补全（内部完成流式解析；函数调用只返回 toolCalls，由调用方执行）
// 事件：{type:'reasoning', text} | {type:'content', text} | {type:'usage', usage}
// 返回：{ content, reasoning, toolCalls: [{ id, name, arguments }], finishReason, usage }
// 错误：抛出 Error，带 err.code ∈ 'auth'|'balance'|'rate_limit'|'network'|'server'|'bad_request'|'aborted'|'unknown'
//      err.message 必须是可直接展示的中文
export async function streamCompletion({ settings, messages, tools = [], signal, onEvent }) {}
```

- 请求：`POST {baseUrl}/chat/completions`，`Authorization: Bearer <apiKey>`，`Content-Type: application/json`。
- body：`{ model, messages, temperature, max_tokens, stream: true, tools?: [...] }`；`tools` 为空时不要传该字段。开启流式时处理 SSE（`data: {...}`、`[DONE]`），并解析 `delta.content`、`delta.reasoning_content`、`delta.tool_calls`（按 index 累积）。
- 网络失败、CORS、401/402/429/5xx 必须映射成中文提示。
- `aborted`：外层 `AbortController.abort()` 时抛出的错误要能被调用方识别（`err.name === 'AbortError'` 或 `err.code === 'aborted'`）。
- 兼容非流式设置：当 `settings.stream === false` 时用普通 JSON 请求，同样通过 `onEvent({type:'content'})` 一次性回调。
- 禁止在模块加载时发起请求。

### 5.2 `assets/js/settings-view.js`

```js
export function mountSettingsView(container) { /* 渲染到 container，返回 cleanup 函数 */ }
export function unmountSettingsView() { /* 可选 */ }
```

页面内容（全中文，风格对齐 tokens 与共享组件）：

1. **头部**：标题「设置」+ 副标题「接入 DeepSeek，管理模型参数与本地数据」。
2. **DeepSeek API 接入卡片**（页面重点）：
   - API Key 密码框：默认掩码显示；`眼睛`按钮切换明文；占位符 `sk-xxxxxxxxxxxx`；保存到 `store.settings.apiKey`。
   - 「获取 API Key」外链 `https://platform.deepseek.com/api_keys`（`target="_blank" rel="noopener"`）。
   - 显示「已保存」状态 / 当前来源（环境 / 手动）；不允许把 key 写入任何日志。
   - 测试连接按钮：调用 `testConnection`，loading → 成功（绿色）显示延迟与模型数量 / 失败（红色）中文原因。
   - 保存按钮（或失焦自动保存，二选一；建议「保存」显式按钮 + toast）。
   - 安全提示：「Key 只保存在本机浏览器 localStorage，不会上传到除 DeepSeek 官方接口以外的任何服务器」。
3. **模型与参数**：模型下拉（`DEEPSEEK_MODELS`）、温度 slider（0–2，显示数值）、最大 tokens（number，128–8192）、流式输出开关、显示深度思考开关。
4. **对话偏好**：Enter 发送开关、深色模式开关（写 `store.settings.theme`，并同步 `document.documentElement.dataset.theme`；Lead 也会监听）。
5. **数据管理**：导出配置（JSON，默认隐藏 apiKey）、导入配置、清空所有聊天记录、重置全部数据。危险操作需 `confirmDialog`。
6. **关于**：版本 `v1.6.0`、说明「纯前端 · 零依赖 · 数据不出本机」。
7. 页面内「去插件中心」按钮可 `location.hash = '#plugins'`（Lead 支持 hash 路由）。
8. 订阅 `store` 的 `settings:changed`，同步表单（注意避免自己触发自己循环）。

### 5.3 `assets/css/settings.css`

`.settings-page` 命名空间；布局建议两栏（左侧子导航可选，或单列卡片最大宽度 860px 居中），响应式 900px 以下单列。不要影响其他页面。

## 6. plugin-dev 交付契约

### 6.1 `assets/js/plugins.js`

```js
export const pluginManager = {
  listInstalled(),          // [{ id, name, icon, desc, category, kind:'tool'|'prompt', custom, enabled }]
  listMarket(),             // 未安装的内置插件（同上形状，enabled:false）
  get(id),
  isInstalled(id),
  install(id),              // 安装内置插件（默认 enabled: true），触发变更
  uninstall(id),            // 卸载（内置恢复为「未安装」，自定义删除）
  setEnabled(id, enabled),
  toggle(id),
  addCustom({ name, icon, desc, prompt, category }),   // 返回新插件对象
  updateCustom(id, patch),
  removeCustom(id),
  getActiveToolSchemas(),   // 已启用工具类插件 → OpenAI tools 数组
  getToolDisplayName(toolName), // 给聊天区显示「🧮 计算器」用
  getPromptAddons(),        // 已启用的提示词类插件拼成的系统提示词片段（string）
  executeTool(toolName, args),  // → Promise<{ ok, result, display }>，永不抛错
  subscribe(fn),            // 返回取消函数；任何变更后调用
  exportConfig(),           // JSON 对象
  importConfig(json),       // 返回 { ok, message, count }
  reset(),                  // 清空安装状态与自定义插件
};

export const BUILTIN_PLUGINS = [ /* 内置插件目录（含工具 schema） */ ];
```

- 持久化 key：`jiuban.plugins.v1`（自动迁移旧品牌 `qchat.plugins.v1`）；结构自定（建议 `{ version, installed: { [id]: { enabled, installedAt } }, customs: [...] }`）。
- **内置插件目录**（至少实现以下 10 个，`kind: 'tool'` 或 `'prompt'`）：

| id | 名称 | icon | 类型 | 说明 / 工具函数 |
| --- | --- | --- | --- | --- |
| `calculator` | 计算器 | 🧮 | tool | `calculate({ expression })` 安全四则运算（**不要 eval**，自行解析或白名单 token） |
| `time` | 时间助手 | ⏰ | tool | `get_current_time({ timezone? })` 返回真实本地时间 |
| `weather` | 天气助手 | 🌤️ | tool | `get_weather({ city })` 演示数据，结果需标注「演示数据」 |
| `todos` | 待办清单 | ✅ | tool | `manage_todos({ action: add/list/done/clear, item? })` 存 localStorage |
| `dice` | 骰子与随机 | 🎲 | tool | `roll_dice({ sides?, count? })` |
| `random` | 随机选择 | 🎯 | tool | `random_pick({ items, count? })` |
| `converter` | 单位换算 | 📏 | tool | `convert_units({ value, from, to })` 支持 长度/重量/温度 常用单位 |
| `uuid` | 密码与 UUID | 🔐 | tool | `generate_secret({ type: 'password'|'uuid', length? })` |
| `search` | 联网搜索 | 🔎 | tool | `web_search({ query })` 演示数据，标注「演示」 |
| `translator` | 翻译官 | 🌐 | prompt | 系统提示词片段：中英互译，保留格式 |
| `weekly` | 周报助手 | 📝 | prompt | 系统提示词片段：把零散记录整理成结构化周报 |
| `reviewer` | 代码审查员 | 🧐 | prompt | 系统提示词片段：按安全/性能/可读性审查代码 |

- 初始安装状态：`calculator`、`time`、`todos`、`translator` 默认已安装并启用；其余在市场可安装（让市场页有内容）。
- 工具 schema 用 OpenAI function calling 格式：`{ type: 'function', function: { name, description, parameters } }`，`parameters` 用 JSON Schema；`executeTool` 接收 `toolName`（函数名）与已解析 args。
- 工具结果：`{ ok: true, result: '给模型看的纯文本', display: '给用户看的简短摘要' }`；失败 `{ ok: false, result: '错误说明' }`。
- 提示词类插件：`prompt` 字段是注入系统提示词的文本；`getPromptAddons()` 返回拼接片段（无启用项时返回空串）。
- 变更后通过 `subscribe` 通知 UI；同时 `store.emit('plugins:changed')` 便于其他模块刷新（Lead 也会监听）。
- 内置插件工具定义示例：

```js
{
  id: 'calculator', name: '计算器', icon: '🧮', kind: 'tool', category: '效率',
  desc: '让 AI 精确计算数学表达式，避免心算错误',
  tools: [{
    type: 'function',
    function: {
      name: 'calculate',
      description: '计算数学表达式，支持 + - * / % ** 与括号',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: '如 (12+8)*3/4' } },
        required: ['expression'],
      },
    },
  }],
  async handler(args) { /* 返回 { ok, result, display } */ },
}
```

### 6.2 `assets/js/plugins-view.js`

```js
export function mountPluginsView(container) { /* 渲染到 container，返回 cleanup */ }
```

页面内容：

1. **头部**：标题「AI 插件中心」+ 副标题「安装插件，让 AI 拥有调用工具与专属技能的能力」；右侧按钮：「添加自定义插件」主按钮、「导入」「导出」次级按钮。
2. **信息条**：说明工具类插件通过 DeepSeek Function Calling 生效、提示词类插件注入系统提示；提示去设置页配置 API Key（`location.hash = '#settings'`）。
3. **已安装 / 插件市场** 两个 tab（用 `.segmented`），显示数量；支持搜索框过滤。
4. **卡片网格**（响应式 2–3 列）：图标、名称、类型徽标（函数调用 / 提示词）、分类、描述、开关（`aria-checked`）、自定义插件额外有「编辑 / 删除」按钮；市场卡片有「安装」按钮 + 「已安装」状态。
5. **添加自定义插件弹窗**（`util.modal`）：名称（必填，≤20 字）、图标 emoji（默认 🧩，可换）、描述（≤80 字）、提示词（必填，≥10 字），保存后立即出现在已安装列表并启用，toast 提示。
6. **导出**：下载 `jiuban-plugins.json`；**导入**：`<input type=file>` 读取 JSON 调 `importConfig`，toast 结果。
7. 空状态：市场为空 / 搜索无结果时用 `.empty`。
8. 订阅 `pluginManager.subscribe` 重渲染；cleanup 时取消订阅（**必须返回 cleanup，且不要在 container 外挂监听**，文件选择 input 监听可挂在 container 内）。
9. 插件数量上限：自定义插件 ≤ 30，超出 toast 提示。

### 6.3 `assets/css/plugins.css`

`.plugins-page` 命名空间；卡片 hover、网格、类型徽标、开关行排版；响应式。

## 7. 路由与联调

- Lead 的 `app.js` 支持 hash 路由：`#chat`（默认）/ `#plugins` / `#settings`。切换 rail 按钮或 `location.hash` 都会触发视图挂载。
- 视图挂载点 `#view-root` 是唯一容器，Lead 在切换时清空它；视图返回的 cleanup 会被调用。
- 启动时 Lead 会 `await import('./settings-view.js')` / `await import('./plugins-view.js')`；模块缺失或抛错时页面显示友好错误，不影响聊天页。
- Lead 的聊天逻辑会 `await import('./api.js')` 与 `await import('./plugins.js')`；所以 api/plugins 模块必须在**首次聊天发送**前可用（开发时请尽早创建文件，允许先放桩实现再迭代）。
- 联调事件：`store.settings.apiKey` 变化后，Lead 更新状态徽标；`pluginManager` 变化后，聊天输入区/消息区可展示已启用插件数。

## 8. 本地预览与自测

在工作目录 `/Users/linxipan/Desktop/挑杯项目`：

```bash
# 启动静态服务器（每个角色用不同端口，避免冲突）
python3 -m http.server 5189 --bind 127.0.0.1    # api-dev
python3 -m http.server 5190 --bind 127.0.0.1    # plugin-dev
python3 -m http.server 5188 --bind 127.0.0.1    # Lead / QA

# 直接打开对应视图
open http://127.0.0.1:5189/#settings
open http://127.0.0.1:5190/#plugins
```

无头 Chrome 截图（检查视觉）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 \
  --virtual-time-budget=4000 --screenshot=/tmp/api-settings.png \
  "http://127.0.0.1:5189/#settings"
```

自测清单（交付前必须逐条自查）：

- [ ] 控制台无报错；页面在 1440×900 下无横向滚动条、无重叠。
- [ ] 深色模式下文字对比度足够、无白底闪块。
- [ ] 表单校验有效（空 Key、空名称、非法 temp/tokens）。
- [ ] 刷新页面后设置 / 插件状态仍在（localStorage）。
- [ ] 键盘可达：Tab 能聚焦主要按钮，Esc 能关闭弹窗。
- [ ] 不修改他人文件；`git` 不需要提交。

## 9. 交付与汇报

完成后向 Lead 发消息，包含：

1. 已完成文件列表与核心能力；
2. 自测结果（截图路径、控制台是否有错）；
3. 已知问题 / 未完成项；
4. 需要 Lead 联调或修改契约的地方。

保持文件自包含、可单独 import；遇到与本契约冲突的实现，以本契约为准并上报。
