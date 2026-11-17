/**
 * HTTP 集成测试：服务启动、CORS、写入/确认/检索、静态演示页、错误处理
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../lib/store.mjs';
import { createServer } from '../server.mjs';
import { bruteForce } from '../lib/retrieval.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-server-test-'));
const store = new MemoryStore({ dataDir: tmp });
const server = createServer({ store });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
let passed = 0;
const check = (label, fn) => {
  try { fn(); passed += 1; console.log(`PASS ${label}`); }
  catch (err) { console.error(`FAIL ${label}\n`, err.message); process.exitCode = 1; }
};
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text(), headers: r.headers }; };
const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null), headers: r.headers }; };

const health = await get('/api/health');
check('health ok', () => { assert.equal(health.status, 200); const j = JSON.parse(health.text); assert.equal(j.ok, true); });
const demo = await get('/');
check('demo page served', () => { assert.equal(demo.status, 200); assert.ok(demo.text.includes('Memora 记忆库服务')); });
const clientJs = await get('/memory-client.js');
check('client module served', () => { assert.equal(clientJs.status, 200); assert.ok(clientJs.text.includes('class MemoryClient')); });
const preflight = await fetch(base + '/api/memories/search', { method: 'OPTIONS' });
check('CORS preflight', () => { assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), '*'); });

const seed = await post('/api/demo/seed', { owner_scope: 'demo' });
check('demo seed', () => { assert.equal(seed.status, 201); assert.equal(seed.json.seeded, 12); });

const ingest = await post('/api/memories/ingest', { owner_scope: 'demo', text: '记住：我下周三要去图书馆还书，顺便复习概率论。', auto_confirm: true });
check('ingest with auto confirm', () => {
  assert.equal(ingest.status, 201);
  assert.ok(ingest.json.candidates.length >= 1);
  assert.equal(ingest.json.candidates[0].confirmation_state, 'confirmed');
});

const candidate = await post('/api/memories/ingest', { owner_scope: 'demo', text: '我打算下周开始每天练习英语听力 20 分钟。' });
check('ingest candidate pending confirm', () => {
  assert.equal(candidate.json.candidates.length, 1);
  assert.equal(candidate.json.candidates[0].confirmation_state, 'candidate');
});
const confirm = await post('/api/memories/confirm', { memory_id: candidate.json.candidates[0].memory_id, action: 'confirm' });
check('confirm candidate', () => { assert.equal(confirm.json.memory.confirmation_state, 'confirmed'); });

const search = await post('/api/memories/search', { query: '线性代数 复习 问题', owner_scope: 'demo', top_k: 5 });
check('search certified and exact', () => {
  assert.equal(search.status, 200);
  assert.equal(search.json.certified, true);
  assert.ok(search.json.results.length > 0);
  const ref = bruteForce(store, { query: '线性代数 复习 问题', owner_scope: 'demo', top_k: 5 });
  assert.deepEqual(search.json.results.map((r) => r.memory_id), ref.map((r) => r.memory_id));
});

const mention = await post('/api/memories/search', { query: '线性代数', owner_scope: 'demo', top_k: 3, mention: true });
check('mention recorded in trace', () => { assert.equal(mention.json.trace.mention_recorded, true); });

const snapshot = await post('/api/decision/snapshot', { owner_scope: 'demo' });
check('snapshot created', () => { assert.equal(snapshot.json.snapshot_id?.startsWith('snap_'), true); });
const branches = await post('/api/decision/branches', { snapshot_id: snapshot.json.snapshot_id, question: '下周是否调整复习计划', options: ['维持计划', '调整计划'] });
check('branches generated with evidence', () => {
  assert.equal(branches.status, 200);
  assert.equal(branches.json.branches.length, 2);
  assert.ok(branches.json.branches[0].nodes[0].evidence_ids.length > 0);
});

const notFound = await get('/api/memories/not-exist');
check('404 for missing memory', () => { assert.equal(notFound.status, 404); });
const badBody = await post('/api/memories/search', {});
check('400 for missing query', () => { assert.equal(badBody.status, 400); });

const del = await fetch(`${base}/api/memories/${encodeURIComponent(candidate.json.candidates[0].memory_id)}?hard=1`);
check('delete endpoint', () => { assert.equal(del.status, 200); });

server.close();
store.close();
console.log(`\n${passed} checks passed`);
