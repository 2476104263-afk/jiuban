# Memora 记忆库服务：使用与测试（零基础版）

> 服务位置：`memory-service/`；全部命令在**仓库根目录**运行。
> 环境要求：Node.js ≥ 22.5（本机已验证 v24.22.0）；不需要 npm install，无外部依赖。
> 数据目录：默认 `memory-service/data/`（SQLite + 向量块文件，已加入 `.gitignore`）。

---

## 一、启动（推荐一键）

在仓库根目录执行：

```bash
npm run dev
# 等价于 node start-all.mjs
```

会同时启动网页端（5188）与记忆库服务（5189），然后打开 **<http://127.0.0.1:5188/#memory/service>** 即可使用图形界面。
按 `Ctrl+C` 同时停止两个服务。

也可以分两个终端手动启动：

```bash
# 终端 1
node memory-service/server.mjs
# 终端 2
node serve.mjs
```

记忆库服务自带的演示页：<http://127.0.0.1:5189/>。下面是服务端的演示页说明。

预期输出：

```
Memora 记忆库服务已启动：http://127.0.0.1:5189
演示页：http://127.0.0.1:5189/
健康检查：http://127.0.0.1:5189/api/health
```

浏览器打开 <http://127.0.0.1:5189/>，按下面步骤即可看到完整效果：

1. **记忆库** 页：点「载入演示数据」→ 出现 12 条演示记忆（重复点击不会重复写入）。
2. 在文本框写一句，例如“记住：我下周一开始每天复习线性代数 45 分钟。”→ 勾选「直接确认」→ 点「抽取并保存」。
3. 切到 **认证检索** 页：查询框输入 `线性代数 复习 问题` → 点「检索」→ 看到 5 条结果、分数、维度明细；
   下方「检索轨迹」显示本次认证动作：剪枝数、refine/exact 动作、精确恢复数、块读取与字节数、是否回退。
4. 勾选「记为“主题提及”」再检索：只影响本轮排序并写入激活审计，**不会修改长期权重**。
5. 切到 **日记接入** 页：填日期和内容 → 「保存为日记记忆」→ 左侧出现日记记忆；用右侧按主题检索。
6. **说明** 页解释每个演示项对应 AURORA-CAIR 的哪个创新点。

### 重置演示数据

```bash
# 停止服务（Ctrl+C）后删除数据目录，再重启即可
rm -rf memory-service/data
```

---

## 二、用命令行走一遍 API（不打开浏览器也能验收）

另开一个终端（服务保持运行）：

```bash
# 1) 健康检查
curl -s http://127.0.0.1:5189/api/health

# 2) 写入 12 条演示记忆（幂等）
curl -s -X POST http://127.0.0.1:5189/api/demo/seed \
  -H 'Content-Type: application/json' -d '{"owner_scope":"demo"}'

# 3) 认证检索：返回 certified Top-K + trace
curl -s -X POST http://127.0.0.1:5189/api/memories/search \
  -H 'Content-Type: application/json' \
  -d '{"owner_scope":"demo","query":"线性代数 复习 问题","top_k":5}'

# 4) 写入候选（默认需要确认）
curl -s -X POST http://127.0.0.1:5189/api/memories/ingest \
  -H 'Content-Type: application/json' \
  -d '{"owner_scope":"demo","text":"记住：我下周三要去图书馆还书，顺便复习概率论。"}'

# 5) 确认候选（把上一步返回的 memory_id 填进来）
curl -s -X POST http://127.0.0.1:5189/api/memories/confirm \
  -H 'Content-Type: application/json' \
  -d '{"memory_id":"mem_xxx","action":"confirm"}'

# 6) 主题提及（只记本轮激活；返回 trace.mention_recorded=true）
curl -s -X POST http://127.0.0.1:5189/api/memories/search \
  -H 'Content-Type: application/json' \
  -d '{"owner_scope":"demo","query":"概率论 复习","top_k":3,"mention":true}'

# 7) 快照 + A/B 分支（复盘闭环）
SNAP=$(curl -s -X POST http://127.0.0.1:5189/api/decision/snapshot \
  -H 'Content-Type: application/json' -d '{"owner_scope":"demo"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['snapshot_id'])")
curl -s -X POST http://127.0.0.1:5189/api/decision/branches \
  -H 'Content-Type: application/json' \
  -d "{\"snapshot_id\":\"$SNAP\",\"question\":\"下周是否调整复习计划\",\"options\":[\"维持计划\",\"调整计划\"]}"
```

