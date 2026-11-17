/* ==========================================================================
   Memora · 设置页
   DeepSeek 连接状态与本地数据说明
   ========================================================================== */

import { store, subscribe } from './store.js';
import { el, icon, toast, confirmDialog } from './util.js';
import { openApiKeyDialog } from './api-key-dialog.js';

const APP_VERSION = 'v1.17.0';

function iconSpan(name, size = 16, className = 'settings-icon') {
  return el('span', { class: className, html: icon(name, size) });
}

function maskKey(key) {
  const value = String(key || '');
  if (!value) return '未填写';
  if (value.length <= 10) return `${value.slice(0, 3)}…`;
  return `${value.slice(0, 5)}…${value.slice(-4)}`;
}

export function mountSettingsView(container) {
  if (!container) return () => {};
  container.replaceChildren();

  const connectButton = el('button', {
    class: 'btn btn-primary',
    type: 'button',
    onClick: () => openApiKeyDialog(),
  }, [iconSpan('key', 15), '连接 DeepSeek']);
  const apiBadge = el('span', { class: 'badge badge-amber' });
  const apiDot = el('span', { class: 'status-dot' });
  const apiTitle = el('div', { class: 'settings-status-title' });
  const apiDesc = el('div', { class: 'settings-status-desc' });
  const apiKeyText = el('span', { class: 'settings-key-value' });

  const clearKeyButton = el('button', {
    class: 'btn btn-ghost',
    type: 'button',
    onClick: async () => {
      if (!store.settings.apiKey) return;
      const confirmed = await confirmDialog({
        title: '清除已保存的 API Key',
        message: '清除后，普通聊天和平行世界会回到本地演示模式。聊天记录和记忆不会删除。',
        confirmText: '清除',
        danger: true,
      });
      if (!confirmed) return;
      store.updateSettings({ apiKey: '' });
      toast('已清除 API Key，当前为本地演示模式。', 'info');
    },
  }, '清除 Key');

  const apiCard = el('section', { class: 'card settings-card' }, [
    el('div', { class: 'settings-card-head' }, [
      el('div', { class: 'settings-card-icon' }, [iconSpan('key', 20)]),
      el('div', { class: 'settings-card-title' }, [
        el('h2', { text: 'DeepSeek 连接' }),
        el('p', { text: '连接后可使用模型聊天；不连接也能体验本地演示。' }),
      ]),
      apiBadge,
    ]),
    el('div', { class: 'settings-status-row' }, [
      el('div', { class: 'settings-status-main' }, [el('div', { class: 'settings-status-head' }, [apiDot, apiTitle]), apiDesc]),
      el('div', { class: 'settings-key-row' }, [el('span', { class: 'settings-key-label', text: '当前 Key：' }), apiKeyText]),
    ]),
    el('div', { class: 'settings-actions-row' }, [connectButton, clearKeyButton]),
    el('div', { class: 'settings-hint' }, [
      iconSpan('shield', 14, 'settings-hint-icon'),
      el('span', { text: 'Key 保存在这台设备的浏览器中，并只会随模型请求发送到配置的接口。' }),
    ]),
  ]);

  const privacyCard = el('section', { class: 'card settings-card settings-privacy-card' }, [
    el('div', { class: 'settings-card-head' }, [
      el('div', { class: 'settings-card-icon is-dev' }, [iconSpan('database', 20)]),
      el('div', { class: 'settings-card-title' }, [
        el('h2', { text: '本地记忆与平行世界' }),
        el('p', { text: '人物档案、世界、智能体人格、独立记忆库和群聊记录保存在当前浏览器。' }),
      ]),
      el('span', { class: 'badge badge-blue', text: '本地保存' }),
    ]),
    el('div', { class: 'settings-hint' }, [
      iconSpan('shield', 14, 'settings-hint-icon'),
      el('span', { text: '平行世界调用模型前会说明本轮发送的世界设定、参与智能体记忆和群聊记录，并等待确认。记忆库可从各智能体页面导入或导出 JSON。' }),
    ]),
  ]);

  const header = el('header', { class: 'page-header settings-header' }, [
    el('div', { class: 'settings-header-text' }, [
      el('h1', { class: 'page-title' }, [el('span', { class: 'emoji', text: '⚙️' }), '设置']),
      el('p', { class: 'page-sub', text: '管理模型连接与本地数据说明' }),
    ]),
  ]);
  const body = el('div', { class: 'page-body scroll settings-body' }, [
    el('div', { class: 'settings-container' }, [
      el('div', { class: 'settings-section-title' }, [el('span', { text: '模型连接' }), el('span', { class: 'settings-section-hint', text: '可选' })]),
      apiCard,
      el('div', { class: 'settings-section-title' }, [el('span', { text: '数据保存' }), el('span', { class: 'settings-section-hint', text: '在本机浏览器' })]),
      privacyCard,
      el('div', { class: 'settings-about' }, [el('span', { text: `Memora ${APP_VERSION} · 本地运行 · 数据保存在你的浏览器` })]),
    ]),
  ]);
  container.append(el('div', { class: 'page settings-page' }, [header, body]));

  function renderApiStatus() {
    const hasKey = Boolean(store.settings.apiKey && store.settings.apiKey.trim());
    apiBadge.textContent = hasKey ? '已保存' : '未连接';
    apiBadge.className = `badge ${hasKey ? 'badge-green' : 'badge-amber'}`;
    apiDot.className = `status-dot ${hasKey ? 'is-ok' : 'is-demo'}`;
    apiTitle.textContent = hasKey ? 'DeepSeek 已连接' : '当前为本地演示模式';
    apiDesc.textContent = hasKey
      ? '模型请求使用当前配置的接口；可在连接窗口更换或检查 Key。'
      : '还没有填写 API Key。连接后可使用真实模型回复。';
    apiKeyText.textContent = maskKey(store.settings.apiKey);
    clearKeyButton.hidden = !hasKey;
  }

  renderApiStatus();
  const unsubscribe = subscribe('settings:changed', renderApiStatus);
  return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
}
