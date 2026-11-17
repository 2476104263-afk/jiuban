/**
 * diary-adapter.js — 日记模块接入记忆库的适配层
 *
 * 现有网页端日记保存在 IndexedDB；本适配层提供“可选”同步：
 *  - 保存日记后写入记忆库（source_type='diary'，自动确认，因为内容是用户本人写的）
 *  - 按关键词检索日记记忆
 *  - 失败时返回 {ok:false}，调用方保留本地写入即可，不影响主流程
 */
import { MemoryClient } from './memory-client.js';

export function createDiaryMemoryService(client, { owner_scope = 'default' } = {}) {
  const api = client || new MemoryClient();

  return {
    /** 保存一条日记为记忆（自动确认，来源 diary） */
    async save({ date, content, title = '', mood = '', tags = [] }) {
      const text = [title, content].filter(Boolean).join('：');
      if (!String(text).trim()) return { ok: false, error: 'empty diary' };
      try {
        const res = await api.ingest({
          text,
          source_type: 'diary',
          source_id: `diary:${date || new Date().toISOString().slice(0, 10)}`,
          owner_scope,
          auto_confirm: true,
        });
        return { ok: true, memories: res.candidates, extraction: res.extraction };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /** 检索与当前主题相关的日记记忆 */
    async search(query, { top_k = 5, time_intent, mention = false } = {}) {
      try {
        const res = await api.search({ query, owner_scope, top_k: Math.max(top_k, 10), time_intent, mention });
        const diaryOnly = res.results.filter((r) => r.evidence.source_type === 'diary');
        return { ok: true, results: diaryOnly.slice(0, top_k), trace: res.trace };
      } catch (err) {
        return { ok: false, error: err.message, results: [] };
      }
    },

    /** 列出日记类记忆 */
    async list({ limit = 50 } = {}) {
      try {
        const res = await api.list({ owner_scope, limit: 500 });
        const diary = res.memories.filter((m) => m.source_type === 'diary' && !m.deleted);
        return { ok: true, memories: diary.slice(0, limit) };
      } catch (err) {
        return { ok: false, error: err.message, memories: [] };
      }
    },

    /** 从日记文本抽取候选（不自动确认，适合需要用户确认的整理流程） */
    async extractCandidates(text, { source_id } = {}) {
      try {
        const res = await api.ingest({ text, source_type: 'diary', source_id, owner_scope, auto_confirm: false });
        return { ok: true, candidates: res.candidates };
      } catch (err) {
        return { ok: false, error: err.message, candidates: [] };
      }
    },
  };
}

export default createDiaryMemoryService;