关键返回字段：

- `certified: true`：Top-K 成员已认证，且与全量精排一致；
- `results[].evidence`：内容、事件时间、有效期、来源、确认状态、版本；
- `results[].dims`：语义/实体/时间/重要度/可信度/本轮激活的分数（0–1）；
- `trace`：`candidates/pruned/iterations/exactRecoveries/blocksRead/bytesRead/fallback` 与完整 `actions` 列表，可复现。

---

## 三、接入现有网页端（久伴 / Memora 前端）

服务已开 CORS，网页端（如 `http://127.0.0.1:5188`）可以直接跨端口调用。

```bash
# 终端 2：启动原网页端
node serve.mjs            # → http://127.0.0.1:5188
```

在网页代码中（或浏览器控制台）使用：

```js
// 1) 动态加载服务端 SDK（无需复制文件）
const { MemoryClient } = await import('http://127.0.0.1:5189/memory-client.js');
const client = new MemoryClient('http://127.0.0.1:5189');
await client.health();                       // 确认已连接

// 2) 写入 + 确认
const { candidates } = await client.ingest({
  owner_scope: 'default',
  text: '记住：我下周三去图书馆还书',
  source_type: 'conversation',
});
await client.confirm(candidates[0].memory_id, 'confirm');

// 3) 检索证据（可在聊天前注入提示词）
const res = await client.search({ owner_scope: 'default', query: '还书 图书馆', top_k: 5 });
console.log(res.results, res.trace);

// 4) 决策快照/分支/结果
const snap = await client.snapshot({ owner_scope: 'default' });
const branches = await client.branches({ snapshot_id: snap.snapshot_id, question: '下周是否调整计划', options: ['维持', '调整'] });
```

如果想固定使用某个 owner 或服务地址，建议存在 localStorage：

```js
localStorage.setItem('jiuban.memory.serviceUrl', 'http://127.0.0.1:5189');
localStorage.setItem('jiuban.memory.ownerScope', 'default');
```

> 注意：现有网页端的记忆仍以 IndexedDB 为准；接服务是**可选增强**。建议先做“可用则同步、失败则降级本地”的开关。

---

## 四、接入日记模块

```js
const { MemoryClient } = await import('http://127.0.0.1:5189/memory-client.js');
const { createDiaryMemoryService } = await import('http://127.0.0.1:5189/diary-adapter.js');

const client = new MemoryClient('http://127.0.0.1:5189');
const diary = createDiaryMemoryService(client, { owner_scope: 'default' });

// 保存日记后调用（source_type='diary'，自动确认）
const saved = await diary.save({
  date: '2026-11-15',
  title: '联调记录',
  content: '今天项目联调遇到接口不一致，明天先和记忆库组对齐字段。',
});
if (!saved.ok) console.warn('记忆库不可用，保留本地日记即可', saved.error);

// 检索日记记忆（只返回 source_type=diary 的结果）
const hits = await diary.search('接口 联调', { top_k: 5 });

// 需要用户逐条确认时：
const { candidates } = await diary.extractCandidates('今天复习线性代数，矩阵分解不熟。');
```

推荐挂载点：`assets/js/diary-view.js` 保存/编辑日记成功之后；失败时只打印提示，不阻塞本地保存。
现成示例见 `memory-service/web/integration-example.js` 与 `memory-service/web/diary-adapter.js`。

---

## 五、自动测试（一条命令）

```bash
npm run memory:test
```

包含两部分，全部通过时最后输出：

```
8 checks passed      # 核心正确性
15 checks passed     # HTTP 集成
```

核心 8 项分别验证：

1. 120 条记忆索引与统计；
2. 4/8/16-bit 区间均覆盖精确分数（无越界）；
3. **认证 Top-K 与全量精排逐查询一致**（多查询 × K=1/3/5/10 × 两组权重）；
4. 主题提及只写激活审计、不改 `base_weight`/确认状态；
5. 过期计划不被当作当前事实（当前/历史查询行为不同）；
6. 确认提权、修正生成 v2 并取代旧版本；
7. 硬删除后不可检索且释放槽位；
8. 导出/导入可往返。

