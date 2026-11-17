import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnnualReport, getReportOptions } from '../../../assets/js/annual-report.js';

process.env.TZ = 'Asia/Shanghai';
const message = (time, sender, text) => ({ timestamp: time == null ? null : Date.parse(time), sender, text });

test('uses local year boundaries, leap days, actual active days, and distinct senders', () => {
  const rows = [
    message('2023-12-31T16:00:00Z', '我', '设计项目'),
    message('2024-02-29T10:00:00+08:00', '朋友', '学习设计'),
    message('2024-02-29T22:00:00+08:00', '我', '学习项目'),
    message('2024-12-31T16:00:00Z', '朋友', '新年快乐'),
    message(null, '朋友', '无日期'),
  ];
  const result = buildAnnualReport(rows, { year: 2024, selfSender: '我' });
  assert.equal(result.totalMessages, 3);
  assert.equal(result.activeDays, 2);
  assert.equal(result.participantCount, 2);
  assert.equal(result.selfMessages, 2);
  assert.equal(result.otherMessages, 1);
  assert.equal(result.undatedCount, 1);
  assert.equal(result.monthly[0], 1);
  assert.equal(result.monthly[1], 2);
  assert.equal(result.hourly[0], 1);
  assert.equal(result.firstDate, '2024-01-01');
  assert.equal(result.lastDate, '2024-02-29');
  assert.deepEqual(getReportOptions(rows).years, [2025, 2024]);
});

test('does not infer an identity, count unknown senders as contacts, or include missing dates', () => {
  const rows = [message('2024-05-01T10:00:00+08:00', '未识别发送者', '你好 🙂'), message(null, '我', '没有日期')];
  const result = buildAnnualReport(rows, { year: 2024 });
  assert.equal(result.totalMessages, 1);
  assert.equal(result.participantCount, 0);
  assert.equal(result.unknownSenderMessages, 1);
  assert.equal(result.selfMessages, null);
  assert.equal(result.otherMessages, null);
  assert.equal(result.totalCharacters, 3);
  assert.equal(result.undatedCount, 1);
});

test('counts word occurrences without example data, URLs, or email addresses', () => {
  const result = buildAnnualReport([message('2024-05-01T10:00:00+08:00', '我', 'design design the https://example.com/secret user@example.com')], { year: 2024 });
  assert.deepEqual(result.words, [['design', 2]]);
  assert.equal(result.hourly.reduce((sum, value) => sum + value, 0), 1);
  assert.equal(result.senders[0].count, 1);
});

test('keeps the Unix epoch as a valid date and rejects a year with no records', () => {
  assert.deepEqual(getReportOptions([{ timestamp: 0, sender: '我', text: '时间' }]).years, [1970]);
  assert.throws(() => buildAnnualReport([], { year: 2024 }), /没有可统计/);
  assert.throws(() => buildAnnualReport([], { year: 'none' }), /请选择报告年份/);
});
