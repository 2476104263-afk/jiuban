# Memora 记忆库服务（AURORA-CAIR 创新点落地）

一个**本地运行、零外部依赖**的记忆库服务：把《忆索 AURORA-CAIR 项目细化与实验方案》中的
“嵌套量化 + 可靠区间 + 精确认证 + CARS 自适应恢复”落到可运行代码，同时实现 Memora 记忆库的
时序记忆、确认/修正、版本、证据追溯与快照复盘接口，并提供 Web 客户端与日记接入适配层。

> 定位：**可运行的研究原型 / 演示服务**，不是生产系统。默认嵌入是轻量的确定性字符 n-gram 哈希模型，
> 不是语义大模型；“精确 Top-K”是对本服务定义的评分函数与候选全集而言的精确，不代表语义检索质量。

---

> 零基础的手把手使用与验收步骤见 [USAGE.md](./USAGE.md)。

## 1. 快速开始

```bash
# 一键同时启动网页端(5188) + 记忆库服务(5189)
npm run dev

# 或只启动记忆库服务
node memory-service/server.mjs
# 或
npm run memory:service
```

打开演示页：<http://127.0.0.1:5189/>（页面自带“载入演示数据 / 认证检索 / 日记接入”）
健康检查：<http://127.0.0.1:5189/api/health>

数据默认写入 `memory-service/data/`（`memory.db` + `vectors.bin`），已加入 `.gitignore`。

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MEMORY_PORT` | `5189` | 服务端口 |
| `MEMORY_HOST` | `127.0.0.1` | 监听地址 |
| `MEMORY_DATA_DIR` | `memory-service/data` | 数据目录（SQLite + 向量块文件） |
| `MEMORY_DIM` | `256` | 嵌入维度；**修改后必须重建数据**（旧向量不兼容） |

```bash
# 测试与基准
npm run memory:test     # 核心正确性 8 项 + HTTP 集成 15 项
npm run memory:bench    # 300 条记忆 / 60 查询的调度基准
```

基准示例（300 条合成记忆、K=5、60 查询、本机 warm cache）：

```
认证一致率 100.0%   精确认证 Top-K 与全量精排 100.0% 一致
平均动作数 31.5     平均精确恢复 13.95 条
平均剪枝 293.55 条  平均块读取 0.08 块  平均读取 1795 字节
延迟 P50 1.66 ms   P95 2.88 ms
```

> 数字来自合成数据与热缓存，不代表真实长期记忆质量；冷缓存、LoCoMo/LongMemEval 真实数据尚未接入。

---

## 2. 与 AURORA-CAIR 的对应关系

| AURORA 模块 | 本实现 | 文件 |
| --- | --- | --- |
| M2 压缩索引：多级编码、可靠误差界 | 16-bit 完整编码，4/8/16-bit 取同一编码前缀（天然嵌套）；区间算术得到语义分数上下界 | `lib/vector.mjs` |
| M3 精确认证：安全剪枝、成员认证、内部排序 | 上界 < 第 K 大下界即剪枝；Top-K 下界严格大于外部上界即认证；最终 K 条精确恢复并按 `score desc, memory_id asc` 排序 | `lib/retrieval.mjs` |
| M4 联合恢复：单条、块级、多精度 | 动作空间：`refine`（4→8→16-bit，读 L2 编码）、`exact`（读块文件恢复单条）、`exact_block`（同块多条共享一次 I/O） | `lib/retrieval.mjs` |
| M5 自适应调度（CARS） | 按“预计区间收缩收益 / 读取成本”选择动作；边界候选短名单；无收益或超预算时安全回退全量精排；全程写 trace | `lib/retrieval.mjs` |
| 分层存储 L1/L2/L3 | SQLite 保存元数据与 16-bit 编码（L1/L2 同源）；`vectors.bin` 每块 16 条、每条 DIM×float32（L3），带块缓存与 I/O 计数 | `lib/store.mjs` |
| 查询快照 / 版本一致 | 每轮查询冻结候选集、时间基准、权重；修正生成新版本并取代旧版本；当前/历史查询使用不同版本集合 | `lib/store.mjs` / `lib/retrieval.mjs` |
| RecoveryTrace | trace 记录动作序列、目标、收益、成本、读取字节、精确恢复数、剪枝数、是否回退、P50 由调用方汇总 | `lib/retrieval.mjs` |

### 评分函数

六个维度都归一化到 `[0,1]`，权重非负且归一：

```
Score = w_sem·语义 + w_entity·实体/主题匹配 + w_time·时间
      + w_imp·重要度 + w_trust·证据可信度 + w_act·本轮主题激活
