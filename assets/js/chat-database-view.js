import { el, toast, formatBytes } from './util.js';

export function createChatDatabaseExtractor(onExtracted, { onStart = () => {} } = {}) {
  let files = [];
  let worker = null;
  let disposed = false;
  const input = el('input', { type: 'file', accept: '.db,.sqlite,.sqlite3,.db-wal', multiple: true, hidden: true, class: 'chat-db-file-input' });
  const fileLabel = el('span', { class: 'chat-import-file-label', text: '尚未选择数据库' });
  const key = el('input', { class: 'input chat-db-key', type: 'password', maxlength: 100, autocomplete: 'off', spellcheck: 'false', placeholder: '已解密数据库可留空；加密库填已有密钥', 'aria-label': '数据库解密密钥' });
  const selfName = el('input', { class: 'input chat-db-self-name', maxlength: 32, value: '我', 'aria-label': '我的显示名称' });
  const status = el('p', { class: 'chat-import-status', role: 'status', text: '选择同一账号的数据库副本，可同时选择多个消息分片和联系人库。' });
  const reportList = el('div', { class: 'chat-db-reports' });
  const pickButton = el('button', { class: 'btn btn-soft', type: 'button', text: '选择数据库文件', onClick: () => input.click() });
  const startButton = el('button', { class: 'btn btn-primary chat-db-start', type: 'button', text: '提取聊天记录', disabled: true, onClick: start });
  const cancelButton = el('button', { class: 'btn btn-ghost chat-db-cancel', type: 'button', text: '取消提取', hidden: true, onClick: () => cancel() });
  const element = el('section', { class: 'card chat-import-card chat-db-card' }, [
    el('div', { class: 'chat-import-card-heading' }, [
      el('div', {}, [el('h2', { text: '从微信数据库提取' }), el('p', { text: '在 Windows 或 Mac 上读取你选择的数据库副本，提取文本聊天，再预览、导出或保存为记忆。' })]),
      el('span', { class: 'chat-import-local-badge', text: '本机处理' }),
    ]),
    el('div', { class: 'chat-import-file-row' }, [pickButton, fileLabel]),
    el('div', { class: 'chat-db-fields' }, [
      el('label', { class: 'chat-db-field' }, [el('span', { text: '数据库密钥（仅加密库需要）' }), key]),
      el('label', { class: 'chat-db-field' }, [el('span', { text: '我的显示名称' }), selfName]),
    ]),
    el('details', { class: 'chat-db-help' }, [
      el('summary', { text: '如何准备 Windows / Mac 数据库' }),
      el('p', { text: 'Windows：选择退出微信后复制的 MSG*.db；可同时选择 MicroMsg.db 读取联系人备注。MemoTrace 已解密的 MSG.db 也可直接读取。' }),
      el('p', { text: 'Mac：选择账号备份中的 msg_*.db 或 message_*.db，可附带联系人数据库。支持可识别的 Chat_、Msg_ 消息表；格式不兼容时会显示原因。' }),
      el('p', { text: '网页不读取微信进程或自动获取密钥。加密库须输入已有密钥；请勿选择仍有未合并 -wal 文件的运行中数据库。本次只提取文本，图片、语音等会计入跳过项。' }),
    ]),
    el('div', { class: 'chat-db-actions' }, [startButton, cancelButton]),
    status, reportList, input,
  ]);

  function busy(value) {
    pickButton.disabled = value;
    key.disabled = value;
    selfName.disabled = value;
    startButton.disabled = value || !files.length;
    startButton.textContent = value ? '正在提取…' : '提取聊天记录';
    cancelButton.hidden = !value;
  }

  function cancel(message = '已取消提取。') {
    if (!worker) return;
    worker.terminate();
    worker = null;
    key.value = '';
    busy(false);
    status.textContent = message;
  }

  input.addEventListener('change', () => {
    cancel();
    const selected = [...input.files];
    input.value = '';
    files = [];
    reportList.replaceChildren();
    if (selected.some((file) => /-(wal|shm)$/i.test(file.name))) {
      status.textContent = '检测到未合并的 WAL 文件。请退出微信后重新复制完整数据库或使用已完成的备份。';
    } else if (selected.some((file) => !/\.(db|sqlite|sqlite3)$/i.test(file.name))) {
      status.textContent = '请选择 .db、.sqlite 或 .sqlite3 数据库文件。';
    } else if (selected.some((file) => file.size > 256 * 1024 * 1024) || selected.reduce((sum, file) => sum + file.size, 0) > 512 * 1024 * 1024) {
      status.textContent = '单个数据库最多 256 MB，每批最多 512 MB。请按消息分片分批提取。';
    } else if (selected.length > 40) {
      status.textContent = '每批最多选择 40 个数据库，请分批提取。';
    } else {
      files = selected;
      status.textContent = '文件已就绪。密钥只用于本次本机解密，不会写入设置或自动上传。';
    }
    fileLabel.textContent = files.length ? `${files.length} 个文件 · ${formatBytes(files.reduce((sum, file) => sum + file.size, 0))} · ${files.map((file) => file.name).join('、')}` : '尚未选择可读取的数据库';
    busy(false);
  });

  function start() {
    if (!files.length || worker) return;
    reportList.replaceChildren();
    busy(true);
    status.textContent = '正在载入本机数据库提取模块…';
    try {
      onStart();
      const current = worker = new Worker(new URL('./chat-database-worker.js', import.meta.url));
      current.onmessage = ({ data }) => {
        if (disposed || worker !== current) return;
        if (data.progress) { status.textContent = data.progress; return; }
        if (data.error) { finish(data.error); return; }
        if (!data.result) return;
        const result = data.result;
        reportList.replaceChildren(...result.reports.map((report) => el('div', { class: `chat-db-report${report.error ? ' is-error' : ''}` }, [
          el('strong', { text: report.file }),
          el('p', { text: report.error || `${report.text} 条文本 · 跳过 ${report.nonText} 条非文字、${report.unreadable} 条无法解码的内容${report.truncated ? '；已达到本批 20 万条上限，部分消息尚未读取' : ''}` }),
          report.messageTables === 0 && !report.error ? el('p', { text: '未发现支持的消息表；如为联系人库，已用于识别备注。' }) : null,
          ...(report.warnings || []).map((text) => el('p', { text })),
        ])));
        if (result.messages.length) {
          onExtracted(result);
          const incomplete = result.failures || result.reports.some((report) => report.truncated || report.unreadable);
          finish(`已提取 ${result.messages.length.toLocaleString()} 条文本消息${incomplete ? '；部分内容未读取，请查看下方明细' : '，可在下方筛选或生成年报'}。`);
          toast(`已提取 ${result.messages.length.toLocaleString()} 条聊天记录`, incomplete ? 'warning' : 'success');
        } else finish('未提取到可读取的文本消息，请检查文件、密钥及下方明细。');
      };
      current.onerror = () => { if (worker === current) finish('提取模块无法运行，请使用本机 localhost 或 HTTPS 地址打开后重试。'); };
      current.postMessage({ files, key: key.value.trim(), selfName: selfName.value.trim() || '我', profileId: 'auto' });
      key.value = '';
    } catch { finish('当前环境无法载入数据库提取模块，请刷新页面重试。'); }
  }

  function finish(message) {
    worker?.terminate();
    worker = null;
    key.value = '';
    busy(false);
    status.textContent = message;
  }

  return { element, cancel, dispose() { disposed = true; cancel(); files = []; key.value = ''; } };
}
