/**
 * memory-client.js — 浏览器/Node 通用 ES Module 客户端
 *
 * 用法：
 *   import { MemoryClient } from './memory-client.js';
 *   const client = new MemoryClient('http://127.0.0.1:5189');
 *   const res = await client.search({ query: '线性代数 复习', top_k: 5 });
 */

export class MemoryClient {
  constructor(baseUrl = 'http://127.0.0.1:5189', options = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || 20000;
  }

  async request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body == null ? undefined : { 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!res.ok) {
        const message = data && data.error ? data.error : `HTTP ${res.status}`;
        const error = new Error(message);
        error.status = res.status;
        error.payload = data;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async health() { return this.request('/api/health'); }
  async stats() { return this.request('/api/stats'); }

  async ingest({ text, source_type = 'manual', source_id, owner_scope = 'default', auto_confirm = false, llm, now }) {
    return this.request('/api/memories/ingest', { method: 'POST', body: { text, source_type, source_id, owner_scope, auto_confirm, llm, now } });
  }

  async confirm(memory_id, action = 'confirm', patch = {}) {
    return this.request('/api/memories/confirm', { method: 'POST', body: { memory_id, action, patch } });
  }

  async search({ query, owner_scope = 'default', top_k = 5, now, time_intent, weights, mention = false }) {
    return this.request('/api/memories/search', { method: 'POST', body: { query, owner_scope, top_k, now, time_intent, weights, mention } });
  }

  async list({ owner_scope = 'default', include_deleted = false, limit = 200 } = {}) {
    const params = new URLSearchParams({ owner_scope, limit: String(limit) });
    if (include_deleted) params.set('include_deleted', '1');
    return this.request(`/api/memories?${params}`);
  }

  async get(memory_id) { return this.request(`/api/memories/${encodeURIComponent(memory_id)}`); }
  async remove(memory_id, { hard = false } = {}) { return this.request(`/api/memories/${encodeURIComponent(memory_id)}${hard ? '?hard=1' : ''}`, { method: 'DELETE' }); }

  async snapshot(body = {}) { return this.request('/api/decision/snapshot', { method: 'POST', body }); }
  async branches(body = {}) { return this.request('/api/decision/branches', { method: 'POST', body }); }
  async outcome(body = {}) { return this.request('/api/reviews/outcome', { method: 'POST', body }); }

  async exportAll(owner_scope) { return this.request('/api/export', { method: 'POST', body: { owner_scope } }); }
  async importAll(payload) { return this.request('/api/import', { method: 'POST', body: payload }); }
  async demoSeed(owner_scope = 'demo') { return this.request('/api/demo/seed', { method: 'POST', body: { owner_scope } }); }

  /** 探测服务是否可用（不抛异常） */
  static async probe(baseUrl = 'http://127.0.0.1:5189') {
    try {
      const client = new MemoryClient(baseUrl, { timeoutMs: 2500 });
      await client.health();
      return true;
    } catch {
      return false;
    }
  }
}

export default MemoryClient;