默认权重：0.40 / 0.15 / 0.15 / 0.10 / 0.10 / 0.10
```

- 只有“语义”维度来自压缩向量，需要可靠区间；
- 其余维度由元数据精确计算（因此总分的上下界依然严格有效）；
- **主题提及只影响本轮 activation，不写长期权重/确认状态**（`mention=true` 时只记录 `activations` 审计行）；
- 明确确认/修正才更新 `confirmation_state`、`base_weight`、有效期与版本链。

### 可靠性说明（与原始方案的差异）

- 区间使用工程 epsilon，尚未做形式化外向舍入证明；`tests` 用随机/边界样例验证覆盖性。
- 已实现 CARS 单动作选择与块级共享 I/O；**CARS-2 的互补双动作组合尚未实现**。
- 高维真实向量（128/384/768 维）与真实块文件 I/O 实验尚未接入；当前 256 维为原型配置。
- 权限仅按 `owner_scope` 过滤，未实现多用户鉴权与撤权。

---

## 3. API（REST/JSON）

所有响应 JSON；CORS 已开启（`Access-Control-Allow-Origin: *`），供网页端跨端口调用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查、维度、存储统计 |
| GET | `/api/stats` | 记忆数、活跃数、块数、槽位、I/O 统计 |
| POST | `/api/memories/ingest` | 抽取候选并写入；`text, source_type, source_id, owner_scope, auto_confirm, llm{apiKey,...}` |
| POST | `/api/memories/confirm` | `memory_id, action: confirm/correct/expire/reject/retract, patch` |
| POST | `/api/memories/search` | `query, owner_scope, top_k, time_intent(current/history), weights, mention` |
| GET | `/api/memories?owner_scope=&limit=` | 列出记忆 |
| GET | `/api/memories/:id` | 获取单条 |
| DELETE | `/api/memories/:id?hard=1` | 删除（先不可检索，hard 时释放槽位） |
| POST | `/api/decision/snapshot` | 冻结一次复盘输入（记忆 ID、版本、时间基准、权重） |
| POST | `/api/decision/branches` | 生成 A/B 条件分支（本地模板；证据来自快照范围检索） |
| POST | `/api/reviews/outcome` | 写入实际结果复盘 |
| POST | `/api/export` / `/api/import` | JSON 导出 / 导入 |
| POST | `/api/demo/seed` | 写入 12 条演示记忆（幂等；`force=true` 可重复） |

示例：

```bash
curl -s -X POST http://127.0.0.1:5189/api/memories/ingest \
  -H 'Content-Type: application/json' \
  -d '{"owner_scope":"demo","text":"计划下周开始每周复习线性代数两次","auto_confirm":true}'

curl -s -X POST http://127.0.0.1:5189/api/memories/search \
  -H 'Content-Type: application/json' \
  -d '{"owner_scope":"demo","query":"线性代数 复习","top_k":5}'

curl -s -X POST http://127.0.0.1:5189/api/memories/search \
  -H 'Content-Type: application/json' \
  -d '{"owner_scope":"demo","query":"线性代数","top_k":5,"mention":true}'
```

---

## 4. 接入网页端

### 4.1 网页端内置页面（已接入）

久伴网页端通过「记忆中心 → 记忆库服务」入口（`assets/js/memory-service-view.js`）：可连接服务、
写入/确认/删除记忆、认证检索并查看 trace、同步本地日记、运行 8 项浏览器自动测试。
启动网页端（`node serve.mjs` → 5188）和记忆库服务（`node memory-service/server.mjs` → 5189）后，
打开 <http://127.0.0.1:5188/#memory/service> 即可使用。

### 4.2 作为 ES Module 客户端

网页端（`serve.mjs` 或任意静态服务器）直接跨端口调用服务：

```js
import { MemoryClient } from 'http://127.0.0.1:5189/memory-client.js';
// 或把 memory-service/web/memory-client.js 复制进项目后相对导入

const client = new MemoryClient('http://127.0.0.1:5189', { timeoutMs: 20000 });
const health = await client.health();

