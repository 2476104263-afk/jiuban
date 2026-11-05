/* ==========================================================================
   jiuban · 简化的 DeepSeek API Key 小窗口
   面向第一次使用 AI 的用户：粘贴 Key → 点刷新测试 → 保存
   ========================================================================== */

import { store } from './store.js';
import { el, icon, toast, modal } from './util.js';
import { DEFAULT_BASE_URL, testConnection } from './api.js';

const GET_KEY_URL = 'https://platform.deepseek.com/api_keys';

function setStatus(node, state, text) {
  node.dataset.state = state;
  const textNode = node.querySelector('.api-key-status-text');
  if (textNode) textNode.textContent = text;
}

export function openApiKeyDialog({ onSaved } = {}) {
  const settings = store.settings;
  let dialog = null;
  let testing = false;
  let saving = false;

  /* ---------- 表单 ---------- */
  const keyInput = el('input', {
    class: 'input api-key-input',
    id: 'api-key-input',
    type: 'password',
    placeholder: 'sk-................',
    value: settings.apiKey || '',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'DeepSeek API Key',
  });

  const eyeBtn = el(
    'button',
    {
      class: 'btn-icon api-key-eye',
      type: 'button',
      title: '显示 / 隐藏',
      'aria-label': '显示或隐藏 API Key',
    },
    [el('span', { html: icon('eye', 17) })]
  );

  const refreshBtn = el(
    'button',
    {
      class: 'api-key-refresh',
      type: 'button',
      title: '测试连接',
      'aria-label': '测试连接',
    },
    [el('span', { class: 'api-key-refresh-icon', html: icon('refresh', 17) })]
  );

  const keyGroup = el('div', { class: 'api-key-input-group' }, [keyInput, eyeBtn, refreshBtn]);

  const status = el('div', { class: 'api-key-status', role: 'status', 'aria-live': 'polite' }, [
    el('span', { class: 'api-key-status-dot', 'aria-hidden': 'true' }),
    el('span', { class: 'api-key-status-text', text: '粘贴 Key 后，点右侧的刷新按钮测试一下' }),
  ]);

  const getKeyLink = el(
    'a',
    { class: 'api-key-link', href: GET_KEY_URL, target: '_blank', rel: 'noopener noreferrer' },
    [el('span', { text: '还没有 Key？去 DeepSeek 获取' }), el('span', { html: icon('external', 12) })]
  );

  const baseUrlInput = el('input', {
    class: 'input',
    id: 'api-key-base-url',
    type: 'text',
    value: settings.baseUrl || DEFAULT_BASE_URL,
    placeholder: DEFAULT_BASE_URL,
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const modelInput = el('input', {
    class: 'input',
    id: 'api-key-model',
    type: 'text',
    value: settings.model || 'deepseek-flash',
    placeholder: 'deepseek-flash',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const advanced = el('details', { class: 'api-key-advanced' }, [
    el('summary', { text: '高级选项（一般不用改）' }),
    el('div', { class: 'api-key-advanced-fields' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'api-key-base-url' }, [
          el('span', { text: '接口地址' }),
          el('span', { class: 'optional', text: '默认即可' }),
        ]),
        baseUrlInput,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'api-key-model' }, [
          el('span', { text: '模型名称' }),
          el('span', { class: 'optional', text: '默认 deepseek-flash' }),
        ]),
        modelInput,
      ]),
    ]),
  ]);

  const security = el('div', { class: 'api-key-security' }, [
    el('span', { html: icon('shield', 14) }),
    el('span', { text: 'Key 只保存在这台电脑的浏览器里，不会上传到其他服务器。' }),
  ]);

  const dialogBody = el('div', { class: 'api-key-dialog' }, [
    el('p', {
      class: 'api-key-intro',
      text: '把 DeepSeek 的 API Key 粘贴进来，久伴就能用真实大模型陪你聊天了。点「保存并连接」会自动帮你检查 Key 是否可用。',
    }),
    el('div', { class: 'field api-key-field' }, [
      el('label', { class: 'label', for: 'api-key-input' }, [
        el('span', { text: 'API Key' }),
        el('span', { class: 'optional', text: '以 sk- 开头' }),
      ]),
      keyGroup,
      status,
    ]),
    el('div', { class: 'api-key-help-row' }, [
      getKeyLink,
      el('span', { class: 'api-key-help-hint', text: '第一次使用可以先点「以后再说」体验演示模式' }),
    ]),
    advanced,
    security,
  ]);

  const footer = [
    el('button', { class: 'btn btn-ghost', type: 'button', onClick: () => dialog.close() }, '以后再说'),
    el(
      'button',
      {
        class: 'btn btn-primary api-key-save',
        type: 'button',
        onClick: () => handleSave(),
      },
      '保存并连接'
    ),
  ];

  if (settings.apiKey) {
    dialogBody.append(
      el(
        'button',
        {
          class: 'api-key-clear',
          type: 'button',
          onClick: () => {
            store.updateSettings({ apiKey: '' });
            dialog.close();
            toast('已断开连接，当前为演示模式', 'info');
          },
        },
        '清除已保存的 Key'
      )
    );
  }

  /* ---------- 交互 ---------- */
  let eyeVisible = false;
  eyeBtn.addEventListener('click', () => {
    eyeVisible = !eyeVisible;
    keyInput.type = eyeVisible ? 'text' : 'password';
    eyeBtn.setAttribute('aria-label', eyeVisible ? '隐藏 API Key' : '显示 API Key');
    eyeBtn.innerHTML = icon(eyeVisible ? 'eye-off' : 'eye', 17);
    keyInput.focus();
  });

  refreshBtn.addEventListener('click', () => {
    testKey();
  });
  keyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      testKey();
    }
  });

  async function testKey() {
    if (testing) return;
    const apiKey = keyInput.value.trim();
    if (!apiKey) {
      setStatus(status, 'error', '请先粘贴 API Key');
      keyInput.focus();
      return;
    }
    const baseUrl = baseUrlInput.value.trim() || DEFAULT_BASE_URL;
    testing = true;
    refreshBtn.classList.add('is-loading');
    refreshBtn.disabled = true;
    setStatus(status, 'loading', '正在测试连接…');
    let result = null;
    try {
      result = await testConnection({ ...store.settings, apiKey, baseUrl });
    } catch (err) {
      result = { ok: false, message: (err && err.message) || '测试失败，请稍后再试' };
    }
    testing = false;
    refreshBtn.classList.remove('is-loading');
    refreshBtn.disabled = false;
    if (result && result.ok) {
      const latency = Number.isFinite(result.latency) && result.latency > 0 ? ` · ${Math.round(result.latency)}ms` : '';
      setStatus(status, 'success', `连接成功${latency}，保存后就能聊天啦`);
    } else {
      setStatus(status, 'error', (result && result.message) || '连接失败，请检查 Key 是否复制完整');
    }
  }

  async function handleSave() {
    if (saving || testing) return;
    const apiKey = keyInput.value.trim();
    const baseUrl = baseUrlInput.value.trim() || DEFAULT_BASE_URL;
    if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
      setStatus(status, 'error', '接口地址需要以 http:// 或 https:// 开头');
      return;
    }
    if (!apiKey) {
      store.updateSettings({ apiKey: '', baseUrl });
      dialog.close();
      toast('已清除连接，当前为演示模式', 'info');
      return;
    }

    saving = true;
    const saveBtn = dialog && dialog.footer.querySelector('.api-key-save');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '正在连接…';
    }
    setStatus(status, 'loading', '正在测试连接，请稍等…');
    let result = null;
    try {
      result = await testConnection({ ...store.settings, apiKey, baseUrl });
    } catch (err) {
      result = { ok: false, message: (err && err.message) || '连接失败，请稍后再试' };
    }
    saving = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存并连接';
    }
    if (!result || !result.ok) {
      setStatus(status, 'error', (result && result.message) || '连接失败，请检查 API Key 是否复制完整');
      return;
    }
    const model = modelInput.value.trim() || 'deepseek-flash';
    store.updateSettings({ apiKey, baseUrl, model });
    dialog.close();
    toast('连接成功，开始和久伴聊天吧 🎉', 'success', 2600);
    if (typeof onSaved === 'function') onSaved();
  }

  dialog = modal({
    title: '连接 DeepSeek',
    body: dialogBody,
    footer,
    onClose: () => {
      dialog = null;
    },
  });
  return dialog;
}
