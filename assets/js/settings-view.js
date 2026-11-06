/* ==========================================================================
   jiuban · 设置页
   DeepSeek 连接状态 + 开发人员选项（添加内置插件 / 自定义插件 / 导入导出 / 重置）
   ========================================================================== */

import { store, subscribe } from './store.js';
import { el, icon, toast, confirmDialog, download } from './util.js';
import { pluginManager } from './plugins.js';
import { openApiKeyDialog } from './api-key-dialog.js';
import { openCustomPluginDialog } from './plugin-editor.js';

const APP_VERSION = 'v1.7.0';
const CONFIG_FILE = 'jiuban-plugins.json';

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
  container.innerHTML = '';

  let disposed = false;
  const cleanups = [];

  /* ------------------------------------------------------------------------
     静态骨架
     ------------------------------------------------------------------------ */
  const connectHeaderBtn = el(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      onClick: () => openApiKeyDialog(),
    },
    [iconSpan('key', 15), '连接 DeepSeek']
  );

  const header = el('header', { class: 'page-header settings-header' }, [
    el('div', { class: 'settings-header-text' }, [
      el('h1', { class: 'page-title' }, [el('span', { class: 'emoji', text: '⚙️' }), '设置']),
      el('p', { class: 'page-sub', text: '连接 DeepSeek，以及给想折腾的人准备的高级功能' }),
    ]),
    el('div', { class: 'settings-header-actions' }, [connectHeaderBtn]),
  ]);

  /* ---------- DeepSeek 连接卡片 ---------- */
  const apiBadge = el('span', { class: 'badge badge-amber' });
  const apiDot = el('span', { class: 'status-dot' });
  const apiTitle = el('div', { class: 'settings-status-title' });
  const apiDesc = el('div', { class: 'settings-status-desc' });
  const apiKeyText = el('span', { class: 'settings-key-value' });

  const clearKeyBtn = el(
    'button',
    {
      class: 'btn btn-ghost',
      type: 'button',
      onClick: async () => {
        if (!store.settings.apiKey) return;
        const confirmed = await confirmDialog({
          title: '清除已保存的 API Key',
          message: '清除后久伴会回到演示模式，聊天记录不会删除。',
          confirmText: '清除',
          danger: true,
        });
        if (!confirmed) return;
        store.updateSettings({ apiKey: '' });
        toast('已清除 API Key，当前为演示模式', 'info');
      },
    },
    '清除 Key'
  );

  const apiCard = el('section', { class: 'card settings-card' }, [
    el('div', { class: 'settings-card-head' }, [
      el('div', { class: 'settings-card-icon' }, [iconSpan('key', 20)]),
      el('div', { class: 'settings-card-title' }, [
        el('h2', { text: 'DeepSeek 连接' }),
        el('p', { text: '连接后，久伴会用真实大模型回复；不连接也能使用演示模式。' }),
      ]),
      apiBadge,
    ]),
    el('div', { class: 'settings-status-row' }, [
      el('div', { class: 'settings-status-main' }, [
        el('div', { class: 'settings-status-head' }, [apiDot, apiTitle]),
        apiDesc,
      ]),
      el('div', { class: 'settings-key-row' }, [
        el('span', { class: 'settings-key-label', text: '当前 Key：' }),
        apiKeyText,
      ]),
    ]),
    el('div', { class: 'settings-actions-row' }, [connectHeaderBtn.cloneNode(true), clearKeyBtn]),
    el('div', { class: 'settings-hint' }, [
      iconSpan('shield', 14, 'settings-hint-icon'),
      el('span', { text: 'Key 只保存在这台电脑的浏览器里，不会上传到其他服务器。' }),
    ]),
  ]);

  // 让卡片里的“连接”按钮也打开同一个窗口
  apiCard.querySelector('.settings-actions-row .btn').addEventListener('click', () => {
    openApiKeyDialog();
  });

  /* ---------- 开发人员选项 ---------- */
  const installedList = el('div', { class: 'settings-dev-list' });
  const builtinList = el('div', { class: 'settings-dev-list' });

  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'sr-only',
    'aria-hidden': 'true',
    tabIndex: -1,
  });

  const importBtn = el(
    'button',
    { class: 'btn', type: 'button', onClick: () => fileInput.click() },
    [iconSpan('upload', 15), '导入插件配置']
  );
  const exportBtn = el(
    'button',
    {
      class: 'btn',
      type: 'button',
      onClick: () => {
        try {
          const config = pluginManager.exportConfig();
          download(CONFIG_FILE, JSON.stringify(config, null, 2), 'application/json');
          toast(`已导出插件配置 ${CONFIG_FILE}`, 'success');
        } catch (err) {
          toast(`导出失败：${(err && err.message) || '未知错误'}`, 'error');
        }
      },
    },
    [iconSpan('download', 15), '导出插件配置']
  );

  const devMeta = el('div', { class: 'settings-dev-meta' });

  const devCard = el('section', { class: 'card settings-card settings-dev-card' }, [
    el('div', { class: 'settings-card-head' }, [
      el('div', { class: 'settings-card-icon is-dev' }, [iconSpan('terminal', 20)]),
      el('div', { class: 'settings-card-title' }, [
        el('h2', { text: '开发人员选项' }),
        el('p', { text: '给想自己添加插件、迁移配置的用户。普通聊天不需要打开这里。' }),
      ]),
      el('span', { class: 'badge badge-blue', text: '进阶' }),
    ]),

    el('div', { class: 'settings-dev-section' }, [
      el('div', { class: 'settings-dev-title' }, [
        el('span', { html: icon('check-circle', 16) }),
        el('span', { text: '已安装插件' }),
        el('span', { class: 'settings-dev-sub', text: '可启用 / 停用或卸载' }),
      ]),
      installedList,
    ]),

    el('div', { class: 'settings-dev-section' }, [
      el('div', { class: 'settings-dev-title' }, [
        el('span', { html: icon('layers', 16) }),
        el('span', { text: '添加内置插件' }),
        el('span', { class: 'settings-dev-sub', text: '默认已安装 4 个，其余可按需添加' }),
      ]),
      builtinList,
    ]),

    el('div', { class: 'settings-dev-section' }, [
      el('div', { class: 'settings-dev-title' }, [
        el('span', { html: icon('sparkles', 16) }),
        el('span', { text: '自定义插件' }),
        el('span', { class: 'settings-dev-sub', text: '用一段提示词给久伴增加专属技能' }),
      ]),
      el('div', { class: 'settings-dev-empty' }, [
        el('span', {
          text: '自定义插件会出现在上方的「已安装插件」里，可随时编辑或删除。',
        }),
      ]),
      el(
        'button',
        {
          class: 'btn btn-soft settings-dev-add',
          type: 'button',
          onClick: () => openCustomPluginDialog(null, { onSaved: renderDev }),
        },
        [iconSpan('plus', 15), '添加自定义插件']
      ),
    ]),

    el('div', { class: 'settings-dev-section' }, [
      el('div', { class: 'settings-dev-title' }, [
        el('span', { html: icon('database', 16) }),
        el('span', { text: '插件配置' }),
        el('span', { class: 'settings-dev-sub', text: '用于备份或在设备间迁移' }),
      ]),
      el('div', { class: 'settings-dev-actions' }, [importBtn, exportBtn]),
    ]),

    el('div', { class: 'settings-dev-section settings-dev-danger' }, [
      el('div', { class: 'settings-dev-title' }, [
        el('span', { html: icon('alert-triangle', 16) }),
        el('span', { text: '重置插件' }),
        el('span', { class: 'settings-dev-sub', text: '恢复默认 4 个插件，并删除自定义插件' }),
      ]),
      el(
        'button',
        {
          class: 'btn btn-danger',
          type: 'button',
          onClick: async () => {
            const confirmed = await confirmDialog({
              title: '重置插件？',
              message: '将恢复默认预装插件，并删除所有自定义插件，此操作不可撤销。',
              confirmText: '重置插件',
              danger: true,
            });
            if (!confirmed) return;
            pluginManager.reset();
            toast('插件已恢复默认状态', 'success');
          },
        },
        [iconSpan('refresh', 15), '重置插件配置']
      ),
    ]),

    devMeta,
  ]);

  const body = el('div', { class: 'page-body scroll settings-body' }, [
    el('div', { class: 'settings-container' }, [
      el('div', { class: 'settings-section-title' }, [
        el('span', { text: '账户与连接' }),
        el('span', { class: 'settings-section-hint', text: '只需要做一次' }),
      ]),
      apiCard,
      el('div', { class: 'settings-section-title' }, [
        el('span', { text: '高级功能' }),
        el('span', { class: 'settings-section-hint', text: '可选' }),
      ]),
      devCard,
      el('div', { class: 'settings-about' }, [
        el('span', { text: `久伴 ${APP_VERSION} · 本地运行 · 数据保存在你的浏览器` }),
      ]),
    ]),
  ]);

  const page = el('div', { class: 'page settings-page' }, [header, body]);
  container.append(page);
  container.append(fileInput);

  /* ------------------------------------------------------------------------
     渲染
     ------------------------------------------------------------------------ */
  function renderApiStatus() {
    const hasKey = Boolean(store.settings.apiKey && store.settings.apiKey.trim());
    apiBadge.textContent = hasKey ? '已保存' : '未连接';
    apiBadge.className = `badge ${hasKey ? 'badge-green' : 'badge-amber'}`;
    apiDot.className = `status-dot ${hasKey ? 'is-ok' : 'is-demo'}`;
    apiTitle.textContent = hasKey ? 'DeepSeek 已连接' : '当前为演示模式';
    apiDesc.textContent = hasKey
      ? '发起聊天时会使用真实大模型；如果 Key 失效，可在连接窗口中重新检查。'
      : '还没有填写 API Key，久伴会先用本地规则回复。连接后就能使用真实大模型。';
    apiKeyText.textContent = maskKey(store.settings.apiKey);
    clearKeyBtn.hidden = !hasKey;
  }

  function buildBuiltinRow(plugin) {
    return el('div', { class: 'settings-dev-item', dataset: { pluginId: plugin.id } }, [
      el('div', { class: 'settings-dev-icon', text: plugin.icon }),
      el('div', { class: 'settings-dev-info' }, [
        el('div', { class: 'settings-dev-name' }, [
          el('span', { text: plugin.name }),
          el('span', {
            class: 'badge badge-blue settings-dev-badge',
            text: plugin.kind === 'tool' ? '工具' : '提示词',
          }),
        ]),
        el('div', { class: 'settings-dev-desc', text: plugin.desc || '暂无描述' }),
      ]),
      el(
        'button',
        {
          class: 'btn btn-sm btn-soft',
          type: 'button',
          onClick: () => {
            const ok = pluginManager.install(plugin.id);
            toast(ok ? `已添加「${plugin.name}」` : `「${plugin.name}」已经添加过了`, ok ? 'success' : 'info', 1800);
          },
        },
        [iconSpan('plus', 13), '添加']
      ),
    ]);
  }

  function buildInstalledRow(plugin) {
    const actions = el('div', { class: 'settings-dev-installed-actions' });
    if (plugin.custom) {
      actions.append(
        el(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            type: 'button',
            title: '编辑这个自定义插件',
            onClick: () => openCustomPluginDialog(plugin, { onSaved: renderDev }),
          },
          [iconSpan('edit', 13), '编辑']
        )
      );
    }
    actions.append(
      el(
        'button',
        {
          class: 'btn btn-sm btn-danger',
          type: 'button',
          title: plugin.custom ? '删除这个自定义插件' : '卸载这个内置插件',
          onClick: async () => {
            const confirmed = await confirmDialog({
              title: plugin.custom ? '删除自定义插件' : '卸载插件',
              message: plugin.custom
                ? `确定要删除「${plugin.name}」吗？删除后无法恢复。`
                : `确定卸载「${plugin.name}」吗？之后可以在「添加内置插件」里重新添加。`,
              confirmText: plugin.custom ? '删除' : '卸载',
              danger: true,
            });
            if (!confirmed) return;
            if (plugin.custom) pluginManager.removeCustom(plugin.id);
            else pluginManager.uninstall(plugin.id);
            toast(plugin.custom ? '已删除自定义插件' : `已卸载「${plugin.name}」`, 'success');
          },
        },
        [iconSpan('trash', 13), plugin.custom ? '删除' : '卸载']
      )
    );

    return el('div', { class: 'settings-dev-item' }, [
      el('div', { class: 'settings-dev-icon', text: plugin.icon }),
      el('div', { class: 'settings-dev-info' }, [
        el('div', { class: 'settings-dev-name' }, [
          el('span', { text: plugin.name }),
          el('span', { class: 'badge badge-blue settings-dev-badge', text: plugin.kind === 'tool' ? '工具' : '提示词' }),
          plugin.custom ? el('span', { class: 'badge settings-dev-badge', text: '自定义' }) : null,
        ]),
        el('div', { class: 'settings-dev-desc', text: plugin.desc || '暂无描述' }),
      ]),
      el(
        'button',
        {
          class: 'switch settings-switch',
          type: 'button',
          role: 'switch',
          'aria-checked': plugin.enabled ? 'true' : 'false',
          'aria-label': `${plugin.enabled ? '停用' : '启用'}插件「${plugin.name}」`,
          title: plugin.enabled ? '点击停用' : '点击启用',
          onClick: () => {
            const enabled = pluginManager.toggle(plugin.id);
            toast(
              enabled ? `已启用「${plugin.name}」` : `已停用「${plugin.name}」`,
              enabled ? 'success' : 'info',
              1600
            );
          },
        }
      ),
      actions,
    ]);
  }

  function renderDev() {
    const installed = pluginManager.listInstalled();
    installedList.innerHTML = '';
    if (!installed.length) {
      installedList.append(
        el('div', { class: 'settings-dev-empty' }, [
          el('span', { text: '当前没有已安装的插件，可以从下方添加。' }),
        ])
      );
    } else {
      for (const plugin of installed) installedList.append(buildInstalledRow(plugin));
    }

    const availableBuiltins = pluginManager.listMarket();
    builtinList.innerHTML = '';
    if (!availableBuiltins.length) {
      builtinList.append(
        el('div', { class: 'settings-dev-empty' }, [
          iconSpan('check-circle', 15),
          el('span', { text: '所有内置插件都已添加' }),
        ])
      );
    } else {
      for (const plugin of availableBuiltins) builtinList.append(buildBuiltinRow(plugin));
    }

    const snapshot = pluginManager.getSnapshot();
    devMeta.textContent = `已安装 ${snapshot.installedCount} 个插件 · 自定义 ${snapshot.customCount} 个 · 存储位置 localStorage: jiuban.plugins.v1`;
  }

  function renderAll() {
    renderApiStatus();
    renderDev();
  }

  async function handleImportFile() {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const result = pluginManager.importConfig(text);
      toast(result.message, result.ok ? 'success' : 'error', result.ok ? 2800 : 3600);
    } catch (err) {
      const isJsonError = err instanceof SyntaxError;
      toast(
        isJsonError
          ? '导入失败：JSON 格式不正确，请检查文件内容'
          : `导入失败：${(err && err.message) || '无法读取文件'}`,
        'error',
        3400
      );
    }
  }

  fileInput.addEventListener('change', handleImportFile);
  cleanups.push(() => fileInput.remove());
  cleanups.push(
    subscribe('settings:changed', () => {
      if (!disposed) renderApiStatus();
    })
  );
  cleanups.push(
    pluginManager.subscribe(() => {
      if (!disposed) renderDev();
    })
  );

  renderAll();

  return function cleanup() {
    disposed = true;
    for (const fn of cleanups) {
      try {
        fn();
      } catch (err) {
        /* 忽略 */
      }
    }
  };
}
