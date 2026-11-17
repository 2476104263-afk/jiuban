/**
 * server.mjs — Memora 记忆库 HTTP 服务（零外部依赖，Node ≥ 22.5 的 node:sqlite）
 *
 * 运行：node memory-service/server.mjs
 * 默认：http://127.0.0.1:5189  （演示页在 /，客户端脚本在 /memory-client.js）
 *
 * 该服务实现 AURORA-CAIR 的“可靠区间 + 精确认证 + 自适应恢复”检索，
 * 同时提供 Memora 记忆库的创建、确认、修正、删除、快照、复盘写回等接口。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MemoryStore } from './lib/store.mjs';
import { extractCandidates, extractWithLLM } from './lib/extract.mjs';
import { retrieve } from './lib/retrieval.mjs';
import { DIM } from './lib/vector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function serializeMemory(memory) {
  if (!memory) return null;
  const { code16, ...rest } = memory;
  return rest;
}

function localBranches(store, snapshot, question, options) {
  const scope = snapshot.owner_scope;
  const anchor = snapshot.payload.time_anchor || Date.now();
  const evidence = retrieve(store, { query: question, owner_scope: scope, top_k: 5, now: anchor }).results;
  const evidenceIds = evidence.map((r) => r.memory_id);
  return options.map((option, index) => ({
    branch_id: `branch_${index + 1}`,
    choice_condition: option,
    snapshot_id: snapshot.snapshot_id,
    disclaimer: '以下为条件化情景推演，不是对未来的预测；证据来自本机记忆，假设与未知项需用户判断。',
    nodes: [
      {
        node_id: `node_${index + 1}_1`,
        stage: '近期（1—2 周）',
        narrative: `如果按“${option}”推进，在现有记忆与资源条件不变的前提下，近期更可能先处理已经记录过的任务与限制；旧计划若已过期，需要重新确认。`,
        evidence_ids: evidenceIds.slice(0, 3),
        assumptions: ['外部时间与精力投入与记录一致', '记忆中的计划仍然有效或可修订'],
        risks: ['旧事实被误当成当前状态', '投入不足导致节奏中断'],
        unknowns: ['实际执行节奏', '外部变化'],
        review_prompt: '两周后记录实际投入、完成度与主观感受，用于复盘。',
      },
      {
        node_id: `node_${index + 1}_2`,
        stage: '中期（1—3 个月）',
        narrative: `若“${option}”持续，可能形成与记录中的偏好、目标或限制相关的分化路径；请用后续真实结果修订记忆，而不是接受系统断言。`,
        evidence_ids: evidenceIds.slice(0, 5),
        assumptions: ['用户持续记录真实结果', '模型只基于允许记忆生成'],
        risks: ['把情景当成预测', '忽略未记录的外部因素'],
        unknowns: ['更长期的外部条件', '用户偏好变化'],
        review_prompt: '记录阶段性结果并补充一条复盘记忆。',
      },
    ],
  }));
}

export function createServer({ store, dataDir } = {}) {
  const db = store || new MemoryStore({ dataDir });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = decodeURIComponent(url.pathname);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    try {
      // ---------- 静态演示页 ----------
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const file = path.join(WEB_DIR, 'demo.html');
        sendText(res, 200, fs.readFileSync(file), 'text/html; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && /^\/(memory-client\.js|diary-adapter\.js|integration-example\.js|demo\.js)$/.test(pathname)) {
        const file = path.join(WEB_DIR, pathname.slice(1));
        sendText(res, 200, fs.readFileSync(file), 'text/javascript; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }

      // ---------- 健康与统计 ----------
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true, service: 'memora-memory-service', version: '1.0.0', dim: DIM, storage: db.statsSummary() });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/stats') {
        sendJson(res, 200, db.statsSummary());
        return;
      }

      // ---------- 记忆写入 ----------
      if (req.method === 'POST' && pathname === '/api/memories/ingest') {
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        if (!text) { sendJson(res, 400, { error: 'text is required' }); return; }
        let candidates = null;
        let method = 'local_rules';
        if (body.llm?.apiKey) {
          candidates = await extractWithLLM({
            text,
            apiKey: body.llm.apiKey,
            baseUrl: body.llm.baseUrl,
            model: body.llm.model,
            now: body.now,
            source_type: body.source_type,
            source_id: body.source_id,
          });
          if (candidates) method = 'llm';
        }
        if (!candidates) {
          candidates = extractCandidates({
            text,
            source_type: body.source_type,
            source_id: body.source_id,
            now: body.now,
            autoConfirm: Boolean(body.auto_confirm),
          });
        }
        const inserted = candidates.map((c) => serializeMemory(db.insertMemory({
          ...c,
          owner_scope: body.owner_scope || 'default',
          confirmation_state: body.auto_confirm ? 'confirmed' : (c.confirmation_state || 'candidate'),
          ...(body.auto_confirm ? {} : {}),
        })));
        sendJson(res, 201, { extraction: method, candidates: inserted });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/memories/confirm') {
        const body = await readBody(req);
        if (!body.memory_id) { sendJson(res, 400, { error: 'memory_id is required' }); return; }
        const result = db.applyAction(body.memory_id, body.action || 'confirm', body.patch || {});
        sendJson(res, 200, { memory: serializeMemory(result.memory), supersedes: serializeMemory(result.supersedes) });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/memories') {
        const memories = db.listMemories({
          owner_scope: url.searchParams.get('owner_scope') || undefined,
          includeDeleted: url.searchParams.get('include_deleted') === '1',
          limit: Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200)),
        }).map(serializeMemory);
        sendJson(res, 200, { memories });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/memories/search') {
        const body = await readBody(req);
        if (!body.query) { sendJson(res, 400, { error: 'query is required' }); return; }
        const result = retrieve(db, {
          query: body.query,
          owner_scope: body.owner_scope || 'default',
          top_k: Number(body.top_k) || 5,
          now: body.now || Date.now(),
          time_intent: body.time_intent,
          weights: body.weights,
          mention: Boolean(body.mention),
        });
        sendJson(res, 200, result);
        return;
      }

      const memoryMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
      if (memoryMatch) {
        const memoryId = memoryMatch[1];
        if (req.method === 'GET') {
          const memory = db.getMemory(memoryId);
          if (!memory) { sendJson(res, 404, { error: 'memory not found' }); return; }
          sendJson(res, 200, serializeMemory(memory));
          return;
        }
        if (req.method === 'DELETE') {
          const result = db.deleteMemory(memoryId, { hard: url.searchParams.get('hard') === '1' });
          if (!result) { sendJson(res, 404, { error: 'memory not found' }); return; }
          sendJson(res, 200, { ...result, memory: serializeMemory(result.memory) });
          return;
        }
      }

      // ---------- 决策复盘 ----------
      if (req.method === 'POST' && pathname === '/api/decision/snapshot') {
        const body = await readBody(req);
        const ownerScope = body.owner_scope || 'default';
        const memories = db.listMemories({ owner_scope: ownerScope, limit: 500 });
        const payload = {
          owner_scope: ownerScope,
          time_anchor: body.now || Date.now(),
          memory_ids: (body.memory_ids || memories.map((m) => m.memory_id)).slice(0, 100),
          memory_versions: Object.fromEntries(memories.map((m) => [m.memory_id, m.version])),
          weights: body.weights || null,
          dim: DIM,
        };
        const snapshot = db.createSnapshot(ownerScope, payload);
        sendJson(res, 201, snapshot);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/decision/branches') {
        const body = await readBody(req);
        const snapshot = db.getSnapshot(body.snapshot_id);
        if (!snapshot) { sendJson(res, 404, { error: 'snapshot not found' }); return; }
        const question = String(body.question || '是否调整当前计划');
        const options = Array.isArray(body.options) && body.options.length >= 2 ? body.options.slice(0, 4) : ['维持当前计划', '调整当前计划'];
        const branches = localBranches(db, snapshot, question, options);
        sendJson(res, 200, { snapshot_id: snapshot.snapshot_id, question, branches });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/reviews/outcome') {
        const body = await readBody(req);
        db.addOutcome({
          decision_id: body.decision_id,
          branch_id: body.branch_id,
          content: body.content,
          event_time: body.event_time,
          confirmed: body.confirmed,
        });
        sendJson(res, 201, { ok: true });
        return;
      }

      // ---------- 导入导出 ----------
      if (req.method === 'POST' && pathname === '/api/export') {
        const body = await readBody(req);
        sendJson(res, 200, db.exportAll(body.owner_scope));
        return;
      }
      if (req.method === 'POST' && pathname === '/api/import') {
        const body = await readBody(req);
        sendJson(res, 200, db.importAll(body));
        return;
      }

      // ---------- 演示数据 ----------
      if (req.method === 'POST' && pathname === '/api/demo/seed') {
        const body = await readBody(req);
        const ownerScope = body.owner_scope || 'demo';
        const existing = db.listMemories({ owner_scope: ownerScope, limit: 1 });
        if (existing.length > 0 && !body.force) {
          sendJson(res, 200, { seeded: 0, owner_scope: ownerScope, existing: true, hint: '该 scope 已有记忆；如需重复写入请传 force=true' });
          return;
        }
        const now = Date.now();
        const DAY = 86400000;
        const samples = [
          ['今天复习线性代数，矩阵分解还是不太熟，做题错了 3 道。', 'episode', ['线性代数', '复习'], now - 2 * DAY, 'diary'],
          ['计划下周开始每周三、周日复习线性代数，每次 90 分钟。', 'goal', ['线性代数', '计划'], now - 1 * DAY, 'manual'],
          ['我更习惯上午学新内容，晚上复习。', 'preference', ['学习习惯', '复习'], now - 30 * DAY, 'manual'],
          ['上次室友约我去图书馆，我因为赶项目没去，有点内疚。', 'relation', ['室友', '图书馆'], now - 9 * DAY, 'conversation'],
          ['概率论考试定在下个月 15 号，需要提前两周开始准备。', 'goal', ['概率论', '考试'], now - 3 * DAY, 'manual'],
          ['导师建议把项目范围先收窄到一个可演示的闭环。', 'fact', ['导师', '项目'], now - 6 * DAY, 'conversation'],
          ['实习申请被拒了，复盘发现简历里的项目描述太泛。', 'reflection', ['实习', '简历'], now - 20 * DAY, 'diary'],
          ['计划每周跑步 3 次，每次 30 分钟，但连续两周没完成。', 'goal', ['跑步', '计划'], now - 15 * DAY, 'diary'],
          ['我喜欢用番茄钟，45 分钟一个周期比较适合我。', 'preference', ['时间管理'], now - 45 * DAY, 'manual'],
          ['论文开题报告已经写完了，接下来需要做实验。', 'episode', ['论文', '实验'], now - 5 * DAY, 'diary'],
          ['项目需要做一个 A/B 分支的演示，证据引用必须可追溯。', 'goal', ['项目', '演示'], now - 4 * DAY, 'manual'],
          ['英语听力每天 20 分钟，坚持了 10 天。', 'episode', ['英语', '听力'], now - 7 * DAY, 'diary'],
        ];
        let count = 0;
        for (const [content, type, topics, eventTime, source] of samples) {
          const validTo = type === 'goal' ? eventTime + 60 * DAY : eventTime + DAY;
          db.insertMemory({
            owner_scope: ownerScope,
            content,
            normalized_fact: content,
            event_time: eventTime,
            memory_type: type,
            topics,
            entities: topics,
            source_type: source,
            quote: content,
            base_weight: 0.6,
            confidence: 0.8,
            confirmation_state: 'confirmed',
            valid_from: type === 'goal' ? eventTime : eventTime - DAY,
            valid_to: type === 'goal' ? validTo : null,
          });
          count += 1;
        }
        sendJson(res, 201, { seeded: count, owner_scope: ownerScope });
        return;
      }

      sendJson(res, 404, { error: 'not found', path: pathname });
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'bad request' });
    }
  });
  server.on('close', () => { try { db.close(); } catch {} });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.MEMORY_PORT || 5189);
  const host = process.env.MEMORY_HOST || '127.0.0.1';
  const store = new MemoryStore({ dataDir: process.env.MEMORY_DATA_DIR });
  const server = createServer({ store });
  server.listen(port, host, () => {
    console.log(`Memora 记忆库服务已启动：http://${host}:${port}`);
    console.log(`演示页：http://${host}:${port}/`);
    console.log(`健康检查：http://${host}:${port}/api/health`);
    console.log('按 Ctrl+C 停止');
  });
}
