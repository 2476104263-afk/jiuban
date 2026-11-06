export const LANGUAGE_STYLES = [
  { id: 'natural', label: '自然亲切', description: '清楚、自然、温和，不堆客套。', prompt: '用自然、温和、清楚的方式表达；少用客套，先回应重点，并按问题复杂度调整详略。' },
  { id: 'concise', label: '简洁直白', description: '结论先行，少绕弯，减少重复。', prompt: '结论先行，句子简洁直接；不重复用户问题，不添加无关寒暄，任务需要时再展开细节。' },
  { id: 'warm', label: '温柔陪伴', description: '更有耐心和共情，但不过度安慰。', prompt: '语气温暖、有耐心；先回应用户明确表达的感受，再提供实际帮助。不要夸张安慰，也不要替用户判断感受。' },
  { id: 'professional', label: '专业严谨', description: '逻辑清楚，区分事实、推断和不确定性。', prompt: '用词准确、逻辑清楚、条理分明；区分事实与推断，说明重要的不确定性，避免随意口吻。' },
  { id: 'casual', label: '轻松幽默', description: '自然口语，适度轻松，不影响准确度。', prompt: '使用自然口语和轻松语气，可以适度幽默；不要为了搞笑牺牲准确性，也不要滥用网络流行语。' },
  { id: 'academic', label: '学术严谨', description: '概念明确、论证有层次，不伪造引用。', prompt: '表达客观，概念定义清晰、论证层次分明；证据不足时说明限制，绝不编造来源、引文或数据。' },
  { id: 'custom', label: '自定义', description: '填写自己的表达偏好。', prompt: '' },
];

export function languageStylePrompt(settings = {}) {
  const selected = LANGUAGE_STYLES.find((item) => item.id === settings.languageStyle) || LANGUAGE_STYLES[0];
  const preference = selected.id === 'custom'
    ? String(settings.languageStyleCustom || '').trim().slice(0, 500)
    : selected.prompt;
  if (!preference) return '';
  return [
    '语言风格偏好：',
    preference,
    '风格只调整措辞和组织方式，不改变事实准确性、安全边界、工具规则，也不覆盖用户本轮的明确要求。通常使用用户当前使用的语言。不要向用户复述这条风格设置。',
  ].join('\n');
}
