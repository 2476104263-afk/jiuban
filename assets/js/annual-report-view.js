import { getReportOptions, buildAnnualReport } from './annual-report.js';
import { el, download, toast } from './util.js';

export function createAnnualReportPanel() {
  let messages = [];
  let sourceFile = '';
  let report = null;
  let worker = null;
  let revision = 0;
  let frame = null;
  let loadTimer = null;
  let disposed = false;
  const year = el('select', { class: 'input', 'aria-label': '报告年份', disabled: true });
  const sender = el('select', { class: 'input', 'aria-label': '我的发送者身份', disabled: true }, [el('option', { value: '', text: '不区分我的身份' })]);
  const status = el('p', { class: 'annual-report-status', role: 'status', text: '先选择聊天记录文件，再生成属于这些对话的年度报告。' });
  const coverage = el('p', { class: 'annual-report-coverage' });
  const preview = el('div', { class: 'annual-report-preview', hidden: true });
  const exportButton = el('button', { class: 'btn btn-soft', type: 'button', text: '导出统计 JSON', hidden: true, onClick: () => {
    if (report) download(`${report.year}-年度聊天统计.json`, JSON.stringify(report, null, 2), 'application/json');
  } });
  const generateButton = el('button', { class: 'btn btn-primary', type: 'button', text: '生成年度报告', disabled: true, onClick: generate });
  const element = el('section', { class: 'card chat-import-card annual-report-card' }, [
    el('div', { class: 'chat-import-card-heading' }, [
      el('div', {}, [el('h2', { text: '年度聊天报告' }), el('p', { text: '从导入的文本记录回看消息统计、聊天时段、高频词与活跃发送者，最后保存一张纪念卡片。' })]),
      el('span', { class: 'chat-import-local-badge', text: '本地生成' }),
    ]),
    el('div', { class: 'annual-report-controls' }, [
      el('label', {}, [el('span', { text: '报告年份' }), year]),
      el('label', {}, [el('span', { text: '我的发送者（可选）' }), sender]),
      generateButton,
    ]),
    coverage, status, preview,
    el('div', { class: 'annual-report-footnote' }, [
      el('a', { href: 'https://github.com/LC044/AnnualReport', target: '_blank', rel: 'noopener noreferrer', text: '模板：LC044/AnnualReport · MIT' }),
      exportButton,
    ]),
  ]);

  function invalidate() {
    revision += 1;
    worker?.terminate();
    worker = null;
    clearTimeout(loadTimer);
    report = null;
    frame = null;
    preview.replaceChildren();
    preview.hidden = true;
    exportButton.hidden = true;
    generateButton.textContent = '生成年度报告';
    generateButton.disabled = !year.value;
  }

  async function generate() {
    if (!messages.length || !year.value) return;
    invalidate();
    const current = revision;
    const options = { year: Number(year.value), selfSender: sender.value, sourceFile };
    generateButton.disabled = true;
    generateButton.textContent = '正在统计…';
    status.textContent = '正在本机统计所选年份的聊天记录…';
    try {
      const result = typeof Worker === 'function' ? await new Promise((resolve, reject) => {
        worker = new Worker(new URL('./annual-report-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.report);
        worker.onerror = () => reject(new Error('统计模块加载失败，请刷新页面重试。'));
        worker.postMessage({ messages, options });
      }) : buildAnnualReport(messages, options);
      if (disposed || current !== revision) return;
      report = result;
      worker?.terminate();
      worker = null;
      frame = el('iframe', {
        class: 'annual-report-frame', title: `${result.year} 年度聊天报告`,
        src: new URL('../vendor/annual-report/index.html', import.meta.url).href,
        sandbox: 'allow-scripts allow-same-origin allow-downloads',
      });
      preview.replaceChildren(frame);
      preview.hidden = false;
      exportButton.hidden = false;
      status.textContent = `已统计 ${result.totalMessages.toLocaleString()} 条消息，正在打开报告…`;
      loadTimer = setTimeout(() => {
        if (!disposed && current === revision) status.textContent = '报告页面加载较慢，可重新生成；统计 JSON 已可导出。';
      }, 10000);
    } catch (error) {
      if (disposed || current !== revision) return;
      worker?.terminate();
      worker = null;
      status.textContent = error.message;
      toast(error.message, 'error');
    } finally {
      if (!disposed && current === revision) {
        generateButton.disabled = false;
        generateButton.textContent = '重新生成报告';
      }
    }
  }

  function receive(event) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.type !== 'jiuban-annual-report:ready' || !report) return;
    clearTimeout(loadTimer);
    frame.contentWindow.postMessage({ type: 'jiuban-annual-report:data', report }, location.origin);
    status.textContent = `${report.year} 年报告已生成：${report.totalMessages.toLocaleString()} 条消息、${report.activeDays} 个活跃日。可在报告中切换章节，并在「纪念卡片」保存图片。`;
  }
  window.addEventListener('message', receive);
  [year, sender].forEach((field) => field.addEventListener('change', () => {
    invalidate();
    status.textContent = '已更新统计范围，点击「生成年度报告」查看。';
  }));

  function setMessages(next, fileName = '') {
    messages = next;
    sourceFile = fileName;
    const options = getReportOptions(messages);
    year.replaceChildren(...options.years.map((value) => el('option', { value, text: `${value} 年` })));
    sender.replaceChildren(el('option', { value: '', text: '不区分我的身份' }), ...options.senders.map((value) => el('option', { value, text: value })));
    year.disabled = !options.years.length;
    sender.disabled = !messages.length;
    invalidate();
    coverage.textContent = messages.length ? `统计当前文件，不受下方筛选或勾选影响。按本机时区归年；${options.undatedCount} 条未识别时间的记录不计入年度统计。` : '';
    status.textContent = !messages.length ? '先选择聊天记录文件，再生成属于这些对话的年度报告。' : !options.years.length ? '这份文件没有可识别的日期，暂不能生成年报。请先在字段映射中选择正确的时间列。' : '数据已就绪。选择年份后生成报告；不区分身份时只统计总量。';
  }

  return { element, setMessages, dispose() {
    disposed = true;
    invalidate();
    window.removeEventListener('message', receive);
  } };
}
