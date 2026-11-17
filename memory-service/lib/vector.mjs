/**
 * vector.mjs — 轻量本地嵌入 + AURORA 式嵌套前缀量化与可靠区间
 *
 * AURORA-CAIR 的“多精度可靠区间”在本文件中的落地：
 *  - 每条记忆的精确向量（float32，L2 归一化）存入二进制块文件（L3）
 *  - 同一向量的 16-bit 量化码作为“完整编码”，4/8/16-bit 精度取同一编码的前缀，
 *    因此各级区间天然嵌套（低精度区间包含高精度区间），无需重复量化。
 *  - 量化使用 floor 映射，区间 [prefix*w, (prefix+1)*w] 保守覆盖真实值。
 *
 * 默认嵌入为确定性字符 n-gram 哈希（离线、零依赖），用于跑通与验收算法闭环；
 * 真实语义模型可替换 embed()，但必须保证入库与查询使用同一模型与维度。
 */

export const DIM = Number(process.env.MEMORY_DIM || 256);
export const MAX_CODE = 65535;

const STOPWORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '有', '和', '与', '就', '都', '也',
  '很', '还', '要', '会', '能', '去', '说', '一个', '一下', '什么', '怎么', '为什么', '因为', '所以', '然后',
  '可以', '没有', '不是', '自己', '现在', '今天', '觉得', '应该', '如果', '但是', '而且', '或者', '以及',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'it', 'this', 'that',
]);

function fnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 中文按字 + 二元组切分，英文/数字按词切分 */
export function tokenize(text) {
  const value = String(text || '').toLowerCase();
  const tokens = [];
  const latin = value.match(/[a-z][a-z0-9_+-]{1,}|[0-9]{2,4}/g) || [];
  for (const word of latin) {
    if (!STOPWORDS.has(word)) tokens.push({ term: word, weight: 1.0 });
  }
  for (const run of value.match(/[\u3400-\u9fff]+/g) || []) {
    for (let i = 0; i < run.length; i += 1) {
      if (run.length > 1 && !STOPWORDS.has(run[i])) tokens.push({ term: run[i], weight: 0.5 });
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (!STOPWORDS.has(bigram)) tokens.push({ term: bigram, weight: 1.0 });
    }
  }
  return tokens;
}

export function tokenSet(text) {
  return new Set(tokenize(text).map((t) => t.term));
}

/** 确定性哈希嵌入：字符 n-gram 累加到固定维度并 L2 归一化 */
export function embed(text) {
  const vec = new Float32Array(DIM);
  for (const { term, weight } of tokenize(text)) {
    const h1 = fnv1a(term);
    const idx = h1 % DIM;
    const sign = (fnv1a(`${term}#sign`) & 1) === 0 ? 1 : -1;
    vec[idx] += sign * weight;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < DIM; i += 1) vec[i] /= norm;
  return vec;
}

export function clamp01(x) { return Math.max(0, Math.min(1, x)); }

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i += 1) s += a[i] * b[i];
  return Math.max(-1, Math.min(1, s));
}

/** 16-bit 完整编码（floor，保证前缀区间包含真实值） */
export function encodeCode16(vec) {
  const out = new Uint16Array(DIM);
  for (let i = 0; i < DIM; i += 1) {
    const v = Math.max(-1, Math.min(1, vec[i]));
    const code = Math.floor(((v + 1) / 2) * 65536);
    out[i] = Math.min(MAX_CODE, Math.max(0, code));
  }
  return Buffer.from(out.buffer.slice(0));
}

export function decodeCode16(buf) {
  const copy = Buffer.from(buf);
  return new Uint16Array(copy.buffer, copy.byteOffset, DIM);
}

/** 取 16-bit 编码在指定精度的前缀：level 0=4bit, 1=8bit, 2=16bit */
export function codePrefix(u16, level) {
  const bits = [4, 8, 16][level];
  if (bits === 16) return u16;
  return u16 >>> (16 - bits);
}

/** 某一维在指定精度下的保守区间 */
export function intervalFor(u16, i, level) {
  const bits = [4, 8, 16][level];
  const shift = 16 - bits;
  const prefix = u16[i] >>> shift;
  const scale = 1 << bits;
  const lo = -1 + (prefix / scale) * 2;
  const hi = lo + 2 / scale;
  return [lo, Math.min(1, hi)];
}

/** 余弦相似度的可靠上下界（区间算术，权重即查询分量） */
export function cosineBounds(queryVec, code16, level) {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < DIM; i += 1) {
    const [a, b] = intervalFor(code16, i, level);
    const q = queryVec[i];
    const c1 = q * a;
    const c2 = q * b;
    lo += Math.min(c1, c2);
    hi += Math.max(c1, c2);
  }
  return [Math.max(-1, lo), Math.min(1, hi)];
}

export function memoryRowVector(row) {
  return new Float32Array(row.exact_vector);
}
