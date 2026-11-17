import { el, icon } from './util.js';

const LABELS = { chat: '对话', memory: '记忆中心', diary: '日记', people: '人物档案', worlds: '平行世界', settings: '设置' };

export function updateNavigationContext(view) {
  const title = document.querySelector('.compact-page-title');
  if (title) title.textContent = LABELS[view.split('/')[0]] || 'Memora';
  document.title = `${LABELS[view.split('/')[0]] || 'Memora'} · Memora`;
}

export function initAdaptiveNavigation() {
  const main = document.querySelector('#main-pane');
  const profile = el('button', { class: 'compact-profile-button', type: 'button', 'aria-label': '个人资料', onClick: () => document.querySelector('#me-avatar')?.click() }, [
    el('span', { class: 'compact-profile-letter', text: '我' }),
  ]);
  const settings = el('button', { class: 'rail-btn compact-settings-button', type: 'button', dataset: { view: 'settings' }, 'aria-label': '设置', title: '设置', html: icon('settings', 21) });
  main.prepend(el('div', { class: 'compact-toolbar' }, [profile, el('span', { class: 'compact-page-title', text: 'Memora' }), settings]));
  const toggle = document.querySelector('#sidebar-toggle');
  toggle?.addEventListener('click', () => {
    const collapsed = document.querySelector('#app').classList.toggle('sidebar-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
    toggle.title = collapsed ? '展开侧栏' : '收起侧栏';
  });
  document.querySelectorAll('.rail-btn[data-tip]').forEach(button => { button.title = button.dataset.tip; });

  function closeMenus(except = null) {
    document.querySelectorAll('.action-menu[open]').forEach(menu => { if (menu !== except) menu.open = false; });
  }
  document.addEventListener('click', event => {
    const menu = event.target.closest?.('.action-menu');
    closeMenus(menu);
    if (menu && event.target.closest('button')) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = event.target.closest?.('.action-menu[open]');
    if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); event.stopPropagation(); }
    else closeMenus();
  });
}
