/**
 * integration-example.js — 把记忆库服务接入现有网页端的示例（按需复制/改写）
 *
 * 前提：先启动服务 node memory-service/server.mjs（默认 http://127.0.0.1:5189）
 * 服务已开启 CORS，网页端（如 http://127.0.0.1:5188）可直接跨端口调用。
 */

const SERVICE_URL = localStorage.getItem('jiuban.memory.serviceUrl') || 'http://127.0.0.1:5189';

async function loadSdk() {
  const { MemoryClient } = await import(`${SERVICE_URL}/memory-client.js`);
  const { createDiaryMemoryService } = await import(`${SERVICE_URL}/diary-adapter.js`);
  return { client: new MemoryClient(SERVICE_URL), createDiaryMemoryService };
}

export async function probeMemoryService() {
  try {
    const { client } = await loadSdk();
    const health = await client.health();
    return { ok: true, health };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** 示例 1：日记保存后同步到记忆库（在 diary-view.js 的 saveJournal 成功后调用） */
export async function syncDiaryEntry(entry) {
  try {
    const { client, createDiaryMemoryService } = await loadSdk();
    const diary = createDiaryMemoryService(client, { owner_scope: localStorage.getItem('jiuban.memory.ownerScope') || 'default' });
    return await diary.save({ date: entry.date, title: entry.title, content: entry.content });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** 示例 2：聊天/反思前检索证据（返回带来源与分数的 Top-K） */
export async function retrieveEvidence(query, { topK = 5, timeIntent, mention = true } = {}) {
  try {
    const { client } = await loadSdk();
    return await client.search({
      query,
      owner_scope: localStorage.getItem('jiuban.memory.ownerScope') || 'default',
      top_k: topK,
      time_intent: timeIntent,
      mention,
    });
  } catch (err) {
    return { ok: false, error: err.message, results: [] };
  }
}

/** 示例 3：用户确认候选记忆后写回长期状态 */
export async function confirmMemory(memoryId, action = 'confirm', patch = {}) {
  try {
    const { client } = await loadSdk();
    return await client.confirm(memoryId, action, patch);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