// 写入：默认返回候选，需确认
const { candidates } = await client.ingest({
  owner_scope: 'default',
  text: '记住：我下周三去图书馆还书，顺便复习概率论。',
  source_type: 'conversation',
});
await client.confirm(candidates[0].memory_id, 'confirm');

// 检索：返回认证 Top-K + 证据 + trace
const res = await client.search({ owner_scope: 'default', query: '概率论 复习', top_k: 5 });
console.log(res.results, res.trace);
```

演示页 `/` 与 `memory-service/web/integration-example.js` 提供了可复制的最小接入代码。

### 4.3 接入日记模块

`memory-service/web/diary-adapter.js` 提供 `save / search / list / extractCandidates`：

```js
import { MemoryClient } from 'http://127.0.0.1:5189/memory-client.js';
import { createDiaryMemoryService } from 'http://127.0.0.1:5189/diary-adapter.js';

const client = new MemoryClient('http://127.0.0.1:5189');
const diary = createDiaryMemoryService(client, { owner_scope: 'default' });

// 现有 diary-view.js 保存日记成功后调用；失败时保留本地 IndexedDB，不影响主流程
const result = await diary.save({ date: '2026-11-15', title: '联调记录', content: '今天项目联调遇到接口不一致……' });
if (result.ok) console.log('已同步到记忆库', result.memories.length);

// 需要用户确认时可用 extractCandidates，再逐条 confirm
```

推荐集成位置：

- `assets/js/diary-view.js` 的保存/编辑动作之后（可选、失败降级）；
- 聊天发送前（可选）：用 `client.search({ query, mention: true })` 取证据注入提示词；
- 设置页增加“记忆库服务地址”输入（保存到 `localStorage['jiuban.memory.serviceUrl']`），默认关闭即可。

### 4.4 可选 LLM 抽取（DeepSeek 兼容）

`ingest` 可传 `llm: { apiKey, baseUrl, model }`：服务会调用 `/chat/completions` 抽取结构化候选，
失败自动回退本地规则。**API Key 仅在请求内存中使用，不落盘、不写日志**。
默认 `baseUrl=https://api.deepseek.com`、`model=deepseek-chat`。

---

## 5. 数据与存储布局

```
memory-service/
├── server.mjs              HTTP API + 静态演示页
├── lib/
│   ├── vector.mjs          嵌入、16-bit 编码、4/8/16-bit 前缀区间、余弦上下界
│   ├── extract.mjs         本地规则抽取（时间/类型/主题）+ 可选 LLM 抽取
│   ├── scoring.mjs         六维评分、时间衰减、可靠上下界
│   ├── store.mjs           SQLite 元数据 + vectors.bin 块文件 + 版本/删除/快照
│   └── retrieval.mjs       安全剪枝、成员认证、CARS 调度、trace、bruteForce 基线
├── web/
│   ├── demo.html/.js       演示页（记忆库 / 认证检索 / 日记接入 / 说明）
│   ├── memory-client.js    浏览器/Node 通用客户端
│   ├── diary-adapter.js    日记接入适配层
│   └── integration-example.js 现网接入示例
└── test/
    ├── core.test.mjs       核心正确性（8 项）
    ├── server.test.mjs     HTTP 集成（15 项）
    └── bench.mjs           调度基准
```

存储：

- `memories`：内容、事件时间、有效区间、来源、类型、主题、权重、确认状态、版本、槽位、16-bit 编码；
- `confirmations` / `activations`：确认/修正/删除审计、主题提及审计（不影响长期状态）；
- `query_logs`：每次检索的 query、结果与 trace（可复现）；
- `snapshots` / `outcomes`：复盘输入快照与实际结果；
- `vectors.bin`：每块 16 条 × `DIM` float32；块缓存 32 块，冷读计入 I/O。

---

## 6. 已知边界与后续

- 默认嵌入为哈希 n-gram，**不适合作为语义质量结论**；接入真实中文嵌入（如 bge-small-zh）需保持同维或迁移重建，并重跑对照实验。
- “精确 Top-K”只保证等于**定义评分**下的全量精排；语义权重不当仍可能漏证据（AURORA 的第 2.3 节三类质量需分开报告）。
- 尚未实现：CARS-2 双动作、真实高维/冷缓存基准、LoCoMo/LongMemEval 数据接入、多用户权限、分布式。
- 前端为演示界面，未与正式申报 UI 合并；接入现有网页端建议按 4.2 做可选开关，默认不影响本地体验。
