import { reactive } from 'vue';

export const reportData = reactive({});
export const Welcome_data = reactive({ avatarSrc: './avatar.svg', nickname: '', descriptionText: {} });
export const statsData = reactive({ stages: [] });
export let xAxisData = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
export let yAxisData = [];
export const generateData = () => yAxisData;
export const seasonColors = ['#b6faff'];
export let chartTitle = '';
export const chatdescription = reactive({ sumUp: '', left: {}, right: [] });
export const keywordsData = reactive({ keyword: '', keyword_num: 0, word_counter: [] });
export const chatFriendsData = reactive({ chatFriends: [] });
export const wechatReportData = reactive({});

export function applyReport(data) {
  Object.assign(reportData, data);
  const nickname = data.selfSender || '我们的对话';
  Welcome_data.nickname = nickname;
  Welcome_data.descriptionText = {
    hello: `${data.year} 年度聊天报告`,
    text1: `从 ${data.firstDate} 到 ${data.lastDate}，这份文件里留下了 ${data.totalMessages.toLocaleString()} 条消息。`,
    text2: `${data.activeDays} 个有聊天记录的日子，${data.participantCount} 位可识别的发送者。`,
    text4: '从聊天时段、高频词到熟悉的名字，一起回看这些片段。',
    text7: '仅统计当前导入文件中的文本记录。',
  };
  statsData.stages = [
    { title: '有聊天记录的日子', content: String(data.activeDays), unit: '天' },
    { title: '可识别的发送者', content: String(data.participantCount), unit: '位' },
    { title: '这份文件里的消息', content: data.totalMessages.toLocaleString(), unit: '条' },
    ...(data.selfSender ? [{ title: `${data.selfSender} 发送`, content: data.selfMessages.toLocaleString(), unit: '条' }] : []),
    { title: '文本字符（不含空白）', content: data.totalCharacters.toLocaleString(), unit: '字' },
  ];
  yAxisData = [...data.hourly];
  chartTitle = `${data.year} 聊天时段分布 · ${data.timezone}`;
  const time = `${String(data.peakHour).padStart(2, '0')}:00 — ${String((data.peakHour + 1) % 24).padStart(2, '0')}:00`;
  Object.assign(chatdescription, {
    sumUp: '对话最密集的时刻',
    left: { prefix: '', timePeriod: time, suffix: `这个时段共有 ${data.hourly[data.peakHour]} 条消息` },
    right: ['每条消息，都有一个属于它的时刻。', '以上时间按本机时区统计。'],
  });
  Object.assign(keywordsData, { keyword: data.words[0]?.[0] || '暂无可统计词', keyword_num: data.words[0]?.[1] || 0, word_counter: data.words });
  chatFriendsData.chatFriends = data.senders.slice(0, 5).map((row) => ({ name: row.name, messageCount: `${row.count.toLocaleString()} 条消息`, wordCount: `${row.characters.toLocaleString()} 个字符`, avatarSrc: './avatar.svg' }));
  Object.assign(wechatReportData, {
    avatarSrc: './avatar.svg', nickname, reportName: `${data.year} 年度聊天报告`,
    friends: data.senders.slice(0, 5).map((row) => ({ name: row.name, avatarSrc: './avatar.svg' })),
    summaryText: `${data.activeDays} 个日子，留下 ${data.totalMessages.toLocaleString()} 条对话`,
    leftTags: [
      { label: '消息总数', value: data.totalMessages, unit: '条' },
      { label: '活跃日数', value: data.activeDays, unit: '天' },
      { label: '参与发送者', value: data.participantCount, unit: '位' },
      { label: '文本字符数', value: data.totalCharacters, unit: '字' },
    ],
    rightTags: [ { label: '高频词', value: data.words[0]?.[0] || '暂无' }, { label: '活跃时段', value: time }, { label: '来源文件', value: data.sourceFile } ],
    bottomText: '数据仅来自所选年份的已导入记录 · 模板：LC044/AnnualReport（MIT）',
  });
}
