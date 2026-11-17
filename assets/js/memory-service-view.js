/* ==========================================================================
   久伴 · 记忆库服务（AURORA-CAIR 记忆库）图形界面
   连接 memory-service/server.mjs；提供记忆操作、日记同步、自动测试与说明。
   ========================================================================== */
import { listJournals } from './memory.js?v=1.16.0';
import {
  DEFAULT_MEMORY_SERVICE_URL,
  MemoryServiceClient,
  readMemoryServiceUrl,
  saveMemoryServiceUrl,
} from './memory-service-client.js';
import { el, toast, confirmDialog } from './util.js';

const OWNER_SCOPE = 'default';
const KIND_LABELS = { episode: '经历', fact: '事实', preference: '偏好', relation: '关系', goal: '计划', reflection: '反思' };
const STATE_LABELS = { candidate: '待确认', confirmed: '已确认', corrected: '已修正', expired: '已过期', retracted: '已撤回' };

function fmtTime(ts) {
  if (!ts) return '—';
  const date = new Date(Number(ts));
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}

function badge(text, tone = 'blue') {
  return el('span', { class: `badge badge-${tone}`, text });
}

function stateTone(state) {
  if (state === 'confirmed') return 'green';
  if (state === 'candidate') return 'amber';
  if (state === 'corrected' || state === 'expired' || state === 'retracted') return 'gray';
  return 'blue';
}

function statusDot(connected) {
  return el('span', { class: `status-dot ${connected ? 'is-ok' : 'is-demo'}` });
}

function memoryItem(memory, { onConfirm, onDelete, compact = false } = {}) {
  const bits = [
    badge(KIND_LABELS[memory.memory_type] || memory.memory_type, 'blue'),
    badge(STATE_LABELS[memory.confirmation_state] || memory.confirmation_state, stateTone(memory.confirmation_state)),
    badge(memory.source_type || 'manual', 'gray'),
  ];
  const meta = [
    memory.event_time ? `事件 ${fmtTime(memory.event_time)}` : null,
    memory.valid_from || memory.valid_to ? `有效 ${fmtTime(memory.valid_from)} ~ ${fmtTime(memory.valid_to)}` : null,
    `v${memory.version || 1}`,
  ].filter(Boolean).join(' · ');
  const actions = el('div', { class: 'msvc-item-actions' });
  if (memory.confirmation_state === 'candidate' && typeof onConfirm === 'function') {
    actions.append(el('button', { class: 'btn btn-soft btn-sm', type: 'button', text: '确认', onClick: () => onConfirm(memory) }));
  }
  if (typeof onDelete === 'function') {
    actions.append(el('button', { class: 'btn btn-ghost btn-sm msvc-danger', type: 'button', text: '删除', onClick: () => onDelete(memory) }));
  }
  return el('div', { class: `msvc-item ${compact ? 'is-compact' : ''}` }, [
    el('div', { class: 'msvc-item-badges' }, bits),
    el('div', { class: 'msvc-item-content', text: memory.content }),
    el('div', { class: 'msvc-item-meta', text: meta }),
    actions.childNodes.length ? actions : null,
  ]);
}

function resultItem(result, index) {
  const dims = result.dims || {};
  const dimText = ['semantic', 'entity', 'time', 'importance', 'trust', 'activation']
    .map((key) => `${key}:${Number(dims[key] ?? 0).toFixed(2)}`)
    .join(' · ');
  return el('div', { class: 'msvc-item msvc-result' }, [
    el('div', { class: 'msvc-item-badges' }, [
      el('span', { class: 'msvc-rank', text: `#${index + 1}` }),
      el('span', { class: 'msvc-score', text: Number(result.score || 0).toFixed(3) }),
      badge(KIND_LABELS[result.evidence?.memory_type] || result.evidence?.memory_type || '记忆', 'blue'),
      badge(result.evidence?.source_type || 'manual', 'gray'),
      badge(STATE_LABELS[result.evidence?.confirmation_state] || '', stateTone(result.evidence?.confirmation_state)),
    ]),
    el('div', { class: 'msvc-item-content', text: result.evidence?.content || '' }),
    el('div', { class: 'msvc-item-meta', text: dimText }),
    el('div', { class: 'msvc-item-meta', text: `来源 ${result.evidence?.source_id || '—'} · 版本 ${result.evidence?.version || 1} · 事件 ${fmtTime(result.evidence?.event_time)}` }),
  ]);
}

