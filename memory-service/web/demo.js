import { MemoryClient } from './memory-client.js';
import { createDiaryMemoryService } from './diary-adapter.js';

const client = new MemoryClient(window.MEMORY_SERVICE_URL || 'http://127.0.0.1:5189');
const diary = createDiaryMemoryService(client, { owner_scope: 'demo' });
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN') : '—');

const statusDot = $('statusDot');
const statusText = $('statusText');

function setStatus(ok, text) {
  statusDot.className = `dot ${ok ? 'ok' : 'bad'}`;
  statusText.textContent = text;
}

async function probe() {
  try {
    const res = await client.health();
    setStatus(true, `已连接 · ${res.service} · ${res.storage.active} 条活跃记忆 · ${res.storage.dim} 维`);
    return true;
  } catch (err) {
    setStatus(false, `未连接：${err.message}（先运行 node memory-service/server.mjs）`);
    return false;
  }
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${btn.dataset.tab}`));
    });
  });
}

function memoryHtml(memory, { candidate = false } = {}) {
  const when = memory.event_time ? new Date(memory.event_time).toLocaleString('zh-CN') : '时间未知';
  return `<div class="item ${candidate ? 'candidate' : ''}">
    <div><span class="badge">${esc(memory.memory_type)}</span><span class="badge">${esc(memory.source_type)}</span><span class="badge">${esc(memory.confirmation_state)}</span></div>
    <div style="margin:6px 0">${esc(memory.content)}</div>
    <div class="muted">事件时间：${esc(when)} · 有效：${esc(fmtTime(memory.valid_from))} ~ ${esc(fmtTime(memory.valid_to))} · 版本 ${memory.version}</div>
    <div class="row" style="margin-top:8px">
      ${candidate && memory.confirmation_state === 'candidate' ? `<button data-confirm="${esc(memory.memory_id)}">确认</button>` : ''}
      <button class="soft danger" data-delete="${esc(memory.memory_id)}">删除</button>
    </div>
  </div>`;
}

async function refreshList() {
  const res = await client.list({ owner_scope: 'demo', limit: 100 });
  $('memoryList').innerHTML = res.memories.length
    ? res.memories.map((m) => memoryHtml(m)).reverse().join('')
    : '<div class="hint">暂无记忆，点击“载入演示数据”。</div>';
  document.querySelectorAll('[data-confirm]').forEach((btn) => btn.addEventListener('click', async () => {
    await client.confirm(btn.dataset.confirm, 'confirm');
    await refreshList();
  }));
  document.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    await client.remove(btn.dataset.delete, { hard: true });
    await refreshList();
  }));
}

function renderCandidates(res) {
  const list = res.candidates || [];
  if (!list.length) { $('candidateList').innerHTML = '<div class="hint">未抽取到候选。</div>'; return; }
  $('candidateList').innerHTML = `<div class="hint">抽取方式：${esc(res.extraction)}；已写入候选，确认后才成为事实。</div>` + list.map((m) => memoryHtml(m, { candidate: true })).join('');
  document.querySelectorAll('#candidateList [data-confirm]').forEach((btn) => btn.addEventListener('click', async () => {
    await client.confirm(btn.dataset.confirm, 'confirm');
    await refreshList();
    await refreshCandidates();
  }));
  document.querySelectorAll('#candidateList [data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    await client.remove(btn.dataset.delete, { hard: true });
    await refreshCandidates();
  }));
}

async function refreshCandidates() {
  // 候选确认/删除后，用列表简单刷新候选区域（仅保留仍为 candidate 的条目）
  const res = await client.list({ owner_scope: 'demo', limit: 200 });
  const candidates = res.memories.filter((m) => m.confirmation_state === 'candidate');
  $('candidateList').innerHTML = candidates.length ? '' : '<div class="hint">暂无待确认候选。</div>';
}

async function ingest() {
  const text = $('memoryText').value.trim();
  if (!text) return;
  $('ingestBtn').disabled = true;
  try {
    const res = await client.ingest({
      text,
      source_type: $('sourceType').value,
      owner_scope: 'demo',
      auto_confirm: $('autoConfirm').checked,
    });
    const pending = res.candidates.filter((c) => c.confirmation_state === 'candidate');
    if (pending.length) renderCandidates(res);
    else { $('candidateList').innerHTML = '<div class="hint">已直接确认并写入。</div>'; }
    await refreshList();
  } finally {
    $('ingestBtn').disabled = false;
  }
}

function resultHtml(result) {
  const dims = result.dims || {};
  const dimsText = Object.entries(dims).map(([k, v]) => `${k}:${Number(v).toFixed(2)}`).join(' · ');
  return `<div class="item">
    <div><span class="score">${result.score}</span> <span class="badge">${esc(result.evidence.memory_type)}</span><span class="badge">${esc(result.evidence.source_type)}</span><span class="badge">${esc(result.evidence.confirmation_state)}</span></div>
    <div style="margin:6px 0">${esc(result.evidence.content)}</div>
    <div class="muted">${esc(result.memory_id)} · 维度 ${esc(dimsText)}</div>
    <div class="muted">来源：${esc(result.evidence.source_id || '—')} · 版本 ${result.evidence.version}</div>
  </div>`;
}

async function search() {
  const query = $('queryInput').value.trim();
  if (!query) return;
  $('searchBtn').disabled = true;
  try {
    const res = await client.search({
      query,
      owner_scope: 'demo',
      top_k: Number($('topK').value) || 5,
      time_intent: $('timeIntent').value,
      mention: $('mention').checked,
    });
    $('searchResults').innerHTML = res.results.length
      ? res.results.map(resultHtml).join('')
      : '<div class="hint">无结果。</div>';
    $('traceBox').textContent = JSON.stringify(res.trace, null, 2);
  } catch (err) {
    $('searchResults').innerHTML = `<div class="hint">检索失败：${esc(err.message)}</div>`;
  } finally {
    $('searchBtn').disabled = false;
  }
}

async function seed() {
  $('seedBtn').disabled = true;
  try {
    const res = await client.demoSeed('demo');
    statusText.textContent = `已载入 ${res.seeded} 条演示记忆`;
    await refreshList();
    await probe();
  } finally {
    $('seedBtn').disabled = false;
  }
}

async function saveDiary() {
  const content = $('diaryText').value.trim();
  if (!content) { $('diaryResult').textContent = '请先写日记内容。'; return; }
  const res = await diary.save({ date: $('diaryDate').value || new Date().toISOString().slice(0, 10), title: $('diaryTitle').value, content });
  $('diaryResult').textContent = res.ok ? `已写入记忆库（${res.memories.length} 条）` : `写入失败：${res.error}`;
  await refreshDiary();
}

async function refreshDiary() {
  const res = await diary.list({ limit: 20 });
  $('diaryList').innerHTML = res.memories.length
    ? res.memories.map((m) => `<div class="item"><div>${esc(m.content)}</div><div class="muted">${esc(m.memory_id)} · ${esc(m.memory_type)}</div></div>`).join('')
    : '<div class="hint">暂无日记记忆。</div>';
}

async function searchDiary() {
  const query = $('diaryQuery').value.trim();
  if (!query) return;
  const res = await diary.search(query, { top_k: 5 });
  $('diarySearchResults').innerHTML = res.ok && res.results.length
    ? res.results.map(resultHtml).join('')
    : `<div class="hint">${res.ok ? '无相关日记记忆。' : '检索失败：' + esc(res.error)}</div>`;
}

bindTabs();
$('ingestBtn').addEventListener('click', ingest);
$('refreshBtn').addEventListener('click', refreshList);
$('seedBtn').addEventListener('click', seed);
$('searchBtn').addEventListener('click', search);
$('diarySaveBtn').addEventListener('click', saveDiary);
$('diarySearchBtn').addEventListener('click', searchDiary);
$('diaryDate').value = new Date().toISOString().slice(0, 10);

probe().then((ok) => {
  if (ok) {
    refreshList().catch(() => {});
    refreshDiary().catch(() => {});
  }
});
