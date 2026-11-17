/**
 * retrieval.mjs — AURORA-CAIR 式“可靠区间 + 精确认证 + 自适应恢复”检索
 *
 * 流程（对应 AURORA 第 8 章伪代码）：
 *  1. 冻结查询与候选全集（范围、评分权重、时间基准、索引版本）
 *  2. 用 4-bit 前缀构造分数可靠区间
 *  3. 安全剪枝：上界低于当前第 K 大下界的候选不可能进入 Top-K
 *  4. 认证：Top-K 成员的最小下界严格大于外部最大上界 → 成员确定
 *  5. 恢复：CARS 在“单条/整块/多精度细化”动作中按收益/成本选择；无收益时安全回退
 *  6. 精确恢复最终 K 条并排序（并列按 memory_id 升序），返回带来源与 trace 的结果
 *
 * 本实现只对“语义”维度使用压缩区间；其余维度由元数据精确计算，因此上下界严格有效。
 */
import crypto from 'node:crypto';
import { DIM, embed, decodeCode16, cosine } from './vector.mjs';
import { buildQueryContext, exactScore, scoreBounds, normalizeWeights } from './scoring.mjs';

const EPS = 1e-12;
const L2_READ_BYTES = 16;
const CACHED_BLOCK_COST = 64;

function queryId() {
  return `q_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function sortByLower(list) {
  return [...list].sort((a, b) => (b.lower - a.lower) || String(a.row.memory_id).localeCompare(String(b.row.memory_id)));
}

function buildState(rows, ctx, qVec) {
  const state = rows.map((row) => {
    const code = decodeCode16(row.code16);
    const bounds = scoreBounds(row, ctx, qVec, code, 0);
    return {
      row,
      code,
      level: 0,
      exact: null,
      exactScore: null,
      lower: bounds.lower,
      upper: bounds.upper,
      dims: bounds.dims,
      semanticBounds: bounds.semanticBounds,
      pruned: false,
    };
  });
  return state;
}

function recomputeBounds(item, ctx, qVec) {
  if (item.exact != null) {
    item.lower = item.exactScore;
    item.upper = item.exactScore;
    return;
  }
  const bounds = scoreBounds(item.row, ctx, qVec, item.code, item.level);
  item.lower = bounds.lower;
  item.upper = bounds.upper;
  item.dims = bounds.dims;
  item.semanticBounds = bounds.semanticBounds;
}

function recoverExact(store, item, ctx, qVec, trace) {
  if (item.exact != null) return 0;
  const { vector, cached, bytesRead } = store.readExactVector(item.row.storage_slot);
  const cos = cosine(qVec, vector);
  const scored = exactScore(item.row, ctx, qVec, cos);
  item.exact = vector;
  item.exactScore = scored.score;
  item.dims = scored.dims;
  item.level = 3;
  item.lower = scored.score;
  item.upper = scored.score;
  trace.exactRecoveries += 1;
  if (!cached) { trace.blocksRead += 1; trace.bytesRead += bytesRead; }
  return cached ? CACHED_BLOCK_COST : bytesRead;
}

function exactAll(store, items, ctx, qVec, trace) {
  for (const item of items) recoverExact(store, item, ctx, qVec, trace);
}

function chooseAction(store, active, topK, ctx, qVec, trace) {
  const sorted = sortByLower(active);
  const kth = sorted[Math.min(topK, sorted.length) - 1].lower;
  const boundary = new Set();
  for (const item of sorted.slice(0, Math.max(topK * 2, topK + 2))) boundary.add(item);
  for (const item of sorted) if (item.upper >= kth) boundary.add(item);
  const candidates = [];
  const blockGroups = new Map();
  for (const item of boundary) {
    if (item.exact != null) continue;
    const width = Math.max(0, item.upper - item.lower);
    if (width <= EPS) continue;
    const blockId = Number(item.row.storage_block_id);
    if (!blockGroups.has(blockId)) blockGroups.set(blockId, []);
    blockGroups.get(blockId).push(item);
    if (item.level < 2) {
      const cost = L2_READ_BYTES * (item.level + 1);
      candidates.push({ type: 'refine', targets: [item], level: item.level + 1, benefit: width, cost });
    }
    const cached = store.blockCache.has(blockId);
    candidates.push({ type: 'exact', targets: [item], benefit: width, cost: cached ? CACHED_BLOCK_COST : 16384 });
  }
  for (const [blockId, items] of blockGroups) {
    if (items.length < 2) continue;
    const benefit = items.reduce((sum, i) => sum + Math.max(0, i.upper - i.lower), 0);
    const cost = store.blockCache.has(blockId) ? CACHED_BLOCK_COST : 16384;
    candidates.push({ type: 'exact_block', blockId, targets: items, benefit, cost });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.benefit / Math.max(1, b.cost)) - (a.benefit / Math.max(1, a.cost)) || b.benefit - a.benefit);
  return candidates[0];
}

function applyAction(store, action, ctx, qVec, trace) {
  const started = performance.now();
  let bytes = 0;
  if (action.type === 'refine') {
    for (const item of action.targets) {
      item.level = action.level;
      recomputeBounds(item, ctx, qVec);
    }
    bytes = L2_READ_BYTES * action.targets.length;
    trace.bytesRead += bytes;
  } else if (action.type === 'exact') {
    for (const item of action.targets) bytes += recoverExact(store, item, ctx, qVec, trace);
  } else if (action.type === 'exact_block') {
    for (const item of action.targets) bytes += recoverExact(store, item, ctx, qVec, trace);
  }
  trace.actions.push({
    type: action.type,
    level: action.level ?? null,
    block_id: action.blockId ?? action.targets[0]?.row.storage_block_id ?? null,
    targets: action.targets.map((t) => t.row.memory_id),
    benefit: Number(action.benefit.toFixed(6)),
    cost: action.cost,
    bytes,
    duration_ms: Number((performance.now() - started).toFixed(3)),
  });
}

/**
 * 执行一次认证检索。
 * @returns {{query_id:string, results:Array, trace:object, certified:boolean}}
 */
export function retrieve(store, {
  query,
  owner_scope = 'default',
  top_k = 5,
  now = Date.now(),
  time_intent,
  weights,
  mention = false,
  max_actions = 200,
} = {}) {
  const qid = queryId();
  const started = performance.now();
  const ctx = buildQueryContext({ query, now, timeIntent: time_intent, weights });
  const qVec = embed(query);
  const rows = store.candidates(owner_scope).filter((row) => {
    // 当前查询只使用当前有效/已确认版本；历史查询可找回被修正或过期的旧版本
    if (ctx.timeIntent === 'history') return row.confirmation_state !== 'retracted';
    return !['corrected', 'expired', 'retracted'].includes(row.confirmation_state);
  });
  const trace = {
    query_id: qid,
    query,
    owner_scope,
    top_k,
    candidates: rows.length,
    pruned: 0,
    actions: [],
    exactRecoveries: 0,
    blocksRead: 0,
    bytesRead: 0,
    iterations: 0,
    fallback: false,
    certified: false,
    weights: ctx.weights,
    time_intent: ctx.timeIntent,
    planning_ms: 0,
  };
  if (rows.length === 0 || top_k <= 0) {
    trace.certified = true;
    trace.planning_ms = Number((performance.now() - started).toFixed(3));
    store.logQuery(qid, query, owner_scope, top_k, [], trace);
    return { query_id: qid, results: [], trace, certified: true };
  }

  const state = buildState(rows, ctx, qVec);
  const k = Math.min(top_k, state.length);
  let certified = false;
  let resultItems = [];

  while (!certified) {
    const active = state.filter((s) => !s.pruned);
    if (active.length <= k) {
      exactAll(store, active, ctx, qVec, trace);
      certified = true;
      resultItems = active;
      break;
    }
    const sorted = sortByLower(active);
    const kth = sorted[k - 1].lower;
    let prunedNow = 0;
    for (const item of active) {
      if (item.upper < kth - EPS) { item.pruned = true; prunedNow += 1; }
    }
    trace.pruned += prunedNow;

    const remaining = state.filter((s) => !s.pruned);
    const ordered = sortByLower(remaining);
    const top = ordered.slice(0, k);
    const rest = ordered.slice(k);
    const maxUpperRest = rest.length ? Math.max(...rest.map((r) => r.upper)) : -Infinity;
    const minLowerTop = Math.min(...top.map((t) => t.lower));
    if (minLowerTop > maxUpperRest + EPS) {
      const useItems = [];
      for (const item of top) {
        if (item.exact == null) recoverExact(store, item, ctx, qVec, trace);
        useItems.push(item);
      }
      certified = true;
      resultItems = useItems;
      break;
    }

    // 所有剩余候选都已是精确分数：直接按并列规则排序即为认证结果（无需再恢复）
    if (remaining.every((item) => item.exact != null)) {
      remaining.sort((a, b) => {
        const diff = b.exactScore - a.exactScore;
        if (Math.abs(diff) > 1e-12) return diff;
        return String(a.row.memory_id).localeCompare(String(b.row.memory_id));
      });
      certified = true;
      resultItems = remaining.slice(0, k);
      trace.tie_resolved = true;
      break;
    }

    const action = chooseAction(store, remaining, k, ctx, qVec, trace);
    if (!action) {
      exactAll(store, remaining, ctx, qVec, trace);
      trace.fallback = true;
      certified = true;
      resultItems = remaining;
      break;
    }
    applyAction(store, action, ctx, qVec, trace);
    trace.iterations += 1;
    if (trace.iterations >= max_actions) {
      exactAll(store, state.filter((s) => !s.pruned), ctx, qVec, trace);
      trace.fallback = true;
      certified = true;
      resultItems = state.filter((s) => !s.pruned);
      break;
    }
  }

  // 最终排序：精确分数降序、memory_id 升序（与全量参考一致）
  resultItems.sort((a, b) => {
    const diff = (b.exactScore ?? b.lower) - (a.exactScore ?? a.lower);
    if (Math.abs(diff) > 1e-12) return diff;
    return String(a.row.memory_id).localeCompare(String(b.row.memory_id));
  });
  const results = resultItems.slice(0, k).map((item) => ({
    memory_id: item.row.memory_id,
    score: Number((item.exactScore ?? item.lower).toFixed(6)),
    certified: true,
    evidence: {
      quote: item.row.quote,
      content: item.row.content,
      event_time: item.row.event_time,
      event_time_text: item.row.event_time_text,
      valid_from: item.row.valid_from,
      valid_to: item.row.valid_to,
      source_type: item.row.source_type,
      source_id: item.row.source_id,
      confirmation_state: item.row.confirmation_state,
      version: item.row.version,
      memory_type: item.row.memory_type,
      topics: item.row.topics ? JSON.parse(item.row.topics) : [],
    },
    dims: item.dims,
    semantic_bounds: item.semanticBounds,
  }));

  // 主题提及：只记录本轮激活事件，不修改长期权重/确认状态
  if (mention) {
    store.logActivations(qid, results.map((r) => r.memory_id), results.map((r) => r.dims.activation));
    trace.mention_recorded = true;
  }

  trace.planning_ms = Number((performance.now() - started).toFixed(3));
  trace.certified = certified;
  trace.result_ids = results.map((r) => r.memory_id);
  store.logQuery(qid, query, owner_scope, top_k, results, trace);
  return { query_id: qid, results, trace, certified };
}

/** 全量精确参考实现（测试/基线用） */
export function bruteForce(store, { query, owner_scope = 'default', top_k = 5, now = Date.now(), time_intent, weights } = {}) {
  const ctx = buildQueryContext({ query, now, timeIntent: time_intent, weights });
  const qVec = embed(query);
  const scored = [];
  for (const row of store.candidates(owner_scope)) {
    const { vector } = store.readExactVector(row.storage_slot);
    const cos = cosine(qVec, vector);
    const { score } = exactScore(row, ctx, qVec, cos);
    scored.push({ memory_id: row.memory_id, score });
  }
  scored.sort((a, b) => (b.score - a.score) || String(a.memory_id).localeCompare(String(b.memory_id)));
  return scored.slice(0, Math.min(top_k, scored.length));
}

/** 检查每个候选在给定精度下的区间是否覆盖精确分数（测试用） */
export function checkBounds(store, { query, owner_scope = 'default', now = Date.now(), time_intent, weights, levels = [0, 1, 2] } = {}) {
  const ctx = buildQueryContext({ query, now, timeIntent: time_intent, weights });
  const qVec = embed(query);
  const violations = [];
  for (const row of store.candidates(owner_scope)) {
    const code = decodeCode16(row.code16);
    const { vector } = store.readExactVector(row.storage_slot);
    const cos = cosine(qVec, vector);
    const exact = exactScore(row, ctx, qVec, cos).score;
    for (const level of levels) {
      const { lower, upper } = scoreBounds(row, ctx, qVec, code, level);
      if (lower > exact + 1e-9 || upper < exact - 1e-9) {
        violations.push({ memory_id: row.memory_id, level, lower, exact, upper });
      }
    }
  }
  return violations;
}
