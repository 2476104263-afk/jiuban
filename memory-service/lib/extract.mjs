/**
 * extract.mjs — 记忆候选抽取（本地规则 + 可选 LLM）
 *
 * 设计取舍：本地规则保证离线可运行、可测试；配置 DeepSeek Key 时优先调用 LLM
 * 抽取结构化字段，失败自动回退本地规则。抽取结果一律是 candidate，需用户确认。
 */
import { tokenize } from './vector.mjs';

const DAY = 86400000;

const MEMORY_TYPES = ['episode', 'fact', 'preference', 'relation', 'goal', 'reflection'];
const TYPE_RULES = [
  ['goal', /计划|打算|准备|将要|目标|安排|下周|明天|下个月|下学期/],
  ['preference', /喜欢|偏好|习惯|讨厌|不喜欢|更愿意|倾向/],
  ['reflection', /反思|复盘|总结|意识到|学到/],
  ['episode', /完成|做了|去了|发生|上次|昨天|今天|上周|见过|聊过/],
];

export function detectType(text) {
  for (const [type, re] of TYPE_RULES) if (re.test(text)) return type;
  return 'fact';
}

function ymdToMs(y, m, d) {
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

/** 解析“今天/昨天/上周/3月5日/2026-03-05”等相对/绝对时间 */
export function parseWhen(text, now = Date.now()) {
  const base = new Date(now);
  let m;
  if ((m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) {
    return { ts: ymdToMs(Number(m[1]), Number(m[2]), Number(m[3])), raw: m[0] };
  }
  if ((m = text.match(/(\d{1,2})月(\d{1,2})[日号]/))) {
    return { ts: ymdToMs(base.getFullYear(), Number(m[1]), Number(m[2])), raw: m[0] };
  }
  const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
  const weekdayMatch = text.match(/(上|下|本|这)?周([一二三四五六日天])/);
  if (weekdayMatch) {
    const offsetWeeks = weekdayMatch[1] === '上' ? -1 : weekdayMatch[1] === '下' ? 1 : 0;
    const day = base.getDay();
    const monday = new Date(base);
    monday.setDate(base.getDate() - ((day + 6) % 7));
    const target = new Date(monday);
    target.setDate(monday.getDate() + offsetWeeks * 7 + ((WEEKDAY[weekdayMatch[2]] ?? 1) + 6) % 7);
    if (!weekdayMatch[1] && target.getTime() < new Date(now).setHours(0, 0, 0, 0)) {
      target.setDate(target.getDate() + 7);
    }
    target.setHours(12, 0, 0, 0);
    return { ts: target.getTime(), raw: weekdayMatch[0] };
  }
  const rel = [
    ['今天', 0], ['昨天', -1], ['前天', -2], ['明天', 1], ['后天', 2],
    ['上周', -7], ['下周', 7], ['上个月', -30], ['下个月', 30], ['去年', -365],
  ];
  for (const [word, delta] of rel) {
    if (text.includes(word)) return { ts: now + delta * DAY, raw: word };
  }
  if (/今年/.test(text)) return { ts: now, raw: '今年' };
  return { ts: null, raw: null };
}

function splitSentences(text) {
  const parts = String(text || '')
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (parts.length === 0 && String(text || '').trim()) parts.push(String(text).trim());
  return parts.slice(0, 8);
}

function topTopics(sentence, n = 8) {
  const counts = new Map();
  for (const { term, weight } of tokenize(sentence)) {
    if (term.length < 2) continue;
    counts.set(term, (counts.get(term) || 0) + weight);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

/**
 * 本地规则抽取：返回候选记忆数组（未持久化）
 * @param {{text:string, source_type?:string, source_id?:string, now?:number, autoConfirm?:boolean}} input
 */
export function extractCandidates(input) {
  const now = input.now || Date.now();
  const text = String(input.text || '').trim();
  if (!text) return [];
  const sourceType = input.source_type || 'manual';
  const explicit = /记住|记一下|记下|帮我记/.test(text);
  const correction = /更正|改一下|改为|改成|不是.*而是|已经结束|结束了/.test(text);
  const sentences = splitSentences(text);
  const candidates = [];
  for (const sentence of sentences) {
    const type = detectType(sentence);
    const when = parseWhen(sentence, now);
    const topics = topTopics(sentence);
    const isPlan = type === 'goal';
    const isEpisode = type === 'episode';
    let validFrom = null;
    let validTo = null;
    if (isPlan) {
      validFrom = when.ts && when.ts > now ? when.ts : now;
      validTo = validFrom + 60 * DAY;
    } else if (isEpisode) {
      const t = when.ts || now;
      validFrom = t - DAY;
      validTo = t + DAY;
    }
    candidates.push({
      content: sentence,
      normalized_fact: sentence,
      memory_type: type,
      event_time: when.ts,
      event_time_text: when.raw,
      valid_from: validFrom,
      valid_to: validTo,
      source_type: sourceType,
      source_id: input.source_id || null,
      quote: sentence,
      topics,
      entities: topics.slice(0, 4),
      base_weight: explicit ? 0.7 : isEpisode ? 0.55 : 0.6,
      confidence: explicit ? 0.7 : when.ts ? 0.62 : 0.55,
      confirmation_state: input.autoConfirm ? 'confirmed' : 'candidate',
      suggested_action: correction ? 'correct' : 'confirm',
      extraction: { method: 'local_rules', explicit, correction },
    });
    if (candidates.length >= 6) break;
  }
  return candidates;
}

/**
 * 可选 LLM 抽取（DeepSeek 兼容接口）。不保存 Key；失败返回 null 由调用方回退。
 * @param {{text:string, apiKey:string, baseUrl?:string, model?:string, now?:number}} opts
 */
export async function extractWithLLM(opts) {
  const { text, apiKey } = opts;
  if (!apiKey) return null;
  const baseUrl = (opts.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = opts.model || 'deepseek-chat';
  const now = opts.now || Date.now();
  const prompt = `你是长期记忆抽取器。请把输入文本拆成 1-6 条可独立确认的记忆，输出 JSON 对象：
{"memories":[{"content":"原文最小句子","normalized_fact":"规范化事实","memory_type":"episode|fact|preference|relation|goal|reflection","event_time":"ISO8601 或 null","valid_from":"ISO8601 或 null","valid_to":"ISO8601 或 null","topics":["..."],"entities":["..."],"confidence":0-1,"quote":"原文片段"}]}
规则：不要编造文本没有的信息；时间无法确定填 null；不确定真假的内容保持 fact；只输出 JSON。
当前时间：${new Date(now).toISOString()}
输入文本：
${text}`;
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是严谨的长期记忆抽取器，只输出 JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.memories) ? parsed.memories : [];
    return list.slice(0, 6).map((m) => {
      const sentence = String(m.content || m.quote || '').trim();
      if (!sentence) return null;
      const type = MEMORY_TYPES.includes(m.memory_type) ? m.memory_type : 'fact';
      const toMs = (v) => (v ? Date.parse(v) || null : null);
      return {
        content: sentence,
        normalized_fact: String(m.normalized_fact || sentence),
        memory_type: type,
        event_time: toMs(m.event_time),
        event_time_text: m.event_time || null,
        valid_from: toMs(m.valid_from),
        valid_to: toMs(m.valid_to),
        source_type: opts.source_type || 'manual',
        source_id: opts.source_id || null,
        quote: String(m.quote || sentence),
        topics: Array.isArray(m.topics) ? m.topics.slice(0, 8) : topTopics(sentence),
        entities: Array.isArray(m.entities) ? m.entities.slice(0, 6) : [],
        base_weight: 0.6,
        confidence: Number.isFinite(Number(m.confidence)) ? Math.max(0, Math.min(1, Number(m.confidence))) : 0.65,
        confirmation_state: opts.autoConfirm ? 'confirmed' : 'candidate',
        suggested_action: 'confirm',
        extraction: { method: 'llm', model },
      };
    }).filter(Boolean);
  } catch {
    return null;
  }
}
