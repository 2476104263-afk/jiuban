import { el, icon } from './util.js';

const SECTIONS = {
  overview: { label: '记忆与认知', description: '保留重要的经历、偏好与计划，让每次对话自然延续。', href: '#memory', icon: 'database', path: './memory-view.js?v=1.17.0', mount: 'mountMemoryView' },
  decision: { label: '决策复盘', description: '以记忆为依据，比较选择，再记录真实发生的结果。', href: '#memory/decision', path: './decision-view.js?v=1.17.0', mount: 'mountDecisionView' },
  import: { label: '导入聊天记录', description: '选择记录来源，预览对话，再保存你希望记住的片段。', href: '#memory/import', icon: 'upload', path: './chat-import-view.js?v=1.17.0', mount: 'mountChatImportView' },
  service: { label: '记忆库服务', description: '连接本机服务，管理检索、记忆确认与日记同步。', href: '#memory/service', icon: 'settings', path: './memory-service-view.js?v=1.17.0', mount: 'mountMemoryServiceView' },
};

export function mountMemoryHubView(container, { section = 'overview' } = {}) {
  const panels = new Map();
  let activeSection = null;
  let disposed = false;
  const content = el('div', { class: 'memory-hub-content' });
  const title = el('h1', { class: 'page-title', text: '记忆与认知' });
  const subtitle = el('p', { class: 'page-sub' });
  const headerActions = el('div', { class: 'memory-hub-actions' });
  const links = Object.entries(SECTIONS).filter(([key]) => key !== 'decision').map(([key, config]) => el('a', {
    class: 'memory-hub-link', href: config.href, dataset: { section: key },
    'aria-label': config.label,
  }, [el('span', { class: 'memory-hub-icon', html: icon(config.icon, 16), 'aria-hidden': 'true' }), ({ overview: '记忆', import: '聊天导入', service: '服务连接' })[key]]));
  const cognitionLinks = ['overview', 'decision'].map((key) => el('a', {
    class: 'memory-cognition-link', href: SECTIONS[key].href, dataset: { section: key },
    text: key === 'overview' ? '记忆管理' : '决策复盘',
  }));
  const cognitionNav = el('nav', { class: 'memory-cognition-nav', 'aria-label': '记忆与认知功能导航' }, cognitionLinks);

  container.replaceChildren(el('div', { class: 'memory-hub' }, [
    el('header', { class: 'memory-hub-header' }, [
      el('span', { class: 'section-eyebrow', text: '记忆中心' }),
      el('div', { class: 'memory-hub-heading' }, [title, headerActions]), subtitle,
      el('div', { class: 'memory-hub-controls' }, [el('nav', { class: 'memory-hub-nav', 'aria-label': '记忆中心二级菜单' }, links), cognitionNav]),
    ]),
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
      // 标题由中心统一呈现；子页面只保留开关、状态和连接等实际操作。
      const header = entry.node.querySelector('.page-header');
      const heading = header?.querySelector('h1');
      if (heading) {
        const copy = heading.parentElement === header ? heading : heading.parentElement;
        copy.remove();
        header.classList.add('hub-section-toolbar');
        if (key !== 'service') {
          entry.actions = [...header.children];
          if (activeSection === key) headerActions.replaceChildren(...entry.actions);
          header.remove();
        } else if (!header.children.length) header.hidden = true;
      }
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
    // 保留输入状态；重新进入记忆列表时刷新实际保存的数据。
    activeSection = key;
    title.textContent = SECTIONS[key].label;
    subtitle.textContent = SECTIONS[key].description;
    headerActions.replaceChildren(...(panels.get(key)?.actions || []));
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
    } else if (key === 'overview') {
      panels.get(key).cleanup?.refresh?.().catch(error => console.warn('[Memora] 刷新记忆失败', error));
    }
  }

  setSection(section);
  const cleanup = () => {
    disposed = true;
    for (const key of [...panels.keys()]) removePanel(key);
  };
  cleanup.setSection = setSection;
  cleanup.refresh = async () => { await panels.get(activeSection)?.cleanup?.refresh?.(); };
  return cleanup;
}
