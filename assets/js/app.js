/* ==========================================================================
   jiuban · 应用入口
   启动、视图路由（聊天 / 设置 / 记忆 / 日记）、DeepSeek 连接小窗口
   ========================================================================== */

import { $, $$, el, toast } from './util.js';
import { initUserProfile } from './user-profile.js?v=1.9.4';

const VIEWS = new Set(['chat', 'settings', 'memory', 'diary']);
const ASSET_VERSION = '1.9.8';

const PAGE_MODULES = {
  settings: { path: './settings-view.js', mount: 'mountSettingsView' },
  memory: { path: './memory-view.js', mount: 'mountMemoryView' },
  diary: { path: './diary-view.js', mount: 'mountDiaryView' },
};

const app = $('#app');
const chatRoot = $('#chat-root');
const viewRoot = $('#view-root');

let currentView = null;
let pageCleanup = null;
let chatModule = null;

/* --------------------------------------------------------------------------
   视图路由
   -------------------------------------------------------------------------- */
function viewFromHash() {
  const name = (location.hash || '').replace(/^#\/?/, '').trim();
  return VIEWS.has(name) ? name : 'chat';
}

function syncRail(view) {
  $$('.rail-btn[data-view]').forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function cleanupPage() {
  if (typeof pageCleanup === 'function') {
    try {
      pageCleanup();
    } catch (err) {
      console.error('[jiuban] 清理页面出错', err);
    }
  }
  pageCleanup = null;
  if (viewRoot) viewRoot.innerHTML = '';
}

async function ensureChat() {
  if (!chatModule) {
    const mod = await import(`./chat.js?v=${ASSET_VERSION}`);
    chatModule = mod;
    if (typeof mod.initChat === 'function') {
      await mod.initChat();
    }
  } else if (typeof chatModule.refreshChat === 'function') {
    chatModule.refreshChat();
  }
}

async function mountPage(view) {
  const config = PAGE_MODULES[view];
  cleanupPage();
  viewRoot.hidden = false;
  viewRoot.innerHTML =
    '<div class="view-loading"><span class="spinner"></span><span>正在打开页面…</span></div>';
  try {
    const mod = await import(`${config.path}?v=${ASSET_VERSION}`);
    const mount = mod[config.mount];
    if (typeof mount !== 'function') {
      throw new Error(`页面模块 ${config.path} 缺少导出函数 ${config.mount}`);
    }
    viewRoot.innerHTML = '';
    const cleanup = await mount(viewRoot);
    pageCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    console.error('[jiuban] 页面加载失败', err);
    toast(`页面加载失败：${(err && err.message) || '未知错误'}`, 'error', 3600);
    viewRoot.innerHTML = '';
    viewRoot.append(
      el('div', { class: 'view-error-holder' }, [
        el('div', { class: 'empty' }, [
          el('div', { class: 'empty-emoji', text: '🧩' }),
          el('div', { class: 'empty-title', text: '页面加载失败' }),
          el('div', { class: 'empty-desc', text: String((err && err.message) || err || '未知错误') }),
          el(
            'button',
            {
              class: 'btn btn-soft',
              onClick: () => route(view, { force: true }),
            },
            '重新加载'
          ),
        ]),
      ])
    );
  }
}

async function route(view, { force = false } = {}) {
  const next = VIEWS.has(view) ? view : 'chat';
  if (!force && currentView === next) return;
  currentView = next;
  app.dataset.view = next;
  syncRail(next);

  const hash = `#${next}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);

  if (next === 'chat') {
    cleanupPage();
    viewRoot.hidden = true;
    chatRoot.hidden = false;
    try {
      await ensureChat();
    } catch (err) {
      console.error('[jiuban] 聊天模块加载失败', err);
      chatRoot.innerHTML = '';
      chatRoot.append(
        el('div', { class: 'empty', style: { height: '100%' } }, [
          el('div', { class: 'empty-emoji', text: '💬' }),
          el('div', { class: 'empty-title', text: '聊天模块加载失败' }),
          el('div', { class: 'empty-desc', text: String((err && err.message) || err) }),
          el('button', { class: 'btn btn-soft', onClick: () => route('chat', { force: true }) }, '重试'),
        ])
      );
    }
    return;
  }

  chatRoot.hidden = true;
  viewRoot.hidden = false;
  await mountPage(next);
}

async function openApiKeyWindow() {
  try {
    const mod = await import(`./api-key-dialog.js?v=${ASSET_VERSION}`);
    if (typeof mod.openApiKeyDialog === 'function') mod.openApiKeyDialog();
  } catch (err) {
    console.error('[jiuban] 打开 DeepSeek 连接窗口失败', err);
    toast('连接窗口加载失败，请刷新页面重试', 'error');
  }
}

function initRouting() {
  $$('.rail-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (!VIEWS.has(view)) return;
      if (location.hash === `#${view}`) route(view, { force: true });
      else location.hash = `#${view}`;
    });
  });
  window.addEventListener('hashchange', () => route(viewFromHash(), { force: true }));
  $('#chat-api-status')?.addEventListener('click', openApiKeyWindow);
}

/* --------------------------------------------------------------------------
   启动
   -------------------------------------------------------------------------- */
function initGlobalGuards() {
  ['dragover', 'drop'].forEach((type) => {
    window.addEventListener(type, (event) => {
      if (event.target.closest && event.target.closest('#messages, #composer')) return;
      event.preventDefault();
    });
  });
  window.addEventListener('error', (event) => {
    console.error('[jiuban] 未捕获错误', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[jiuban] 未处理的 Promise 拒绝', event.reason);
  });
}

function init() {
  window.__JIUBAN_READY__ = true;
  const bootWarning = document.getElementById('boot-warning');
  if (bootWarning) bootWarning.hidden = true;
  console.info('[久伴] v1.7.0 · 若点击无响应，请强制刷新 ⌘/Ctrl+Shift+R');
  // 只保留浅色外观
  document.documentElement.dataset.theme = 'light';
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', 'light');
  initRouting();
  initUserProfile(() => chatModule?.refreshChat?.());
  initGlobalGuards();
  route(viewFromHash(), { force: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
