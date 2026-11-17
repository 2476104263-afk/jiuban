/**
 * 核心正确性测试：精确认证 Top-K ≡ 全量精排；区间覆盖；时间语义；版本/删除；提及不落库
 * 运行：node memory-service/test/core.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../lib/store.mjs';
import { retrieve, bruteForce, checkBounds } from '../lib/retrieval.mjs';
import { embed } from '../lib/vector.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-memory-test-'));
const store = new MemoryStore({ dataDir: tmp });
const DAY = 86400000;
const now = Date.now();
let passed = 0;
const check = (label, fn) => {
  try { fn(); passed += 1; console.log(`PASS ${label}`); }
  catch (err) { console.error(`FAIL ${label}\n`, err.message); process.exitCode = 1; }
};

// ---------- 构造合成记忆 ----------
const topics = ['线性代数', '概率论', '项目', '复习', '室友', '导师', '跑步', '实习', '论文', '考试', '咖啡', '图书馆', '计划', '反馈', '英语', '编程'];
const verbs = ['反复出现', '已经完成', '计划下周', '不太顺利', '进展稳定', '有点担心', '需要加强', '暂时放下'];
const types = ['episode', 'fact', 'preference', 'goal', 'reflection'];
const sources = ['manual', 'diary', 'conversation', 'review'];
const inserted = [];
for (let i = 0; i < 120; i += 1) {
  const t1 = topics[i % topics.length];
  const t2 = topics[(i * 7 + 3) % topics.length];
  const v = verbs[(i * 3) % verbs.length];
  const content = `关于${t1}和${t2}：我${v}，这是第 ${i} 条记录。`;
  const type = types[i % types.length];
  const eventTime = now - ((i * 13) % 240) * DAY;
  const confirmed = i % 3 !== 0;
  const row = store.insertMemory({
    owner_scope: 'test',
    content,
    normalized_fact: content,
    event_time: eventTime,
    event_time_text: null,
    valid_from: type === 'goal' ? now - 30 * DAY : eventTime - DAY,
    valid_to: type === 'goal' ? now + 30 * DAY : eventTime + DAY,
    source_type: sources[i % sources.length],
    source_id: `src-${i}`,
    quote: content,
    memory_type: type,
    topics: [t1, t2],
    entities: [t1],
    base_weight: 0.4 + (i % 5) * 0.1,
    confidence: 0.6,
    confirmation_state: confirmed ? 'confirmed' : 'candidate',
  });
  inserted.push(row);
}

check('store stats: 120 memories indexed', () => {
  const s = store.statsSummary();
  assert.equal(s.total, 120);
  assert.equal(s.active, 120);
  assert.ok(s.blocks >= Math.ceil(120 / 16));
});

check('bounds cover exact scores at 4/8/16-bit', () => {
  for (const q of ['线性代数 复习 问题', '项目 进展 反馈', '室友 咖啡 图书馆']) {
    const violations = checkBounds(store, { query: q, owner_scope: 'test', now });
    assert.deepEqual(violations, [], JSON.stringify(violations.slice(0, 3)));
  }
});

check('certified Top-K equals brute force across queries/K/weights', () => {
  const queries = ['线性代数 复习 问题', '项目 进展 反馈', '室友 咖啡 图书馆', '考试 英语 计划', '实习 论文 导师'];
  const ks = [1, 3, 5, 10];
  const weightSets = [undefined, { semantic: 0.7, entity: 0.1, time: 0.05, importance: 0.05, trust: 0.05, activation: 0.05 }];
  for (const query of queries) {
    for (const top_k of ks) {
      for (const weights of weightSets) {
        const got = retrieve(store, { query, owner_scope: 'test', top_k, now, weights });
        const ref = bruteForce(store, { query, owner_scope: 'test', top_k, now, weights });
        assert.equal(got.certified, true, `not certified: ${query} k=${top_k}`);
        assert.deepEqual(got.results.map((r) => r.memory_id), ref.map((r) => r.memory_id),
          `mismatch ${query} k=${top_k}: ${got.results.map((r) => r.memory_id)} vs ${ref.map((r) => r.memory_id)}`);
        assert.ok(got.trace.exactRecoveries >= Math.min(top_k, 120));
        assert.ok(got.trace.bytesRead >= 0);
      }
    }
  }
});

check('mention only records activation, never changes long-term state', () => {
  const target = store.getMemory(inserted[1].memory_id);
  const before = { weight: target.base_weight, state: target.confirmation_state };
  const res = retrieve(store, { query: `线性代数 记录`, owner_scope: 'test', top_k: 5, now, mention: true });
  assert.ok(res.trace.mention_recorded);
  const after = store.getMemory(inserted[1].memory_id);
  assert.equal(after.base_weight, before.weight);
  assert.equal(after.confirmation_state, before.state);
  const acts = store.db.prepare('SELECT COUNT(*) AS c FROM activations').get().c;
  assert.ok(acts > 0);
});

check('expired plan is not treated as current fact', () => {
  const expired = store.insertMemory({
    owner_scope: 'test', content: '计划本学期每周复习线性代数三次', memory_type: 'goal',
    valid_from: now - 60 * DAY, valid_to: now - 30 * DAY, source_type: 'manual',
    topics: ['线性代数', '复习'], base_weight: 0.8, confirmation_state: 'confirmed',
    quote: '计划本学期每周复习线性代数三次',
  });
  const current = store.insertMemory({
    owner_scope: 'test', content: '计划下周开始复习线性代数矩阵分解', memory_type: 'goal',
    valid_from: now - DAY, valid_to: now + 30 * DAY, source_type: 'manual',
    topics: ['线性代数', '复习'], base_weight: 0.8, confirmation_state: 'confirmed',
    quote: '计划下周开始复习线性代数矩阵分解',
  });
  const cur = retrieve(store, { query: '线性代数 复习 计划', owner_scope: 'test', top_k: 10, now });
  const curIds = cur.results.map((r) => r.memory_id);
  assert.ok(curIds.includes(current.memory_id));
  const expiredRow = cur.results.find((r) => r.memory_id === expired.memory_id);
  const currentRow = cur.results.find((r) => r.memory_id === current.memory_id);
  assert.ok(currentRow.score > expiredRow.score, `current ${currentRow.score} should beat expired ${expiredRow.score}`);
  assert.equal(expiredRow.dims.time < currentRow.dims.time, true);
  const hist = retrieve(store, { query: '以前 线性代数 复习', owner_scope: 'test', top_k: 10, now, time_intent: 'history' });
  assert.ok(hist.results.some((r) => r.memory_id === expired.memory_id));
});

check('confirm bumps weight; correction creates version and supersedes old', () => {
  const scope = 'test-correct';
  const candidate = store.insertMemory({
    owner_scope: scope, content: '我下周开始准备概率论考试', memory_type: 'goal',
    source_type: 'conversation', topics: ['概率论', '考试'], base_weight: 0.5, confirmation_state: 'candidate',
    quote: '我下周开始准备概率论考试', valid_from: now, valid_to: now + 30 * DAY,
  });
  const confirmed = store.applyAction(candidate.memory_id, 'confirm');
  assert.equal(confirmed.memory.confirmation_state, 'confirmed');
  assert.ok(confirmed.memory.base_weight > candidate.base_weight);
  const corrected = store.applyAction(candidate.memory_id, 'correct', { content: '我改为下周开始准备概率论考试', valid_from: now, valid_to: now + 40 * DAY });
  assert.equal(corrected.memory.version, 2);
  assert.equal(corrected.memory.supersedes_id, candidate.memory_id);
  assert.equal(corrected.supersedes.confirmation_state, 'corrected');
  assert.ok(corrected.supersedes.valid_to <= Date.now());
  const res = retrieve(store, { query: '概率论 考试', owner_scope: scope, top_k: 5, now });
  const ids = res.results.map((r) => r.memory_id);
  assert.ok(ids.includes(corrected.memory.memory_id));
  const newRow = res.results.find((r) => r.memory_id === corrected.memory.memory_id);
  const oldRow = res.results.find((r) => r.memory_id === candidate.memory_id);
  if (oldRow) assert.ok(newRow.score > oldRow.score, 'corrected version should rank above superseded one');
});

check('hard delete removes from index and releases slot', () => {
  const victim = store.insertMemory({
    owner_scope: 'test', content: '临时记录：下周三去图书馆还书', memory_type: 'goal',
    source_type: 'manual', topics: ['图书馆', '还书'], confirmation_state: 'confirmed', quote: '临时记录：下周三去图书馆还书',
    valid_from: now, valid_to: now + 7 * DAY,
  });
  const beforeSlots = store.statsSummary().slots;
  const del = store.deleteMemory(victim.memory_id, { hard: true });
  assert.equal(del.released, true);
  const afterSlots = store.statsSummary().slots;
  assert.equal(afterSlots, beforeSlots - 1);
  const res = retrieve(store, { query: '图书馆 还书', owner_scope: 'test', top_k: 10, now });
  assert.ok(!res.results.some((r) => r.memory_id === victim.memory_id));
});

check('export/import round-trip', () => {
  const dump = store.exportAll('test');
  assert.ok(dump.memories.length >= 120);
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-memory-import-'));
  const store2 = new MemoryStore({ dataDir: tmp2 });
  const res = store2.importAll(dump);
  assert.ok(res.imported > 0);
  store2.close();
});

store.close();
console.log(`\n${passed} checks passed`);