HTTP 15 项覆盖：健康、演示页、客户端脚本、CORS 预检、演示数据、写入/确认、认证检索、mention、快照、分支、404/400、删除。

### 调度基准

```bash
npm run memory:bench
```

本机示例（300 条记忆、60 查询、K=5、热缓存）：

```
认证率 100%，精确认证 Top-K 与全量精排一致率 100%，回退率 0%
平均动作 31.35，平均精确恢复 14.05 条，平均剪枝 293.55 条
平均块读取 0.08 块，平均读取 1793 字节
P50 1.76 ms，P95 2.83 ms
```

说明：热缓存下块读取接近 0 属正常；冷缓存/真实磁盘 I/O 需另行测量（见 README 第 6 节）。

---

## 六、手动验收清单（建议按顺序勾选）

- [ ] `node memory-service/server.mjs` 启动成功，`/api/health` 返回 `ok: true`
- [ ] 演示页可打开、状态显示“已连接”
- [ ] 「载入演示数据」得到 12 条；再次点击不重复写入（返回 `existing: true`）
- [ ] 写入一条文本 → 候选出现 → 点「确认」后状态变为 `confirmed`
- [ ] 检索返回 5 条结果，trace 中 `certified: true`
- [ ] 勾选“主题提及”检索后，记忆的 `base_weight`、`confirmation_state` 不变
- [ ] 过期计划在当前查询中得分低于当前计划；历史查询能找回
- [ ] 修正一条记忆 → 生成 v2，旧版本变为 `corrected`
- [ ] 删除一条记忆后检索不到，硬删除后 `slots` 数量减少
- [ ] 快照 + 分支接口返回 2 条分支，每个节点带 `evidence_ids`
- [ ] 日记保存后出现在“日记记忆列表”，按主题可检索
- [ ] 浏览器从 `http://127.0.0.1:5188` 调 5189 接口不被 CORS 拦截
- [ ] 导出 JSON 再导入，数据条数一致
- [ ] `npm run memory:test` 全部 PASS

---

## 七、网页端内置图形界面（已接入）

1. 终端 1：`node memory-service/server.mjs`（5189）
2. 终端 2：`node serve.mjs`（5188）
3. 浏览器打开 <http://127.0.0.1:5188/>，左侧导航点「记忆中心」，再选择「记忆库服务」。

页面能力：

- **连接与统计**：右上角输入服务地址（默认 `http://127.0.0.1:5189`），显示连接状态、活跃/已确认记忆数、块数与 I/O。
- **记忆操作**：写入（候选/直接确认）、确认、删除、刷新、载入演示数据；认证检索返回 Top-K、六维分数与可展开 trace。
- **日记同步**：一键读取浏览器 IndexedDB 中的日记并写入服务（`source_type=diary`，已同步的跳过）；按主题检索日记记忆。
- **自动测试**：8 项浏览器内测试（健康、候选确认、认证 Top-K、提及不落库、修正版本、快照分支、删除、日记适配），使用独立 scope 并在结束后清理。
- **使用说明**：AURORA 对应关系、启动命令与使用边界。

若页面显示“未连接”，说明记忆库服务没启动或端口不一致；启动后点「重试连接」即可。

## 八、排障

| 现象 | 处理 |
| --- | --- |
| `EADDRINUSE ... 5189` | 端口被占用：`lsof -nP -iTCP:5189 -sTCP:LISTEN` 找到 PID 并结束，或 `MEMORY_PORT=5190 node memory-service/server.mjs` |
| 页面显示“未连接” | 服务未启动/端口不同；检查浏览器地址是否为 `http://127.0.0.1:5189/`，或手动改 `window.MEMORY_SERVICE_URL` |
| `Cannot find module 'node:sqlite'` | Node 版本过低（需 ≥22.5）；`node --version` 查看，建议 Node 24 |
| 数据乱了/想重新演示 | 停止服务后 `rm -rf memory-service/data`，再启动 |
| 改了 `MEMORY_DIM` 后报错 | 维度变更与旧数据不兼容：删除 `memory-service/data` 重建 |
| 搜索没有结果 | 确认 `owner_scope` 一致（演示数据是 `demo`，默认客户端是 `default`）；先 seed 或写入再检索 |
| 想换真实语义嵌入 | 替换 `lib/vector.mjs` 的 `embed()`，保持维度一致或删除数据重建，并重跑 `memory:test` / `memory:bench` |
