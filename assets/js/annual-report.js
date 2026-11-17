const UNKNOWN_SENDER = '未识别发送者';
const STOP_WORDS = new Set('我们 你们 他们 她们 这个 那个 这些 那些 一个 一下 一些 一起 已经 还是 就是 不是 真的 现在 然后 因为 所以 但是 可以 可能 什么 怎么 为什么 自己 时候 今天 明天 昨天 这里 那里 没有 不会 不用 知道 觉得 看到 收到 谢谢 好的 图片 表情 视频 语音 链接 分享 消息 撤回 the and that this with have from your you are for not was but'.split(' '));

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getReportOptions(messages) {
  const years = new Set();
  const senders = new Set();
  let undatedCount = 0;
  for (const message of messages) {
    const date = message.timestamp == null ? null : new Date(message.timestamp);
    if (!date || !Number.isFinite(date.getTime())) undatedCount += 1;
    else years.add(date.getFullYear());
    if (message.sender && message.sender !== UNKNOWN_SENDER) senders.add(message.sender);
  }
  return { years: [...years].sort((a, b) => b - a), senders: [...senders].sort((a, b) => a.localeCompare(b, 'zh-CN')), undatedCount };
}

export function buildAnnualReport(messages, { year, selfSender = '', sourceFile = '' } = {}) {
  year = Number(year);
  if (!Number.isInteger(year)) throw new Error('请选择报告年份。');
  const hourly = Array(24).fill(0);
  const monthly = Array(12).fill(0);
  const daily = new Map();
  const senders = new Map();
  const words = new Map();
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'word' }) : null;
  let totalMessages = 0;
  let totalCharacters = 0;
  let selfMessages = 0;
  let unknownSenderMessages = 0;
  let firstTime = Infinity;
  let lastTime = -Infinity;
  let undatedCount = 0;
  for (const message of messages) {
    const date = message.timestamp == null ? null : new Date(message.timestamp);
    if (!date || !Number.isFinite(date.getTime())) { undatedCount += 1; continue; }
    if (date.getFullYear() !== year) continue;
    const text = String(message.text || '');
    const characters = [...text.replace(/\s/g, '')].length;
    totalMessages += 1;
    totalCharacters += characters;
    firstTime = Math.min(firstTime, date.getTime());
    lastTime = Math.max(lastTime, date.getTime());
    hourly[date.getHours()] += 1;
    monthly[date.getMonth()] += 1;
    const key = dateKey(date);
    daily.set(key, (daily.get(key) || 0) + 1);
    if (!message.sender || message.sender === UNKNOWN_SENDER) unknownSenderMessages += 1;
    else {
      const row = senders.get(message.sender) || { name: message.sender, count: 0, characters: 0 };
      row.count += 1;
      row.characters += characters;
      senders.set(message.sender, row);
    }
    if (selfSender && message.sender === selfSender) selfMessages += 1;
    const plain = text.replace(/https?:\/\/\S+|\b\S+@\S+\.\S+/gi, ' ');
    const tokens = segmenter ? segmenter.segment(plain) : [...plain.matchAll(/[\p{L}]{2,20}/gu)].map(([segment]) => ({ segment, isWordLike: true }));
    for (const token of tokens) {
      const word = token.segment.toLocaleLowerCase().trim();
      if (!token.isWordLike || [...word].length < 2 || word.length > 24 || STOP_WORDS.has(word) || !/\p{L}/u.test(word)) continue;
      words.set(word, (words.get(word) || 0) + 1);
    }
  }
  if (!totalMessages) throw new Error('所选年份没有可统计的聊天记录。');
  const rankedWords = [...words].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).slice(0, 80);
  const rankedSenders = [...senders.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  const peakHour = hourly.indexOf(Math.max(...hourly));
  return {
    format: 'jiuban-annual-report', version: 1, year, sourceFile, selfSender,
    totalMessages, totalCharacters, activeDays: daily.size, participantCount: senders.size,
    selfMessages: selfSender ? selfMessages : null,
    otherMessages: selfSender ? totalMessages - selfMessages - unknownSenderMessages : null,
    unknownSenderMessages, undatedCount, firstDate: dateKey(new Date(firstTime)), lastDate: dateKey(new Date(lastTime)),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hourly, monthly, daily: [...daily].sort(([a], [b]) => a.localeCompare(b)),
    peakHour, words: rankedWords, senders: rankedSenders,
    keywordMethod: segmenter ? 'Intl.Segmenter 中文分词，排除常见停用词；按出现次数统计' : '按连续字词分组，排除常见停用词；按出现次数统计',
  };
}
