import {
  addManualMemory, clearMemories, COMPANION_MEMORY_SCOPE, deleteMemory, exportMemorySnapshot, getCognitionState, getMemoryStorageStats,
  importMemorySnapshot, listMemories, memoryEnabled, rebuildMemoryIndex, setCognitionState, setMemoryEnabled,
} from './memory.js?v=1.9.8';
import { createMemoryCloud } from './memory-cloud.js?v=1.9.3';
import { store } from './store.js';
import { LANGUAGE_STYLES } from './language-style.js?v=1.9.5';
import { el, toast, confirmDialog, download } from './util.js';

const KINDS = { episode: '经历', fact: '事实', preference: '偏好', relation: '关系', goal: '计划', reflection: '认知' };

export async function mountMemoryView(container) {
  const convId = COMPANION_MEMORY_SCOPE;
  const memories = el('div', { class: 'memory-list' });
  const search = el('input', { class: 'input memory-search', placeholder: '搜索记忆…' });
  const formInput = el('textarea', { class: 'memory-compose-input', rows: 2, placeholder: '例如：我喜欢先看结论，再看详细解释。' });
  const kind = el('select', { class: 'input memory-kind' }, Object.entries(KINDS).map(([value, label]) => el('option', { value, text: label })));
  let cognition = getCognitionState();
  const enabled = el('button', { class: 'memory-toggle', type: 'button', role: 'switch' });
  const countBadge = el('span', { class: 'memory-count', text: '0' });
  const rows = await listMemories(convId);
  const memoryCloud = createMemoryCloud(rows);
  const indexValue = el('b', { text: '读取中' });
  const payloadValue = el('b', { text: '读取中' });
  const rebuildButton = el('button', { class: 'btn btn-ghost memory-rebuild-btn', type: 'button', text: '从大库重建索引', onClick: async () => {
    try {
      await rebuildMemoryIndex();
      await renderStorageStats();
      toast('小库索引已从完整记忆重建', 'success');
    } catch (error) { toast(`重建失败：${error.message}`, 'error'); }
  } });

  async function renderStorageStats() {
    const stats = await getMemoryStorageStats(convId);
    indexValue.textContent = `${stats.indexCount} 条索引`;
    payloadValue.textContent = `${stats.payloadCount} 条完整记忆`;
  }

  function renderList() {
    memoryCloud.update(rows, search.value);
    countBadge.textContent = String(rows.filter((item) => item.status === 'active').length);
    memories.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const visible = rows.filter((row) => !query || `${row.content} ${(row.tags || []).join(' ')}`.toLowerCase().includes(query));
    if (!visible.length) {
      memories.append(el('div', { class: 'memory-empty', text: query ? '没有找到匹配的记忆' : '还没有记忆。聊天中说“记住：……”可保存，也可以在下方手动添加。' }));
      return;
    }
    for (const row of visible) {
      const remove = el('button', { class: 'btn-icon memory-remove', type: 'button', title: '删除记忆', text: '×', onClick: async () => {
        await deleteMemory(row.id);
        rows.splice(rows.indexOf(row), 1);
        renderList();
        await renderStorageStats();
        toast('已删除这条记忆', 'info', 1400);
      } });
      memories.append(el('article', { class: 'memory-item' }, [
        el('div', { class: 'memory-item-top' }, [
          el('span', { class: `memory-type-tag is-${row.kind}`, text: KINDS[row.kind] || '记忆' }),
          el('span', { class: 'memory-date', text: new Date(row.createdAt || row.eventTime).toLocaleDateString('zh-CN') }), remove,
        ]),
        el('p', { class: 'memory-content', text: row.content }),
        row.tags?.length ? el('div', { class: 'memory-tags', text: row.tags.map((tag) => `#${tag}`).join('  ') }) : null,
      ]));
    }
  }

  function renderEnabled() {
    enabled.classList.toggle('is-on', memoryEnabled());
    enabled.setAttribute('aria-checked', memoryEnabled() ? 'true' : 'false');
    enabled.textContent = memoryEnabled() ? '已开启' : '已暂停';
  }

  const cognitionRanges = {};
  const cognitionValues = {};
  const cognitionFields = Object.entries({
    warmth: { label: '温暖表达', low: '克制', high: '温暖' },
    caution: { label: '谨慎程度', low: '灵活', high: '谨慎' },
    curiosity: { label: '好奇倾向', low: '聚焦', high: '好奇' },
    energy: { label: '表达活跃度', low: '平和', high: '活跃' },
  }).map(([key, config]) => {
    const value = Math.round(cognition[key] * 100);
    const range = el('input', {
      class: 'cognition-range', type: 'range', min: 0, max: 100, step: 1, value,
      'aria-label': config.label,
    });
    cognitionRanges[key] = range;
    cognitionValues[key] = el('b', { text: `${value}%` });
    range.addEventListener('input', () => {
      cognition = setCognitionState({ ...cognition, [key]: Number(range.value) / 100 });
      cognitionValues[key].textContent = `${range.value}%`;
      range.style.setProperty('--range-progress', `${range.value}%`);
    });
    range.style.setProperty('--range-progress', `${value}%`);
    return el('label', { class: 'cognition-control' }, [
      el('span', { class: 'cognition-control-head' }, [el('span', { text: config.label }), cognitionValues[key]]),
      range,
      el('span', { class: 'cognition-control-ends' }, [el('span', { text: config.low }), el('span', { text: config.high })]),
    ]);
  });

  const languageStyleSelect = el('select', { class: 'input settings-style-select', 'aria-label': '回复语言风格' }, LANGUAGE_STYLES.map((style) =>
    el('option', { value: style.id, text: style.label })
  ));
  const languageStyleDescription = el('p', { class: 'settings-style-description' });
  const customStyleField = el('textarea', { class: 'input settings-style-custom', rows: 3, maxlength: 500, placeholder: '例如：像一位耐心的技术搭档，先给结论，再分步骤说明。' });
  const customStyleWrap = el('div', { class: 'settings-style-custom-wrap' }, [
    el('label', { class: 'settings-style-label', text: '自定义表达方式' }),
    customStyleField,
    el('p', { class: 'settings-style-hint', text: '最多 500 字，只调整表达方式；本轮明确要求仍优先。' }),
  ]);
  const personalityField = el('textarea', {
    class: 'input settings-personality-input', rows: 4, maxlength: 2000,
    placeholder: '例如：你是温和而有主见的学习搭档，擅长把复杂问题拆成小步骤。',
    value: store.settings.personalityPrompt || '',
  });
  const personalityCount = el('span', { class: 'settings-personality-count', text: `${(store.settings.personalityPrompt || '').length}/2000` });
  function renderLanguageStyle() {
    const selected = LANGUAGE_STYLES.find((style) => style.id === store.settings.languageStyle) || LANGUAGE_STYLES[0];
    languageStyleSelect.value = selected.id;
    languageStyleDescription.textContent = selected.description;
    customStyleWrap.hidden = selected.id !== 'custom';
    customStyleField.value = store.settings.languageStyleCustom || '';
  }
  languageStyleSelect.addEventListener('change', () => {
    store.updateSettings({ languageStyle: languageStyleSelect.value });
    renderLanguageStyle();
    toast('语言风格已更新', 'success', 1400);
  });
  customStyleField.addEventListener('input', () => store.updateSettings({ languageStyleCustom: customStyleField.value.slice(0, 500) }));
  personalityField.addEventListener('input', () => {
    const value = personalityField.value.slice(0, 2000);
    if (personalityField.value !== value) personalityField.value = value;
    personalityCount.textContent = `${value.length}/2000`;
    store.updateSettings({ personalityPrompt: value });
  });
  renderLanguageStyle();

  const cognitionCard = el('section', { class: 'card memory-card memory-cognition-card' }, [
    el('div', { class: 'memory-card-heading' }, [el('div', {}, [el('h2', { text: '表达状态与对话体验' }), el('p', { text: '拖动滑块调节久伴的表达倾向；这只是回复风格设置，不代表真实情绪。' })]), el('span', { class: 'memory-orb', text: '✦' })]),
    el('div', { class: 'cognition-grid' }, cognitionFields),
    el('div', { class: 'memory-conversation-settings' }, [
      el('h3', { text: '对话体验' }),
      el('label', { class: 'settings-style-label', text: '回复风格' }),
      languageStyleSelect,
      languageStyleDescription,
      customStyleWrap,
      el('div', { class: 'settings-personality-divider' }),
      el('div', { class: 'settings-personality-heading' }, [el('div', { class: 'settings-style-label', text: '定制人格提示词' }), personalityCount]),
      el('p', { class: 'settings-style-hint', text: '描述身份设定、交流关系、兴趣和相处习惯；最多 2000 字。' }),
      personalityField,
      el('p', { class: 'settings-style-hint', text: '只影响之后的模型回复，不改写已有聊天记录。' }),
    ]),
  ]);

  const storageCard = el('section', { class: 'card memory-card memory-storage-card' }, [
    el('div', { class: 'memory-card-heading' }, [el('div', {}, [el('h2', { text: '双层记忆库' }), el('p', { text: '索引负责快速检索，完整记忆保存在本机。' })])]),
    el('div', { class: 'memory-storage-grid' }, [
      el('div', { class: 'memory-storage-tier' }, [el('span', { text: '小库 · 检索索引' }), indexValue, el('small', { text: '关键词、标签、时间、权重' })]),
      el('div', { class: 'memory-storage-tier is-large' }, [el('span', { text: '大库 · 完整记忆' }), payloadValue, el('small', { text: '完整记录、证据原文、来源和关系' })]),
    ]),
    rebuildButton,
  ]);

  const form = el('form', { class: 'memory-compose', onSubmit: async (event) => {
    event.preventDefault();
    try {
      const row = await addManualMemory(convId, { content: formInput.value, kind: kind.value });
      rows.unshift(row);
      formInput.value = '';
      renderList();
      await renderStorageStats();
      toast('已保存到久伴的本地记忆', 'success', 1600);
    } catch (error) { toast(error.message, 'warning'); }
  } }, [formInput, el('div', { class: 'memory-compose-controls' }, [kind, el('button', { class: 'btn btn-primary', type: 'submit', text: '保存记忆' })])]);

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const importButton = el('button', { class: 'btn btn-ghost', type: 'button', text: '导入 JSON', onClick: () => importInput.click() });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const count = await importMemorySnapshot(await file.text(), convId);
      rows.splice(0, rows.length, ...(await listMemories(convId)));
      renderList();
      await renderStorageStats();
      toast(`已导入 ${count} 条记忆`, 'success');
    } catch (error) { toast(`导入失败：${error.message}`, 'error'); }
  });

  const clearButton = el('button', { class: 'btn btn-danger', type: 'button', text: '清空久伴记忆', onClick: async () => {
    if (!rows.length) return;
    const yes = await confirmDialog({ title: '清空久伴的长期记忆', message: '将删除久伴一对一聊天共用的所有本地记忆，且无法撤销。', confirmText: '清空', danger: true });
    if (!yes) return;
    await clearMemories(convId);
    rows.splice(0);
    renderList();
    await renderStorageStats();
  } });

  const longTermCard = el('section', { class: 'card memory-card memory-long-term-card' }, [
    el('div', { class: 'memory-card-heading' }, [el('div', {}, [el('h2', { text: '长期记忆' }), el('p', { text: '跨一对一聊天共享；按经历、事实、偏好、关系、计划分类，并按当前话题召回。' })]), countBadge]),
    form,
    el('div', { class: 'memory-list-toolbar' }, [search, el('div', { class: 'memory-toolbar-actions' }, [
      importButton,
      el('button', { class: 'btn btn-ghost', type: 'button', text: '导出 JSON', onClick: async () => download('jiuban-memories.json', await exportMemorySnapshot(convId), 'application/json') }),
      clearButton,
    ])]),
    memories,
  ]);

  enabled.addEventListener('click', () => {
    setMemoryEnabled(!memoryEnabled());
    renderEnabled();
    toast(memoryEnabled() ? '记忆与表达状态已开启' : '记忆与表达状态已暂停', 'info', 1400);
  });
  search.addEventListener('input', renderList);

  container.replaceChildren(
    el('div', { class: 'page memory-page' }, [
      el('header', { class: 'page-header memory-page-header' }, [
        el('div', {}, [el('h1', { class: 'page-title', text: '记忆与认知' }), el('p', { class: 'page-sub', text: '久伴的一对一聊天共用这份长期记忆，数据保存在本机浏览器。' })]), enabled,
      ]),
      el('div', { class: 'memory-primary-grid' }, [memoryCloud.element, storageCard]),
      el('div', { class: 'memory-secondary-grid' }, [cognitionCard, longTermCard]),
    ]),
    importInput,
  );
  renderEnabled();
  renderList();
  await renderStorageStats();
  return () => { importInput.remove(); memoryCloud.dispose(); };
}
