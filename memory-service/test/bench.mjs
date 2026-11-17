/**
 * 调度性能与正确性基准（AURORA 阶段 A/B 的最小可复现版本）
 * 运行：node memory-service/test/bench.mjs
 * 输出：认证一致率、动作数、精确恢复数、块读取与字节数、P50/P95 延迟
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../lib/store.mjs';
import { retrieve, bruteForce } from '../lib/retrieval.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-bench-'));
const store = new MemoryStore({ dataDir: tmp });
const now = Date.now();
const DAY = 86400000;
const topics = ['线性代数', '概率论', '项目', '复习', '室友', '导师', '跑步', '实习', '论文', '考试', '咖啡', '图书馆', '计划', '反馈', '英语', '编程', '矩阵', '实验', '简历', '听力'];
const verbs = ['反复出现', '已经完成', '计划下周', '不太顺利', '进展稳定', '有点担心', '需要加强', '暂时放下'];
const kinds = ['episode', 'fact', 'preference', 'goal', 'reflection'];
const sources = ['manual', 'diary', 'conversation', 'review'];
const N = Number(process.env.BENCH_N || 300);
for (let i = 0; i < N; i += 1) {
  const a = topics[i % topics.length];
  const b = topics[(i * 7 + 5) % topics.length];
  const content = `${a}与${b}：我${verbs[(i * 3) % verbs.length]}，第 ${i} 条记录。`;
  const eventTime = now - ((i * 13) % 240) * DAY;
  const type = kinds[i % kinds.length];
  store.insertMemory({
    owner_scope: 'bench',
    content,
    event_time: eventTime,
    memory_type: type,
    topics: [a, b],
    entities: [a, b],
    source_type: sources[i % sources.length],
    source_id: `src-${i}`,
    quote: content,
    base_weight: 0.4 + (i % 5) * 0.1,
    confirmation_state: i % 3 === 0 ? 'candidate' : 'confirmed',
    valid_from: type === 'goal' ? now - 30 * DAY : eventTime - DAY,
    valid_to: type === 'goal' ? now + 30 * DAY : eventTime + DAY,
  });
}
const queries = [];
for (let i = 0; i < 60; i += 1) {
  const a = topics[i % topics.length];
  const b = topics[(i * 11 + 3) % topics.length];
  queries.push(`${a} ${b} ${i % 2 === 0 ? '问题' : '计划'}`);
}
const rows = [];
let mismatches = 0;
let certified = 0;
const latencies = [];
for (const q of queries) {
  const t0 = performance.now();
  const got = retrieve(store, { query: q, owner_scope: 'bench', top_k: 5, now });
  const ms = performance.now() - t0;
  const ref = bruteForce(store, { query: q, owner_scope: 'bench', top_k: 5, now });
  if (got.certified) certified += 1;
  const same = got.results.map((r) => r.memory_id).join(',') === ref.map((r) => r.memory_id).join(',');
  if (!same) mismatches += 1;
  latencies.push(ms);
  const t = got.trace;
  rows.push({ ms, actions: t.actions.length, exact: t.exactRecoveries, blocks: t.blocksRead, bytes: t.bytesRead, pruned: t.pruned, fallback: t.fallback });
}
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };
const summary = {
  memories: N,
  queries: queries.length,
  certified_rate: `${((certified / queries.length) * 100).toFixed(1)}%`,
  exact_topk_match_rate: `${(((queries.length - mismatches) / queries.length) * 100).toFixed(1)}%`,
  fallback_rate: `${((rows.filter((r) => r.fallback).length / rows.length) * 100).toFixed(1)}%`,
  avg_actions: avg(rows.map((r) => r.actions)).toFixed(2),
  avg_exact_recoveries: avg(rows.map((r) => r.exact)).toFixed(2),
  avg_pruned: avg(rows.map((r) => r.pruned)).toFixed(2),
  avg_blocks_read: avg(rows.map((r) => r.blocks)).toFixed(2),
  avg_bytes_read: Math.round(avg(rows.map((r) => r.bytes))),
  latency_ms: { p50: pct(latencies, 0.5).toFixed(2), p95: pct(latencies, 0.95).toFixed(2), avg: avg(latencies).toFixed(2) },
};
console.log(JSON.stringify(summary, null, 2));
store.close();
