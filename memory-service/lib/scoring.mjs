/**
 * scoring.mjs — 可配置评分函数与可靠上下界
 *
 * 评分维度（AURORA 五维原型 + Memora 的本轮主题激活）：
 *  semantic（语义，需从压缩向量计算上下界）
 *  entity（实体/主题匹配，查元数据精确计算）
 *  time（时间有效性 + 衰减，精确计算）
 *  importance（记忆重要度，精确计算）
 *  trust（证据可信度，精确计算）
 *  activation（本轮主题激活，仅当前查询生效，不写长期状态）
 *
 * 所有维度归一化到 [0,1]，权重非负且和为 1。范围明细写入 trace 便于复核。
 */
import { clamp01, cosineBounds, tokenize } from './vector.mjs';

export const DEFAULT_WEIGHTS = {
  semantic: 0.40,
  entity: 0.15,
  time: 0.15,
  importance: 0.10,
  trust: 0.10,
  activation: 0.10,
};

export const SOURCE_TRUST = {
  manual: 0.9,
  diary: 0.85,
  review: 0.9,
  conversation: 0.7,
  extraction: 0.6,
  import: 0.7,
};

export const HALF_LIFE_DAYS = {
  episode: 180,
  fact: 300,
  preference: 360,
  relation: 420,
  goal: 120,
  reflection: 180,
};

const DAY = 86400000;

export function normalizeWeights(input) {
  const merged = { ...DEFAULT_WEIGHTS, ...(input || {}) };
  let sum = 0;
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    merged[key] = Math.max(0, Number(merged[key]) || 0);
    sum += merged[key];
  }
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(merged)) merged[key] /= sum;
  return merged;
}

function asSet(value) {
  if (Array.isArray(value)) return new Set(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }
  return new Set();
}

export function buildQueryContext({ query, now = Date.now(), timeIntent, weights, tokens }) {
  const terms = tokens || new Set(tokenize(query).map((t) => t.term));
  const intent = timeIntent || (/(以前|过去|当时|历史|那年|曾经)/.test(query) ? 'history' : 'current');
  return {
    query: String(query || ''),
    now,
    timeIntent: intent,
    weights: normalizeWeights(weights),
    terms,
  };
}

export function exactDims(row, ctx) {
  const topics = asSet(row.topics);
  const entities = asSet(row.entities);
  const qTerms = ctx.terms;

  let matched = 0;
  for (const term of qTerms) if (topics.has(term) || entities.has(term)) matched += 1;
  const entity = clamp01(matched / Math.max(1, Math.min(4, qTerms.size || 1)));
  // 本轮主题激活与实体匹配同源，但权重更低且只在本次查询中参与，不落库
  const activation = clamp01(matched / Math.max(1, Math.min(6, qTerms.size || 1))) * 0.6;

  const anchor = ctx.now;
  let validity = 1;
  if (row.valid_from != null && anchor < row.valid_from) validity = 0;
  if (row.valid_to != null && anchor > row.valid_to) validity = 0;
  const halfLife = HALF_LIFE_DAYS[row.memory_type] || 180;
  const last = row.last_confirmed_at ?? row.event_time ?? row.created_at ?? anchor;
  const ageDays = Math.max(0, (anchor - last) / DAY);
  const recency = Math.pow(0.5, ageDays / halfLife);
  let time;
  if (ctx.timeIntent === 'history') {
    time = 0.5 + 0.5 * validity;
  } else {
    time = 0.7 * validity + 0.3 * recency;
  }

  const importance = clamp01(Number(row.base_weight) || 0);
  const trust = SOURCE_TRUST[row.source_type] ?? 0.6;
  return { entity, time, importance, trust, activation };
}

function exactPart(dims, weights) {
  return (
    weights.entity * dims.entity +
    weights.time * dims.time +
    weights.importance * dims.importance +
    weights.trust * dims.trust +
    weights.activation * dims.activation
  );
}

/** 精确分数（语义使用已恢复的精确向量） */
export function exactScore(row, ctx, queryVec, semanticExact) {
  const dims = exactDims(row, ctx);
  const sem01 = (semanticExact + 1) / 2;
  const score = clamp01(exactPart(dims, ctx.weights) + ctx.weights.semantic * sem01);
  return { score, dims, semantic: sem01 };
}

/** 由压缩码与精确维度得到分数上下界 */
export function scoreBounds(row, ctx, queryVec, code16, level) {
  const dims = exactDims(row, ctx);
  const [cosLo, cosHi] = cosineBounds(queryVec, code16, level);
  const semLo = clamp01((cosLo + 1) / 2);
  const semHi = clamp01((cosHi + 1) / 2);
  const base = exactPart(dims, ctx.weights);
  const lower = clamp01(base + ctx.weights.semantic * semLo);
  const upper = clamp01(base + ctx.weights.semantic * semHi);
  return { lower, upper, dims, semanticBounds: [semLo, semHi] };
}
