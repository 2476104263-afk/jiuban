/* ==========================================================================
   jiuban · 自定义插件编辑器（设置页使用）
   ========================================================================== */

import { el, toast, modal } from './util.js';
import { pluginManager, MAX_CUSTOM_PLUGINS } from './plugins.js';

const ICON_CHOICES = ['🧩', '🤖', '✍️', '🎨', '📚', '🔍', '📊', '🧠', '💡', '🎧', '🧪', '🌿'];

function field(labelText, control, hintText) {
  return el('div', { class: 'field plugins-field' }, [
    el('label', { class: 'label', text: labelText }),
    control,
    hintText ? el('div', { class: 'hint', text: hintText }) : null,
  ]);
}

/**
 * 打开「添加 / 编辑自定义插件」弹窗。
 * @param {object|null} plugin 传入则编辑，否则新增
 * @param {{ onSaved?: Function }} options
 */
export function openCustomPluginDialog(plugin = null, { onSaved } = {}) {
  const editing = Boolean(plugin);

  if (
    !editing &&
    pluginManager.listInstalled().filter((item) => item.custom).length >= MAX_CUSTOM_PLUGINS
  ) {
    toast(`自定义插件最多 ${MAX_CUSTOM_PLUGINS} 个，请先删除一些`, 'warning');
    return null;
  }

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    maxlength: '20',
    placeholder: '例如：健身教练',
    value: editing ? plugin.name : '',
    autocomplete: 'off',
    'aria-label': '插件名称',
  });
  const iconInput = el('input', {
    class: 'input plugins-icon-input',
    type: 'text',
    maxlength: '8',
    placeholder: '🧩',
    value: editing ? plugin.icon : '🧩',
    autocomplete: 'off',
    'aria-label': '插件图标 emoji',
  });
  const iconChoices = el(
    'div',
    { class: 'plugins-icon-choices' },
    ICON_CHOICES.map((emoji) =>
      el(
        'button',
        {
          class: 'plugins-icon-choice',
          type: 'button',
          title: `使用 ${emoji} 作为图标`,
          onClick: () => {
            iconInput.value = emoji;
            iconInput.focus();
          },
        },
        emoji
      )
    )
  );
  const descInput = el('input', {
    class: 'input',
    type: 'text',
    maxlength: '80',
    placeholder: '一句话说明这个插件能做什么（选填）',
    value: editing ? plugin.desc : '',
    autocomplete: 'off',
    'aria-label': '插件简介',
  });
  const promptInput = el('textarea', {
    class: 'textarea plugins-prompt-input',
    rows: '5',
    maxlength: '2000',
    placeholder:
      '例如：你是一位专业健身教练，根据用户的身体情况与目标，给出每周训练计划与饮食建议…',
    'aria-label': '插件提示词',
  });
  promptInput.value = editing ? plugin.prompt : '';

  const errorNode = el('div', { class: 'plugins-form-error', role: 'alert', hidden: true });
  const form = el('div', { class: 'plugins-form' }, [
    field('插件名称（必填，最多 20 字）', nameInput),
    el('div', { class: 'plugins-form-row' }, [
      field('图标', iconInput),
      el('div', { class: 'field plugins-field plugins-icon-field' }, [
        el('label', { class: 'label', text: '快速选择' }),
        iconChoices,
      ]),
    ]),
    field('简介（选填，最多 80 字）', descInput),
    field(
      '提示词（必填，10–2000 字）',
      promptInput,
      '这段文字会注入系统提示词，告诉久伴该扮演什么角色、遵守什么规则。'
    ),
    el('div', { class: 'hint plugins-form-count', text: '' }),
  ]);
  const counter = form.querySelector('.plugins-form-count');

  const updateCounter = () => {
    const length = Array.from(promptInput.value.trim()).length;
    counter.textContent = `提示词 ${length} / 2000 字`;
    counter.classList.toggle('is-warn', length > 0 && length < 10);
  };
  promptInput.addEventListener('input', updateCounter);
  updateCounter();

  const showError = (message) => {
    errorNode.hidden = false;
    errorNode.textContent = message;
  };
  const clearError = () => {
    errorNode.hidden = true;
    errorNode.textContent = '';
  };

  let dialog = null;

  const submit = () => {
    clearError();
    const name = nameInput.value.trim();
    const prompt = promptInput.value.trim();
    if (!name) {
      showError('请填写插件名称');
      nameInput.focus();
      return;
    }
    if (Array.from(name).length > 20) {
      showError('插件名称不能超过 20 个字');
      nameInput.focus();
      return;
    }
    if (Array.from(prompt).length < 10) {
      showError('提示词至少需要 10 个字');
      promptInput.focus();
      return;
    }
    const payload = {
      name,
      icon: iconInput.value.trim() || '🧩',
      desc: descInput.value.trim(),
      prompt,
      category: '自定义',
    };
    try {
      if (editing) pluginManager.updateCustom(plugin.id, payload);
      else pluginManager.addCustom(payload);
      dialog.close();
      toast(editing ? `已更新插件「${name}」` : `已添加插件「${name}」并启用`, 'success');
      if (typeof onSaved === 'function') onSaved();
    } catch (err) {
      showError((err && err.message) || '保存失败，请检查输入');
    }
  };

  dialog = modal({
    title: editing ? '编辑自定义插件' : '添加自定义插件',
    wide: true,
    body: el('div', {}, [form, errorNode]),
    footer: [
      el('button', { class: 'btn btn-ghost', type: 'button', onClick: () => dialog.close() }, '取消'),
      el(
        'button',
        { class: 'btn btn-primary', type: 'button', onClick: submit },
        editing ? '保存修改' : '添加插件'
      ),
    ],
  });

  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
  descInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  });

  setTimeout(() => nameInput.focus(), 40);
  return dialog;
}
