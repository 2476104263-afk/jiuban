import { el, icon } from './util.js';

const SECTIONS = {
  overview: { label: '记忆与认知', href: '#memory', icon: 'database', path: './memory-view.js?v=1.16.0', mount: 'mountMemoryView' },
  decision: { label: '决策复盘', href: '#memory/decision', path: './decision-view.js?v=1.16.0', mount: 'mountDecisionView' },
  import: { label: '导入聊天记录', href: '#memory/import', icon: 'upload', path: './chat-import-view.js?v=1.16.0', mount: 'mountChatImportView' },
  service: { label: '记忆库服务', href: '#memory/service', icon: 'settings', path: './memory-service-view.js?v=1.16.0', mount: 'mountMemoryServiceView' },
};

export function mountMemoryHubView(container, { section = 'overview' } = {}) {
  const panels = new Map();
  let activeSection = null;
  let disposed = false;
  const content = el('div', { class: 'memory-hub-content' });
  const links = Object.entries(SECTIONS).filter(([key]) => key !== 'decision').map(([key, config]) => el('a', {
    class: 'memory-hub-link', href: config.href, dataset: { section: key },
  }, [el('span', { class: 'memory-hub-icon', html: icon(config.icon, 16), 'aria-hidden': 'true' }), config.label]));
  const cognitionLinks = ['overview', 'decision'].map((key) => el('a', {
    class: 'memory-cognition-link', href: SECTIONS[key].href, dataset: { section: key },
    text: key === 'overview' ? '记忆管理' : '决策复盘',
  }));
  const cognitionNav = el('nav', { class: 'memory-cognition-nav', 'aria-label': '记忆与认知功能导航' }, cognitionLinks);

  container.replaceChildren(el('div', { class: 'memory-hub' }, [
    el('header', { class: 'memory-hub-header' }, [
      el('h1', { class: 'page-title', text: '记忆中心' }),
      el('p', { class: 'page-sub', text: '管理长期记忆、整理对话证据，连接记忆库服务。' }),
      el('nav', { class: 'memory-hub-nav', 'aria-label': '记忆中心二级菜单' }, links),
    ]),
    cognitionNav,
    content,
  ]));

  async function loadPanel(key, entry) {
    const config = SECTIONS[key];
    entry.node.replaceChildren(el('div', { class: 'view-loading', role: 'status', text: '正在打开页面…' }));
    try {
      const module = await import(config.path);
      if (disposed || entry.disposed) return;
      entry.cleanup = await module[config.mount](entry.node);
      if (disposed || entry.disposed) {
        entry.cleanup?.();
        return;
      }
      // The hub owns the page heading; each nested page has a section heading.
      const heading = entry.node.querySelector('.page-header h1');
      if (heading) heading.replaceWith(el('h2', { class: heading.className, text: heading.textContent }));
      entry.node.removeAttribute('aria-busy');
    } catch (error) {
      if (disposed || entry.disposed) return;
      entry.node.removeAttribute('aria-busy');
      entry.node.replaceChildren(el('div', { class: 'empty' }, [
        el('div', { class: 'empty-title', text: '页面加载失败' }),
        el('p', { class: 'empty-desc', text: error.message || '请重试' }),
        el('button', { class: 'btn btn-soft', type: 'button', text: '重新加载', onClick: () => {
          entry.node.setAttribute('aria-busy', 'true');
          loadPanel(key, entry);
        } }),
      ]));
    }
  }

  function removePanel(key) {
    const entry = panels.get(key);
    if (!entry) return;
    entry.disposed = true;
    entry.cleanup?.();
    entry.node.remove();
    panels.delete(key);
  }

  function setSection(next) {
    if (disposed) return;
    const key = Object.hasOwn(SECTIONS, next) ? next : 'overview';
    if (activeSection === key) return;
    // Refresh memory after imports or confirmed reviews; retain the review form and results.
    if (activeSection === 'overview') removePanel('overview');
    activeSection = key;
    const cognitionActive = key === 'overview' || key === 'decision';
    cognitionNav.hidden = !cognitionActive;
    links.forEach((link) => {
      const active = link.dataset.section === (key === 'decision' ? 'overview' : key);
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', key === 'decision' ? 'location' : 'page');
      else link.removeAttribute('aria-current');
    });
    cognitionLinks.forEach((link) => {
      const active = link.dataset.section === key;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    for (const [name, entry] of panels) entry.node.hidden = name !== key;
    if (!panels.has(key)) {
      const entry = { node: el('section', { class: 'memory-hub-panel', 'aria-label': SECTIONS[key].label, 'aria-busy': 'true' }), cleanup: null, disposed: false };
      panels.set(key, entry);
      content.append(entry.node);
      loadPanel(key, entry);
    }
  }

  setSection(section);
  const cleanup = () => {
    disposed = true;
    for (const key of [...panels.keys()]) removePanel(key);
  };
  cleanup.setSection = setSection;
  return cleanup;
}
