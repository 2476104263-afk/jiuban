/* ==========================================================================
   Memora · 应用入口
   启动、视图路由（聊天 / 设置 / 记忆中心 / 人物档案 / 平行世界）
   ========================================================================== */

import { createConversationExperience } from './conversation-experience.js';
import { $, $$, el, toast, modal } from './util.js';
import { initUserProfile, getUserProfile } from './user-profile.js?v=1.17.0';
import { initLiquidGlass } from './liquid-glass.js?v=1.17.0';
import { initAdaptiveNavigation, updateNavigationContext } from './navigation.js?v=1.17.0';

const VIEWS = new Set(['chat', 'settings', 'memory', 'memory/service', 'memory/import', 'memory/decision', 'diary', 'people', 'worlds']);
const VIEW_ALIASES = { 'memory-service': 'memory/service', 'chat-import': 'memory/import', decision: 'memory/decision' };
const ASSET_VERSION = '1.17.0';

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
const pageCache = new Map();
const navigationPaths = new Map();

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
  updateNavigationContext(view);
}

function cleanupPage() {
  pageRevision += 1;
  pageCleanup = null;
  // 顶层模块各自保留界面状态，切换时只隐藏；最多缓存五个模块。
  for (const entry of pageCache.values()) entry.node.hidden = true;
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
  const key = primaryView(view);
  const config = PAGE_MODULES[key];
  cleanupPage();
  const revision = pageRevision;
  viewRoot.hidden = false;
  let entry = pageCache.get(key);
  if (entry) {
    entry.section = sectionFromView(view);
    entry.node.hidden = false;
    pageCleanup = entry.cleanup;
    entry.cleanup?.setSection?.(entry.section);
    try { await entry.cleanup?.refresh?.(); }
    catch (error) { console.warn('[Memora] 刷新页面数据失败', error); }
    return;
  }
  const target = el('div', { class: 'view-page-slot', 'aria-busy': 'true' });
  target.append(el('div', { class: 'view-loading', role: 'status', text: '正在打开页面…' }));
  entry = { node: target, cleanup: null, section: sectionFromView(view) };
  pageCache.set(key, entry);
  viewRoot.append(target);
  try {
    const mod = await import(`${config.path}?v=${ASSET_VERSION}`);
    const mount = mod[config.mount];
    if (typeof mount !== 'function') {
      throw new Error(`页面模块 ${config.path} 缺少导出函数 ${config.mount}`);
    }
    const cleanup = await mount(target, { section: entry.section });
    entry.cleanup = typeof cleanup === 'function' ? cleanup : null;
    target.removeAttribute('aria-busy');
    entry.cleanup?.setSection?.(entry.section);
    if (primaryView(currentView) === key) pageCleanup = entry.cleanup;
  } catch (err) {
    console.error('[Memora] 页面加载失败', err);
    target.removeAttribute('aria-busy');
    if (revision === pageRevision) toast(`页面加载失败：${(err && err.message) || '未知错误'}`, 'error', 3600);
    target.replaceChildren(
      el('div', { class: 'view-error-holder' }, [
        el('div', { class: 'empty' }, [
          el('div', { class: 'empty-emoji', text: '🧩' }),
          el('div', { class: 'empty-title', text: '页面加载失败' }),
          el('div', { class: 'empty-desc', text: String((err && err.message) || err || '未知错误') }),
          el(
            'button',
            {
              class: 'btn btn-soft',
              onClick: () => {
                entry.cleanup?.();
                pageCache.delete(key);
                target.remove();
                route(view, { force: true });
              },
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
  navigationPaths.set(primaryView(next), next);
  const cached = pageCache.get(primaryView(next));
  if (cached) cached.section = sectionFromView(next);
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
      if (currentView === 'chat') updateNavigationContext('chat');
    } catch (err) {
      console.error('[Memora] 聊天模块加载失败', err);
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
    console.error('[Memora] 打开 DeepSeek 连接窗口失败', err);
    toast('连接窗口加载失败，请刷新页面重试', 'error');
  }
}

function initRouting() {
  $$('.rail-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (!VIEWS.has(view)) return;
      const destination = primaryView(currentView || '') === view ? view : navigationPaths.get(view) || view;
      if (location.hash === `#${destination}`) route(destination, { force: true });
      else location.hash = `#${destination}`;
    });
  });
  window.addEventListener('hashchange', () => route(viewFromHash(), { force: true }));
  $('#chat-api-status')?.addEventListener('click', openApiKeyWindow);
  $('#chat-experience-btn')?.addEventListener('click', () => {
    modal({ title: '对话设置', body: createConversationExperience(), wide: true });
  });
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
    console.error('[Memora] 未捕获错误', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Memora] 未处理的 Promise 拒绝', event.reason);
  });
}

function init() {
  initLiquidGlass();
  initAdaptiveNavigation();
  window.__MEMORA_READY__ = true;
  window.__JIUBAN_READY__ = true;
  const bootWarning = document.getElementById('boot-warning');
  if (bootWarning) bootWarning.hidden = true;
  console.info(`[Memora] v${ASSET_VERSION} · 若点击无响应，请强制刷新 ⌘/Ctrl+Shift+R`);
  // 只保留浅色外观
  document.documentElement.dataset.theme = 'light';
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', 'light');
  initRouting();
  const refreshProfile = () => {
    const profile = getUserProfile();
    const name = $('#sidebar-user-name');
    const compact = $('.compact-profile-letter');
    if (name) name.textContent = profile.name;
    if (compact) compact.textContent = profile.name.slice(0, 1);
    chatModule?.refreshChat?.();
  };
  initUserProfile(refreshProfile);
  refreshProfile();
  initGlobalGuards();
  route(viewFromHash(), { force: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
