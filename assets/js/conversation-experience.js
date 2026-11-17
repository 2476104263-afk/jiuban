import { getCognitionState, setCognitionState } from './memory.js?v=1.17.0';
import { store } from './store.js';
import { LANGUAGE_STYLES } from './language-style.js?v=1.17.0';
import { el, toast } from './util.js';

export function createConversationExperience() {
  let cognition = getCognitionState();
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
    el('div', { class: 'memory-card-heading' }, [el('div', {}, [el('h2', { text: '表达状态与对话体验' }), el('p', { text: '拖动滑块调节Memora的表达倾向；这只是回复风格设置，不代表真实情绪。' })]), el('span', { class: 'memory-orb', text: '✦' })]),
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

  return cognitionCard;
}
