/* ==========================================================================
   jiuban · 应用入口
   启动、视图路由（聊天 / 设置 / 记忆中心 / 人物档案 / 平行世界）
   ========================================================================== */

import { createConversationExperience } from './conversation-experience.js';
import { $, $$, el, toast } from './util.js';
import { initUserProfile } from './user-profile.js?v=1.16.0';

const VIEWS = new Set(['chat', 'settings', 'memory', 'memory/service', 'memory/import', 'memory/decision', 'diary', 'people', 'worlds']);
const VIEW_ALIASES = { 'memory-service': 'memory/service', 'chat-import': 'memory/import', decision: 'memory/decision' };
const ASSET_VERSION = '1.16.0';

const PAGE_MODULES = {
  settings: { path: './settings-view.js', mount: 'mountSettingsView' },
  memory: { path: './memory-hub-view.js', mount: 'mountMemoryHubView' },
  diary: { path: './diary-view.js', mount: 'mountDiaryView' },
  people: { path: './people-view.js', mount: 'mountPeopleView' },
  worlds: { path: './worlds-view.js', mount: 'mountWorldsView' },
};

const app = $('#app');
const chatRoot = $('#chat-root');
const viewRoot = $('#view-root');

let currentView = null;
let pageCleanup = null;
let chatModule = null;
let pageRevision = 0;

/* --------------------------------------------------------------------------
   视图路由
   -------------------------------------------------------------------------- */
function viewFromHash() {
  const name = (location.hash || '').replace(/^#\/?/, '').trim();
  const view = Object.hasOwn(VIEW_ALIASES, name) ? VIEW_ALIASES[name] : name;
  return isKnownView(view) ? view : 'chat';
}

function isKnownView(view) {
  return VIEWS.has(view) || /^people\/[^/]+(?:\/edit)?$/.test(view);
}

function primaryView(view) {
  return view.split('/')[0];
}

function sectionFromView(view) {
  return view.split('/').slice(1).join('/') || 'overview';
}

function syncRail(view) {
  $$('.rail-btn[data-view]').forEach((btn) => {
    const active = btn.dataset.view === primaryView(view);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function cleanupPage() {
  pageRevision += 1;
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
    const experience = el('details', { class: 'chat-experience' }, [
      el('summary', { text: '表达状态与对话体验' }),
      createConversationExperience(),
    ]);
    chatRoot.querySelector('.chat-head').after(experience);
    if (typeof mod.initChat === 'function') {
      await mod.initChat();
    }
  } else if (typeof chatModule.refreshChat === 'function') {
    chatModule.refreshChat();
  }
}

async function mountPage(view) {
  const config = PAGE_MODULES[primaryView(view)];
  cleanupPage();
  const revision = pageRevision;
  viewRoot.hidden = false;
  viewRoot.innerHTML =
    '<div class="view-loading"><span class="spinner"></span><span>正在打开页面…</span></div>';
  try {
    const mod = await import(`${config.path}?v=${ASSET_VERSION}`);
    if (revision !== pageRevision) return;
    const mount = mod[config.mount];
    if (typeof mount !== 'function') {
      throw new Error(`页面模块 ${config.path} 缺少导出函数 ${config.mount}`);
    }
    const target = el('div', { class: 'view-page-slot' });
    viewRoot.replaceChildren(target);
    const cleanup = await mount(target, { section: sectionFromView(currentView) });
    if (revision !== pageRevision) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    pageCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    if (revision !== pageRevision) return;
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
  const next = isKnownView(view) ? view : 'chat';
  if (!force && currentView === next) return;
  const previous = currentView;
  currentView = next;
  app.dataset.view = primaryView(next);
  syncRail(next);

  const hash = `#${next}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);

  if (['memory', 'people'].includes(primaryView(next)) && previous && primaryView(previous) === primaryView(next) && pageCleanup?.setSection) {
    pageCleanup.setSection(sectionFromView(next));
    return;
  }

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
  console.info('[久伴] v1.16.0 · 若点击无响应，请强制刷新 ⌘/Ctrl+Shift+R');
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
