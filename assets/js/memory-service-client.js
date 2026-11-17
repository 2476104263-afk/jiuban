/* ==========================================================================
   久伴 · 记忆库服务客户端（AURORA-CAIR 记忆服务）
   与 memory-service/server.mjs 的 REST API 对接；纯 fetch，无依赖。
   ========================================================================== */

export const MEMORY_SERVICE_URL_KEY = 'jiuban.memoryService.url';
export const DEFAULT_MEMORY_SERVICE_URL = 'http://127.0.0.1:5189';

export function readMemoryServiceUrl() {
  try {
    const value = localStorage.getItem(MEMORY_SERVICE_URL_KEY);
    return value && /^https?:\/\//i.test(value) ? value.replace(/\/+$/, '') : DEFAULT_MEMORY_SERVICE_URL;
  } catch {
    return DEFAULT_MEMORY_SERVICE_URL;
  }
}

export function saveMemoryServiceUrl(url) {
  const value = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) throw new Error('服务地址需要以 http:// 或 https:// 开头');
  localStorage.setItem(MEMORY_SERVICE_URL_KEY, value);
  return value;
}

export class MemoryServiceError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = 'MemoryServiceError';
    this.status = status;
    this.payload = payload;
  }
}

export class MemoryServiceClient {
  constructor(baseUrl = readMemoryServiceUrl(), { timeoutMs = 12000 } = {}) {
    this.baseUrl = String(baseUrl || DEFAULT_MEMORY_SERVICE_URL).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body == null ? undefined : { 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!response.ok) {
        const message = data && data.error ? data.error : `HTTP ${response.status}`;
        throw new MemoryServiceError(message, { status: response.status, payload: data });
      }
      return data;
    } catch (error) {
      if (error instanceof MemoryServiceError) throw error;
      if (error.name === 'AbortError') {
        throw new MemoryServiceError('请求超时：请确认记忆库服务正在运行', { status: 0 });
      }
      throw new MemoryServiceError(`无法连接记忆库服务：${error.message}`, { status: 0 });
    } finally {
      clearTimeout(timer);
    }
  }

  health() { return this.request('/api/health'); }
  stats() { return this.request('/api/stats'); }

  ingest({ text, source_type = 'manual', source_id, owner_scope = 'default', auto_confirm = false, llm, now }) {
    return this.request('/api/memories/ingest', { method: 'POST', body: { text, source_type, source_id, owner_scope, auto_confirm, llm, now } });
  }

  confirm(memory_id, action = 'confirm', patch = {}) {
    return this.request('/api/memories/confirm', { method: 'POST', body: { memory_id, action, patch } });
  }

  search({ query, owner_scope = 'default', top_k = 5, now, time_intent, weights, mention = false }) {
    return this.request('/api/memories/search', { method: 'POST', body: { query, owner_scope, top_k, now, time_intent, weights, mention } });
  }

  list({ owner_scope = 'default', include_deleted = false, limit = 200 } = {}) {
    const params = new URLSearchParams({ owner_scope, limit: String(limit) });
    if (include_deleted) params.set('include_deleted', '1');
    return this.request(`/api/memories?${params.toString()}`);
  }

  get(memory_id) { return this.request(`/api/memories/${encodeURIComponent(memory_id)}`); }
  remove(memory_id, { hard = true } = {}) {
    return this.request(`/api/memories/${encodeURIComponent(memory_id)}${hard ? '?hard=1' : ''}`, { method: 'DELETE' });
  }

  snapshot(body = {}) { return this.request('/api/decision/snapshot', { method: 'POST', body }); }
  branches(body = {}) { return this.request('/api/decision/branches', { method: 'POST', body }); }
  outcome(body = {}) { return this.request('/api/reviews/outcome', { method: 'POST', body }); }

  exportAll(owner_scope) { return this.request('/api/export', { method: 'POST', body: { owner_scope } }); }
  importAll(payload) { return this.request('/api/import', { method: 'POST', body: payload }); }
  demoSeed(owner_scope = 'demo', force = false) { return this.request('/api/demo/seed', { method: 'POST', body: { owner_scope, force } }); }
}

export default MemoryServiceClient;