export async function mountMemoryServiceView(container) {
  let client = new MemoryServiceClient(readMemoryServiceUrl());
  let connected = false;
  let stats = null;
  let testCreatedIds = [];
  let testRunning = false;

  container.innerHTML = `
    <div class="page msvc-page">
      <header class="page-header msvc-header">
        <div class="msvc-header-text">
          <h1 class="page-title"><span class="emoji">🧠</span>记忆库服务</h1>
          <p class="page-sub">AURORA-CAIR 认证检索 · 记忆确认 · 日记同步 · 自动测试</p>
        </div>
        <div class="msvc-status">
          <span class="msvc-status-dot"></span>
          <span class="msvc-status-text">未连接</span>
          <input class="input msvc-url" id="msvc-url" spellcheck="false" value="${DEFAULT_MEMORY_SERVICE_URL}" aria-label="记忆库服务地址" />
          <button class="btn btn-soft btn-sm" id="msvc-connect" type="button">连接</button>
        </div>
      </header>
      <div class="page-body scroll msvc-body">
        <div class="msvc-offline" id="msvc-offline" hidden>
          <div>
            <b>记忆库服务未连接</b>
            <p>请在项目根目录启动服务：<code>node memory-service/server.mjs</code>（默认 http://127.0.0.1:5189），然后点右侧「重试」。</p>
          </div>
          <button class="btn btn-primary btn-sm" id="msvc-retry" type="button">重试连接</button>
        </div>
        <div class="msvc-chips" id="msvc-chips"></div>
        <nav class="msvc-tabs" role="tablist">
          <button class="msvc-tab is-active" data-tab="operate" type="button">记忆操作</button>
          <button class="msvc-tab" data-tab="diary" type="button">日记同步</button>
          <button class="msvc-tab" data-tab="tests" type="button">自动测试</button>
          <button class="msvc-tab" data-tab="about" type="button">使用说明</button>
        </nav>

        <section class="msvc-panel is-active" data-panel="operate">
          <div class="msvc-grid">
            <div class="msvc-col">
              <section class="card msvc-card">
                <div class="msvc-card-head"><h2>写入记忆</h2><span class="msvc-owner" id="msvc-owner-label">scope: ${OWNER_SCOPE}</span></div>
                <textarea class="input msvc-textarea" id="msvc-write-text" rows="3" placeholder="例如：记住：我下周一开始每周复习线性代数两次。"></textarea>
                <div class="msvc-row">
                  <select class="input msvc-source" id="msvc-source">
                    <option value="manual">手动记录</option>
                    <option value="diary">日记</option>
                    <option value="conversation">对话摘录</option>
                  </select>
                  <label class="msvc-check"><input type="checkbox" id="msvc-auto-confirm" checked /> 直接确认</label>
                  <span class="msvc-grow"></span>
                  <button class="btn btn-primary btn-sm" id="msvc-ingest" type="button">写入</button>
                </div>
                <div class="msvc-hint" id="msvc-ingest-result">默认由本地规则抽取候选；确认后才成为长期事实。</div>
              </section>
              <section class="card msvc-card">
                <div class="msvc-card-head"><h2>认证检索</h2><span class="badge badge-green">certified Top-K</span></div>
                <div class="msvc-row">
                  <input class="input msvc-grow" id="msvc-query" value="线性代数 复习 问题" aria-label="检索问题" />
                  <label class="msvc-label">K</label>
                  <input class="input msvc-k" id="msvc-topk" type="number" value="5" min="1" max="20" />
                  <select class="input msvc-time" id="msvc-time">
                    <option value="current">当前</option>
                    <option value="history">历史</option>
                  </select>
                  <label class="msvc-check"><input type="checkbox" id="msvc-mention" /> 主题提及</label>
                  <button class="btn btn-primary btn-sm" id="msvc-search" type="button">检索</button>
                </div>
                <div class="msvc-list" id="msvc-search-results"></div>
                <details class="msvc-trace-wrap" id="msvc-trace-wrap" hidden>
                  <summary>检索轨迹（trace：剪枝 / 动作 / I/O）</summary>
                  <pre class="msvc-trace" id="msvc-trace"></pre>
                </details>
              </section>
            </div>
            <div class="msvc-col">
              <section class="card msvc-card msvc-card-fill">
                <div class="msvc-card-head">
                  <h2>记忆库</h2>
                  <div class="msvc-actions">
                    <button class="btn btn-ghost btn-sm" id="msvc-refresh" type="button">刷新</button>
                    <button class="btn btn-soft btn-sm" id="msvc-seed" type="button">载入演示数据</button>
                  </div>
                </div>
                <div class="msvc-list msvc-scroll" id="msvc-memory-list"></div>
              </section>
            </div>
          </div>
        </section>

        <section class="msvc-panel" data-panel="diary">
          <div class="msvc-grid">
            <section class="card msvc-card">
              <div class="msvc-card-head"><h2>同步本地日记</h2><span class="badge badge-amber">可选 · 失败不影响本地</span></div>
              <p class="msvc-hint">读取当前浏览器 IndexedDB 中的日记，按日写入记忆库服务（source_type=diary，自动确认）；已同步过的日记会跳过。</p>
              <div class="msvc-row">
                <button class="btn btn-primary btn-sm" id="msvc-diary-sync" type="button">读取并同步</button>
                <span class="msvc-hint" id="msvc-diary-count">尚未读取</span>
              </div>
              <div class="msvc-log" id="msvc-diary-log"></div>
            </section>
            <section class="card msvc-card">
              <div class="msvc-card-head"><h2>检索日记记忆</h2><span class="badge badge-gray">source_type=diary</span></div>
              <div class="msvc-row">
                <input class="input msvc-grow" id="msvc-diary-query" placeholder="例如：接口 联调" />
                <button class="btn btn-primary btn-sm" id="msvc-diary-search" type="button">检索</button>
              </div>
              <div class="msvc-list" id="msvc-diary-results"></div>
            </section>
          </div>
        </section>

        <section class="msvc-panel" data-panel="tests">
          <section class="card msvc-card">
            <div class="msvc-card-head"><h2>自动测试</h2><span class="badge" id="msvc-test-summary">未运行</span></div>
            <p class="msvc-hint">在浏览器里直接调用服务 API，验证健康检查、候选确认、认证 Top-K、主题提及不落库、修正版本、快照分支、删除与日记适配。测试使用独立 scope，结束后自动清理。</p>
            <div class="msvc-row">
              <button class="btn btn-primary" id="msvc-run-tests" type="button">运行全部测试</button>
              <button class="btn btn-ghost btn-sm" id="msvc-clear-tests" type="button">清理测试数据</button>
              <span class="msvc-grow"></span>
              <span class="msvc-hint" id="msvc-test-scope"></span>
            </div>
            <div class="msvc-test-list" id="msvc-test-list"></div>
          </section>
        </section>

        <section class="msvc-panel" data-panel="about">
          <div class="msvc-grid">
            <section class="card msvc-card">
              <h2>这个页面做什么？</h2>
              <p class="msvc-hint">把 <code>memory-service/</code> 的 AURORA-CAIR 记忆库接入久伴网页端：写入候选记忆、确认/修正、认证 Top-K 检索、日记同步，并提供可重复的浏览器内自动测试。</p>
              <ul class="msvc-about-list">
                <li><b>可靠区间：</b>4/8/16-bit 前缀量化 + 区间算术，语义分数有严格上下界。</li>
                <li><b>精确认证：</b>Top-K 成员下界高于外部上界时认证，结果与全量精排一致。</li>
                <li><b>CARS 调度：</b>在多精度细化、单条恢复、块级恢复间按收益/成本选择，无收益时安全回退。</li>
                <li><b>记忆语义：</b>主题提及只影响本轮排序，不写长期权重；明确确认/修正才更新版本与有效期。</li>
              </ul>
              <div class="msvc-cmd">
                <div><span>启动记忆库服务</span><code>node memory-service/server.mjs</code></div>
                <div><span>服务自带演示页</span><code>http://127.0.0.1:5189/</code></div>
                <div><span>服务说明文档</span><code>memory-service/README.md · USAGE.md</code></div>
              </div>
            </section>
            <section class="card msvc-card">
              <h2>使用边界</h2>
              <ul class="msvc-about-list">
                <li>服务默认只监听 <code>127.0.0.1</code>，数据保存在 <code>memory-service/data/</code>，不经过云端。</li>
                <li>默认嵌入是轻量字符 n-gram 模型；“精确 Top-K”针对本服务评分函数而言，不代表语义质量。</li>
                <li>现有聊天/记忆仍以浏览器本地 IndexedDB 为准，本页是可选增强；日记同步失败不影响本地保存。</li>
                <li>测试数据写入独立 scope（<code>ui-test-…</code>）并在结束后清理；不会影响 <code>default</code> 记忆。</li>
              </ul>
              <div class="msvc-row">
                <button class="btn btn-soft btn-sm" id="msvc-open-demo" type="button">打开服务演示页</button>
                <button class="btn btn-ghost btn-sm" id="msvc-reset-url" type="button">恢复默认地址</button>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const urlInput = container.querySelector('#msvc-url');
  const statusDotEl = container.querySelector('.msvc-status-dot');
  const statusText = container.querySelector('.msvc-status-text');
  const offline = container.querySelector('#msvc-offline');
  const chips = container.querySelector('#msvc-chips');
  const memoryList = container.querySelector('#msvc-memory-list');
  const searchResults = container.querySelector('#msvc-search-results');
  const traceWrap = container.querySelector('#msvc-trace-wrap');
  const traceBox = container.querySelector('#msvc-trace');
  const testList = container.querySelector('#msvc-test-list');
  const testSummary = container.querySelector('#msvc-test-summary');
  const testScopeLabel = container.querySelector('#msvc-test-scope');

  urlInput.value = readMemoryServiceUrl();

  function setConnection(ok, detail = '') {
    connected = ok;
    statusDotEl.className = `status-dot ${ok ? 'is-ok' : 'is-demo'}`;
    statusText.textContent = ok ? `已连接${detail ? ` · ${detail}` : ''}` : '未连接';
    offline.hidden = ok;
    [container.querySelector('#msvc-ingest'), container.querySelector('#msvc-search'), container.querySelector('#msvc-refresh'), container.querySelector('#msvc-seed')]
      .forEach((btn) => { if (btn) btn.disabled = !ok; });
    container.querySelector('#msvc-diary-sync').disabled = !ok;
  }

  function renderChips() {
    chips.replaceChildren();
    if (!stats) return;
    const entries = [
      ['活跃记忆', stats.active],
      ['已确认', stats.confirmed],
      ['块数', stats.blocks],
      ['维度', stats.dim],
      ['已读字节', stats.io?.bytesRead ?? 0],
    ];
    for (const [label, value] of entries) {
      chips.append(el('span', { class: 'msvc-chip' }, [el('b', { text: String(value) }), el('span', { text: label })]));
    }
  }

  async function refreshStats() {
    if (!connected) return;
    try {
      stats = await client.stats();
      renderChips();
    } catch { /* stats 失败不阻塞主流程 */ }
  }

  async function connect({ silent = false } = {}) {
    const url = urlInput.value.trim();
    try {
      saveMemoryServiceUrl(url);
    } catch (error) {
      toast(error.message, 'error');
      return false;
    }
    client = new MemoryServiceClient(readMemoryServiceUrl());
    statusText.textContent = '连接中…';
    try {
      const health = await client.health();
      setConnection(true, `v${health.version || '1.0.0'} · dim ${health.dim}`);
      stats = health.storage || null;
      renderChips();
      await refreshStats();
      if (!silent) toast('已连接记忆库服务', 'success', 1600);
      await refreshMemoryList();
      return true;
    } catch (error) {
      setConnection(false);
      if (!silent) toast(`连接失败：${error.message}`, 'error', 3200);
      return false;
    }
  }

  /* ------------------------------ 记忆操作 ------------------------------ */
  async function refreshMemoryList() {
    if (!connected) { memoryList.replaceChildren(el('div', { class: 'msvc-empty', text: '服务未连接。' })); return; }
    try {
      const res = await client.list({ owner_scope: OWNER_SCOPE, limit: 120 });
      memoryList.replaceChildren();
      if (!res.memories.length) {
        memoryList.append(el('div', { class: 'msvc-empty', text: '还没有记忆。可写入一条，或点「载入演示数据」。' }));
        return;
      }
      for (const memory of res.memories) {
        memoryList.append(memoryItem(memory, {
          onConfirm: async (item) => {
            try {
              await client.confirm(item.memory_id, 'confirm');
              toast('已确认', 'success', 1400);
              await refreshMemoryList();
              await refreshStats();
            } catch (error) { toast(`确认失败：${error.message}`, 'error'); }
          },
          onDelete: async (item) => {
            if (!(await confirmDialog({ title: '删除记忆', message: '删除后不可检索，确定继续？', confirmText: '删除', danger: true }))) return;
            try {
              await client.remove(item.memory_id, { hard: true });
              toast('已删除', 'info', 1400);
              await refreshMemoryList();
              await refreshStats();
            } catch (error) { toast(`删除失败：${error.message}`, 'error'); }
          },
        }));
      }
    } catch (error) {
      memoryList.replaceChildren(el('div', { class: 'msvc-empty', text: `读取失败：${error.message}` }));
    }
  }

  async function ingest() {
    if (!connected) return;
    const text = container.querySelector('#msvc-write-text').value.trim();
    if (!text) { toast('请先写一条记忆内容', 'error', 1800); return; }
    const button = container.querySelector('#msvc-ingest');
    button.disabled = true;
    try {
      const res = await client.ingest({
        text,
        source_type: container.querySelector('#msvc-source').value,
        owner_scope: OWNER_SCOPE,
        auto_confirm: container.querySelector('#msvc-auto-confirm').checked,
      });
      const candidates = res.candidates || [];
      const result = container.querySelector('#msvc-ingest-result');
      result.replaceChildren();
      if (!candidates.length) {
        result.textContent = '未抽取到候选，请换一种表述。';
        return;
      }
      result.textContent = `抽取方式：${res.extraction === 'llm' ? 'LLM' : '本地规则'} · 写入 ${candidates.length} 条`;
      for (const memory of candidates) {
        result.append(memoryItem(memory, {
          onConfirm: async (item) => {
            try {
              await client.confirm(item.memory_id, 'confirm');
              toast('已确认', 'success', 1400);
              await refreshMemoryList();
              await refreshStats();
            } catch (error) { toast(`确认失败：${error.message}`, 'error'); }
          },
          onDelete: async (item) => {
            try {
              await client.remove(item.memory_id, { hard: true });
              await refreshMemoryList();
            } catch (error) { toast(`删除失败：${error.message}`, 'error'); }
          },
        }));
      }
      container.querySelector('#msvc-write-text').value = '';
      await refreshMemoryList();
      await refreshStats();
    } catch (error) {
      toast(`写入失败：${error.message}`, 'error', 3200);
    } finally {
      button.disabled = false;
    }
  }

  async function search() {
    if (!connected) return;
    const query = container.querySelector('#msvc-query').value.trim();
    if (!query) { toast('请输入检索问题', 'error', 1600); return; }
    const button = container.querySelector('#msvc-search');
    button.disabled = true;
    try {
      const res = await client.search({
        query,
        owner_scope: OWNER_SCOPE,
        top_k: Number(container.querySelector('#msvc-topk').value) || 5,
        time_intent: container.querySelector('#msvc-time').value,
        mention: container.querySelector('#msvc-mention').checked,
      });
      searchResults.replaceChildren();
      if (!res.results.length) {
        searchResults.append(el('div', { class: 'msvc-empty', text: '没有结果。先写入记忆或载入演示数据。' }));
      } else {
        res.results.forEach((item, index) => searchResults.append(resultItem(item, index)));
      }
      traceWrap.hidden = false;
      traceBox.textContent = JSON.stringify(res.trace, null, 2);
      if (res.trace?.mention_recorded) toast('已记录本轮主题提及（不改变长期状态）', 'info', 2200);
      if (res.certified === false) toast('本轮未完成认证（发生安全回退），结果仍与全量精排一致', 'info', 2600);
      await refreshStats();
    } catch (error) {
      searchResults.replaceChildren(el('div', { class: 'msvc-empty', text: `检索失败：${error.message}` }));
      traceWrap.hidden = true;
    } finally {
      button.disabled = false;
    }
  }

  async function seedDemo() {
    if (!connected) return;
    try {
      const res = await client.demoSeed(OWNER_SCOPE);
      toast(res.existing ? '该 scope 已有记忆，未重复写入' : `已载入 ${res.seeded} 条演示记忆`, res.existing ? 'info' : 'success', 2000);
      await refreshMemoryList();
      await refreshStats();
    } catch (error) { toast(`载入失败：${error.message}`, 'error'); }
  }

  /* ------------------------------ 日记同步 ------------------------------ */
  async function syncDiary() {
    if (!connected) return;
    const button = container.querySelector('#msvc-diary-sync');
    const log = container.querySelector('#msvc-diary-log');
    button.disabled = true;
    log.replaceChildren();
    try {
      const journals = await listJournals();
      container.querySelector('#msvc-diary-count').textContent = `本地日记 ${journals.length} 篇`;
      if (!journals.length) {
        log.append(el('div', { class: 'msvc-empty', text: '本地还没有日记，可先在「记忆日记」页面写一篇。' }));
        return;
      }
      const existing = await client.list({ owner_scope: OWNER_SCOPE, limit: 500 });
      const synced = new Set(existing.memories.filter((m) => m.source_type === 'diary' && m.source_id).map((m) => m.source_id));
      let okCount = 0;
      let skipCount = 0;
      for (const journal of journals.slice(0, 100)) {
        const sourceId = `diary:${journal.id}`;
        const row = el('div', { class: 'msvc-log-row' }, [el('span', { text: `${journal.date} ${journal.title || ''}` }), el('span', { text: '同步中…' })]);
        log.append(row);
        if (synced.has(sourceId)) {
          skipCount += 1;
          row.lastChild.textContent = '已同步，跳过';
          continue;
        }
        try {
          await client.ingest({
            text: `${journal.title ? journal.title + '：' : ''}${journal.content}`,
            source_type: 'diary',
            source_id: sourceId,
            owner_scope: OWNER_SCOPE,
            auto_confirm: true,
          });
          okCount += 1;
          row.lastChild.textContent = '已写入';
        } catch (error) {
          row.lastChild.textContent = `失败：${error.message}`;
        }
      }
      log.prepend(el('div', { class: 'msvc-hint', text: `完成：成功 ${okCount} 篇，跳过 ${skipCount} 篇。` }));
      await refreshMemoryList();
      await refreshStats();
    } catch (error) {
      log.append(el('div', { class: 'msvc-empty', text: `同步失败：${error.message}` }));
    } finally {
      button.disabled = false;
    }
  }

  async function searchDiary() {
    if (!connected) return;
    const query = container.querySelector('#msvc-diary-query').value.trim();
    if (!query) { toast('请输入检索词', 'error', 1600); return; }
    const box = container.querySelector('#msvc-diary-results');
    try {
      const res = await client.search({ query, owner_scope: OWNER_SCOPE, top_k: 8 });
      const diaryHits = res.results.filter((item) => item.evidence?.source_type === 'diary');
      box.replaceChildren();
      if (!diaryHits.length) {
        box.append(el('div', { class: 'msvc-empty', text: '没有匹配的日记记忆。' }));
        return;
      }
      diaryHits.forEach((item, index) => box.append(resultItem(item, index)));
    } catch (error) {
      box.replaceChildren(el('div', { class: 'msvc-empty', text: `检索失败：${error.message}` }));
    }
  }

  /* ------------------------------ 自动测试 ------------------------------ */
  function testRow(name) {
    const state = el('span', { class: 'msvc-test-status is-pending', text: '待运行' });
    const detail = el('span', { class: 'msvc-test-detail', text: '' });
    const row = el('div', { class: 'msvc-test-row' }, [state, el('span', { class: 'msvc-test-name', text: name }), detail]);
    testList.append(row);
    return { state, detail, row };
  }

  function setTestState(handle, status, text) {
    handle.state.className = `msvc-test-status is-${status}`;
    handle.state.textContent = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'running' ? '运行中' : status === 'skip' ? '跳过' : '待运行';
    handle.detail.textContent = text || '';
    handle.row.dataset.status = status;
  }

  async function runTests() {
    if (testRunning) return;
    if (!connected) { toast('请先连接记忆库服务', 'error', 2200); return; }
    testRunning = true;
    const button = container.querySelector('#msvc-run-tests');
    button.disabled = true;
    testList.replaceChildren();
    testSummary.className = 'badge';
    testSummary.textContent = '运行中…';
    const scope = `ui-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    testScopeLabel.textContent = `测试 scope：${scope}`;
    testCreatedIds = [];
    const results = [];
    const remember = (id) => { if (id) testCreatedIds.push(id); };
    const getMemory = async (id) => client.get(id);
    const expect = (condition, message) => { if (!condition) throw new Error(message); };

    const sayText = 'UI 测试：我计划下周开始复习线性代数矩阵分解，每次 45 分钟。';
    let primaryId = null;

    const tests = [
      ['服务健康检查', async () => {
        const health = await client.health();
        expect(health.ok === true, 'health.ok 不为 true');
        expect(Number(health.dim) > 0, '维度缺失');
        return `dim=${health.dim} · ${health.storage?.active ?? 0} 条活跃`;
      }],
      ['写入候选并确认', async () => {
        const ing = await client.ingest({ text: sayText, owner_scope: scope, auto_confirm: false });
        const candidate = ing.candidates?.[0];
        expect(candidate, '没有抽取到候选');
        primaryId = candidate.memory_id;
        remember(primaryId);
        expect(candidate.confirmation_state === 'candidate', `状态应为 candidate，实际 ${candidate.confirmation_state}`);
        const conf = await client.confirm(primaryId, 'confirm');
        expect(conf.memory?.confirmation_state === 'confirmed', '确认后状态不是 confirmed');
        return 'candidate → confirmed';
      }],
      ['认证检索 Top-K', async () => {
        const res = await client.search({ query: '线性代数 矩阵分解', owner_scope: scope, top_k: 3 });
        expect(res.certified === true, 'certified 不为 true');
        expect(res.results.length >= 1, '结果为空');
        expect(res.results.some((item) => item.memory_id === primaryId), '结果未包含刚写入的记忆');
        return `certified · ${res.results.length} 条 · ${res.trace.exactRecoveries} 次精确恢复 · ${res.trace.bytesRead}B`;
      }],
      ['主题提及不改变长期状态', async () => {
        const before = await getMemory(primaryId);
        const res = await client.search({ query: '线性代数 复习', owner_scope: scope, top_k: 3, mention: true });
        expect(res.trace?.mention_recorded === true, '未记录 mention');
        const after = await getMemory(primaryId);
        expect(after.base_weight === before.base_weight, `base_weight 被修改：${before.base_weight} → ${after.base_weight}`);
        expect(after.confirmation_state === before.confirmation_state, 'confirmation_state 被修改');
        return `base_weight=${before.base_weight} 不变`;
      }],
      ['修正生成新版本', async () => {
        const corrected = await client.confirm(primaryId, 'correct', { content: 'UI 测试修正：改为下下周复习概率论考试。' });
        remember(corrected.memory?.memory_id);
        expect(corrected.memory?.version === 2, `版本应为 2，实际 ${corrected.memory?.version}`);
        expect(corrected.memory?.supersedes_id === primaryId, '缺少 supersedes 关系');
        return 'v2 · supersedes v1';
      }],
      ['快照与 A/B 分支', async () => {
        const snap = await client.snapshot({ owner_scope: scope });
        const branches = await client.branches({ snapshot_id: snap.snapshot_id, question: '下周是否调整复习计划', options: ['维持计划', '调整计划'] });
        expect(Array.isArray(branches.branches) && branches.branches.length === 2, '未返回 2 条分支');
        expect(branches.branches[0].nodes?.[0]?.evidence_ids?.length > 0, '分支缺少证据引用');
        return `${branches.branches.length} 条分支 · 证据 ${branches.branches[0].nodes[0].evidence_ids.length} 条`;
      }],
      ['删除与清理', async () => {
        const victim = testCreatedIds.find((id) => id !== primaryId);
        expect(Boolean(victim), '没有可删除的测试记忆');
        await client.remove(victim, { hard: true });
        let removed = false;
        try {
          const after = await getMemory(victim);
          removed = after.deleted === true;
        } catch (error) {
          removed = error.status === 404;
        }
        expect(removed, '删除后未标记 deleted，仍可被检索');
        testCreatedIds = testCreatedIds.filter((id) => id !== victim);
        return 'hard delete ok';
      }],
      ['日记接入（写入 + 检索）', async () => {
        const ing = await client.ingest({ text: 'UI 测试日记：今天联调接口不一致，明天对齐字段。', source_type: 'diary', source_id: 'ui-test-diary', owner_scope: scope, auto_confirm: true });
        (ing.candidates || []).forEach((item) => remember(item.memory_id));
        const res = await client.search({ query: '接口 联调', owner_scope: scope, top_k: 5 });
        const hit = res.results.find((item) => item.evidence?.source_type === 'diary');
        expect(Boolean(hit), '未检索到 diary 来源记忆');
        return 'diary 来源命中';
      }],
    ];

    const handles = tests.map(([name]) => testRow(name));
    for (let index = 0; index < tests.length; index += 1) {
      const [name, run] = tests[index];
      const handle = handles[index];
      setTestState(handle, 'running', '');
      const start = performance.now();
      try {
        const detail = await run();
        setTestState(handle, 'pass', `${detail} · ${(performance.now() - start).toFixed(0)}ms`);
        results.push(true);
      } catch (error) {
        setTestState(handle, 'fail', error.message);
        results.push(false);
      }
    }

    // 清理测试数据（硬删除，忽略失败）
    for (const id of [...new Set(testCreatedIds)]) {
      try { await client.remove(id, { hard: true }); } catch { /* ignore */ }
    }
    testCreatedIds = [];
    await refreshStats();

    const passed = results.filter(Boolean).length;
    testSummary.className = `badge ${passed === tests.length ? 'badge-green' : 'badge-amber'}`;
    testSummary.textContent = `${passed}/${tests.length} 通过`;
    toast(passed === tests.length ? `全部 ${tests.length} 项测试通过` : `${tests.length - passed} 项测试失败`, passed === tests.length ? 'success' : 'error', 2600);
    testRunning = false;
    button.disabled = false;
  }

  async function clearTestData() {
    if (!connected || !testCreatedIds.length) { toast('没有待清理的测试数据', 'info', 1600); return; }
    for (const id of [...new Set(testCreatedIds)]) {
      try { await client.remove(id, { hard: true }); } catch { /* ignore */ }
    }
    testCreatedIds = [];
    toast('测试数据已清理', 'success', 1600);
  }

  /* ------------------------------ 事件绑定 ------------------------------ */
  const on = (selector, event, handler) => {
    const node = container.querySelector(selector);
    if (node) node.addEventListener(event, handler);
  };

  on('#msvc-connect', 'click', () => connect());
  on('#msvc-retry', 'click', () => connect());
  on('#msvc-refresh', 'click', refreshMemoryList);
  on('#msvc-seed', 'click', seedDemo);
  on('#msvc-ingest', 'click', ingest);
  on('#msvc-search', 'click', search);
  on('#msvc-diary-sync', 'click', syncDiary);
  on('#msvc-diary-search', 'click', searchDiary);
  on('#msvc-run-tests', 'click', runTests);
  on('#msvc-clear-tests', 'click', clearTestData);
  on('#msvc-open-demo', 'click', () => window.open(`${client.baseUrl}/`, '_blank', 'noopener'));
  on('#msvc-reset-url', 'click', () => {
    urlInput.value = DEFAULT_MEMORY_SERVICE_URL;
    connect();
  });

  container.querySelectorAll('.msvc-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.msvc-tab').forEach((item) => item.classList.toggle('is-active', item === tab));
      container.querySelectorAll('.msvc-panel').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.tab));
    });
  });

  setConnection(false);
  await connect({ silent: true });

  return () => {
    // 页面切走时无需额外清理；保留已写入服务的数据（它们属于用户正常操作）
  };
}
