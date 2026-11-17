import { addManualMemory, COMPANION_MEMORY_SCOPE } from './memory.js?v=1.17.0';
import { el, toast, confirmDialog, download } from './util.js';
import { detectColumnMapping, parseChatExport, remapChatRecords } from './chat-import.js';
import { createAnnualReportPanel } from './annual-report-view.js?v=1.17.0';
import { createChatDatabaseExtractor } from './chat-database-view.js?v=1.17.0';

const PAGE_SIZE = 40;
const MAX_SELECTION = 20;
const FIELD_LABELS = { time: '时间列', sender: '发送者列', content: '消息内容列', chat: '会话列' };

function displayTime(timestamp, fallback = '时间未记录') {
  if (!timestamp) return fallback;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : fallback;
}

function makeMappingSelect(label, key, headers, value, onChange, optional = false) {
  const select = el('select', { class: 'input chat-import-map-select', 'aria-label': label }, [
    el('option', { value: '', text: optional ? '不使用' : '请选择' }),
    ...headers.map((header) => el('option', { value: header, text: header })),
  ]);
  select.value = value || '';
  select.addEventListener('change', () => onChange(key, select.value));
  return el('label', { class: 'chat-import-map-field' }, [el('span', { text: label }), select]);
}

export async function mountChatImportView(container) {
  let fileName = '';
  let format = '';
  let rawRecords = [];
  let headers = [];
  let mapping = {};
  let messages = [];
  let selected = new Set();
  let editedTexts = new Map();
  let currentPage = 0;
  let sourceRevision = 0;
  const annualReport = createAnnualReportPanel();
  const annualDisclosure = el('details', { class: 'annual-report-disclosure', hidden: true }, [
    el('summary', {}, [el('strong', { text: '年度回顾' }), el('span', { text: '把这些对话整理成一份年度报告' })]),
    annualReport.element,
  ]);

  const fileInput = el('input', { class: 'chat-import-file-input', type: 'file', accept: '.csv,.json,.txt,.md,.log,text/csv,application/json,text/plain', hidden: true });
  const chooseButton = el('button', { class: 'btn btn-primary', type: 'button', text: '选择聊天记录文件', onClick: () => fileInput.click() });
  const fileLabel = el('span', { class: 'chat-import-file-label', text: '尚未选择文件' });
  const status = el('p', { class: 'chat-import-status', text: '选择 WeChatMsg 导出的 CSV、JSON 或 TXT。文件在当前浏览器本地读取，不会自动上传。' });
  const databaseExtractor = createChatDatabaseExtractor((result) => {
    fileName = result.sourceName;
    format = 'wechat-db';
    rawRecords = [];
    headers = [];
    mapping = {};
    fileLabel.textContent = result.sourceName;
    status.textContent = `数据库已提取 ${result.messages.length.toLocaleString()} 条文本，保留原始数据库和消息表来源。`;
    search.value = '';
    setMessages(result.messages);
    renderMapping();
  }, { onStart: () => {
    sourceRevision += 1;
    rawRecords = [];
    headers = [];
    mapping = {};
    setMessages([]);
    renderMapping();
    fileLabel.textContent = '正在提取数据库…';
    status.textContent = '正在提取你选择的数据库，完成后可在下方预览。';
  } });
  const mappingFields = el('div', { class: 'chat-import-mapping-fields' });
  const mapCard = el('section', { class: 'card chat-import-card chat-import-map-card', hidden: true }, [
    el('div', { class: 'chat-import-card-heading' }, [el('div', {}, [el('h2', { text: '确认字段对应关系' }), el('p', { text: '自动识别不准确时，可以手动指定时间、发送者和消息内容所在列。' })])]),
    mappingFields,
  ]);
  const metrics = el('div', { class: 'chat-import-metrics' });
  const search = el('input', { class: 'input chat-import-search', type: 'search', placeholder: '搜索发送者或消息内容…', 'aria-label': '搜索导入的聊天记录' });
  const senderFilter = el('select', { class: 'input chat-import-sender-filter', 'aria-label': '按发送者筛选' }, [el('option', { value: '', text: '全部发送者' })]);
  const messageList = el('div', { class: 'chat-import-message-list' });
  const pageLabel = el('span', { class: 'chat-import-page-label', text: '' });
  const previousButton = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '上一页' });
  const nextButton = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '下一页' });
  const selectVisibleButton = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '选择本页' });
  const clearSelectionButton = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '清空选择' });
  const selectedLabel = el('span', { class: 'chat-import-selected-count', text: '已选择 0 / 20 条' });
  const saveButton = el('button', { class: 'btn btn-primary', type: 'button', text: '保存为记忆证据' });
  const exportButton = el('button', { class: 'btn btn-soft', type: 'button', text: '导出标准 JSON' });
  const resultCard = el('section', { class: 'card chat-import-card chat-import-results', hidden: true }, [
    el('div', { class: 'chat-import-card-heading chat-import-results-heading' }, [
      el('div', {}, [el('h2', { text: '筛选聊天记录' }), el('p', { text: '选中的消息会逐条保存为带来源的经历证据。长消息可在下方预览，但需要先缩短后再保存。' })]),
      metrics,
    ]),
    el('div', { class: 'chat-import-toolbar' }, [search, senderFilter]),
    el('div', { class: 'chat-import-bulk-actions' }, [selectVisibleButton, clearSelectionButton, selectedLabel]),
    messageList,
    el('div', { class: 'chat-import-pagination' }, [previousButton, pageLabel, nextButton]),
    el('div', { class: 'chat-import-footer' }, [el('p', { class: 'chat-import-status', text: '只保存你选中的消息；每条都会保留原始来源标识。' }), el('div', { class: 'chat-import-actions' }, [exportButton, saveButton])]),
  ]);

  function updateSelectedLabel() {
    const needsEdit = messages.filter((item) => selected.has(item.id) && memoryContentFor(item).length > 600).length;
    selectedLabel.textContent = `已选择 ${selected.size} / ${MAX_SELECTION} 条${needsEdit ? ` · ${needsEdit} 条需缩写` : ''}`;
    saveButton.disabled = selected.size === 0 || needsEdit > 0;
    exportButton.disabled = selected.size === 0;
  }

  function memoryContentFor(message) {
    const text = editedTexts.has(message.id) ? editedTexts.get(message.id) : message.text;
    return `聊天记录中，${message.sender}提到：${text}`;
  }

  function filteredMessages() {
    const query = search.value.trim().toLocaleLowerCase();
    const sender = senderFilter.value;
    return messages.filter((message) => {
      if (sender && message.sender !== sender) return false;
      if (!query) return true;
      return `${message.sender} ${message.chat} ${message.text}`.toLocaleLowerCase().includes(query);
    });
  }

  function renderMessages() {
    const filtered = filteredMessages();
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount - 1);
    const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
    messageList.replaceChildren();
    if (!pageRows.length) {
      messageList.append(el('div', { class: 'chat-import-empty', text: messages.length ? '没有符合筛选条件的记录。' : '当前文件没有可显示的文本消息。' }));
    } else {
      for (const message of pageRows) {
        const isSelected = selected.has(message.id);
        const needsEdit = memoryContentFor(message).length > 600;
        const checkbox = el('input', { type: 'checkbox', checked: isSelected, disabled: !isSelected && selected.size >= MAX_SELECTION, 'aria-label': `选择来自 ${message.sender} 的消息` });
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(message.id);
          else selected.delete(message.id);
          updateSelectedLabel();
          renderMessages();
        });
        const messageChildren = [
          el('div', { class: 'chat-import-message-select' }, [checkbox]),
          el('div', { class: 'chat-import-message-main' }, [
            el('div', { class: 'chat-import-message-meta' }, [
              el('strong', { text: message.sender }),
              message.chat ? el('span', { text: message.chat }) : null,
              el('time', { text: displayTime(message.timestamp, message.timestampText || '时间未记录') }),
            ]),
            el('p', { class: 'chat-import-message-text', text: message.text }),
            isSelected && needsEdit ? el('label', { class: 'chat-import-edit-field' }, [
              el('span', { text: '编辑要保存的摘要' }),
              el('textarea', {
                class: 'input chat-import-edit-text', rows: 3, maxlength: 560,
                placeholder: '把这条长消息缩写成不超过 600 字的证据摘要。来源引用保留原文前 2000 字；完整原文可导出标准 JSON。',
                value: editedTexts.get(message.id) || '',
                onInput: (event) => {
                  editedTexts.set(message.id, event.target.value);
                  const warning = event.target.closest('.chat-import-message-main')?.querySelector('.chat-import-message-warning');
                  const stillTooLong = memoryContentFor(message).length > 600;
                  if (warning) warning.textContent = stillTooLong ? '摘要仍超过记忆条目长度上限，请继续缩短。' : '摘要长度合适，可以保存。';
                  updateSelectedLabel();
                },
              }),
            ]) : null,
            isSelected && needsEdit ? el('small', { class: 'chat-import-message-warning', text: '请先把摘要缩短到记忆条目长度上限以内。' }) : null,
          ]),
        ];
        messageList.append(el('article', { class: `chat-import-message${isSelected ? ' is-selected' : ''}` }, messageChildren));
      }
    }
    pageLabel.textContent = `${filtered.length.toLocaleString()} 条 · 第 ${currentPage + 1} / ${pageCount} 页`;
    previousButton.disabled = currentPage <= 0;
    nextButton.disabled = currentPage >= pageCount - 1;
    updateSelectedLabel();
  }

  function setMessages(nextMessages) {
    messages = nextMessages;
    annualDisclosure.hidden = !messages.length;
    annualReport.setMessages(messages, fileName);
    selected.clear();
    editedTexts.clear();
    currentPage = 0;
    const senders = [...new Set(messages.map((item) => item.sender).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    senderFilter.replaceChildren(el('option', { value: '', text: '全部发送者' }), ...senders.map((sender) => el('option', { value: sender, text: sender })));
    const dates = messages.map((item) => item.timestamp).filter(Boolean).sort((a, b) => a - b);
    const range = dates.length ? `${displayTime(dates[0])} — ${displayTime(dates.at(-1))}` : '时间信息未识别';
    metrics.replaceChildren(
      el('span', { class: 'chat-import-metric', text: `${messages.length.toLocaleString()} 条消息` }),
      el('span', { class: 'chat-import-metric', text: `${senders.length} 位发送者` }),
      el('span', { class: 'chat-import-metric is-range', text: range }),
    );
    resultCard.hidden = !messages.length;
    renderMessages();
  }

  function renderMapping() {
    mappingFields.replaceChildren();
    if (!headers.length || !rawRecords.length) { mapCard.hidden = true; return; }
    mapCard.hidden = false;
    const change = (key, value) => {
      mapping = { ...mapping, [key]: value };
      const nextMessages = remapChatRecords(rawRecords, fileName, mapping);
      setMessages(nextMessages);
      if (nextMessages.length) {
        status.textContent = `已按字段映射识别 ${nextMessages.length.toLocaleString()} 条消息。`;
      } else if (key === 'content') {
        status.textContent = '请选择包含消息正文的列。';
      }
    };
    mappingFields.append(
      makeMappingSelect(FIELD_LABELS.time, 'time', headers, mapping.time, change, true),
      makeMappingSelect(FIELD_LABELS.sender, 'sender', headers, mapping.sender, change, true),
      makeMappingSelect(FIELD_LABELS.content, 'content', headers, mapping.content, change),
      makeMappingSelect(FIELD_LABELS.chat, 'chat', headers, mapping.chat, change, true),
    );
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      toast('文件超过 30 MB。请先按会话或时间范围拆分导出。', 'warning');
      return;
    }
    databaseExtractor.cancel('已切换到导出文件导入。');
    const revision = ++sourceRevision;
    fileName = file.name;
    annualReport.setMessages([], fileName);
    fileLabel.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
    status.textContent = '正在本地解析文件…';
    search.value = '';
    senderFilter.value = '';
    try {
      const text = await file.text();
      if (revision !== sourceRevision) return;
      const parsed = parseChatExport(file.name, text);
      format = parsed.format;
      rawRecords = parsed.records || [];
      headers = parsed.headers || [];
      mapping = parsed.mapping || detectColumnMapping(headers);
      renderMapping();
      if (parsed.messages.length) {
        status.textContent = `读取完成：${parsed.messages.length.toLocaleString()} 条消息。请筛选并选择要留存的内容。`;
        setMessages(parsed.messages);
      } else {
        resultCard.hidden = true;
        status.textContent = '文件已读取，但未识别出消息正文。请检查字段映射，或改用 TXT/CSV 导出。';
      }
    } catch (error) {
      if (revision !== sourceRevision) return;
      messages = [];
      annualReport.setMessages([], fileName);
      selected.clear();
      resultCard.hidden = true;
      mapCard.hidden = true;
      status.textContent = error.message;
      toast(`读取失败：${error.message}`, 'error');
    }
  });

  search.addEventListener('input', () => { currentPage = 0; renderMessages(); });
  senderFilter.addEventListener('change', () => { currentPage = 0; renderMessages(); });
  previousButton.addEventListener('click', () => { currentPage -= 1; renderMessages(); });
  nextButton.addEventListener('click', () => { currentPage += 1; renderMessages(); });
  selectVisibleButton.addEventListener('click', () => {
    for (const message of filteredMessages().slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)) {
      if (selected.size >= MAX_SELECTION) break;
      selected.add(message.id);
    }
    renderMessages();
  });
  clearSelectionButton.addEventListener('click', () => { selected.clear(); renderMessages(); });

  exportButton.addEventListener('click', () => {
    const payload = messages.filter((item) => selected.has(item.id)).map((item) => ({
      source_type: format === 'wechat-db' ? 'wechat_database' : 'wechat_import', source_id: item.sourceId, source_file: item.sourceFile || fileName,
      source_table: item.sourceTable || null,
      event_time: item.timestamp ? new Date(item.timestamp).toISOString() : null,
      sender: item.sender, chat: item.chat || null, text: item.text,
    }));
    download(`${fileName.replace(/\.[^.]+$/, '')}-memora.json`, JSON.stringify({ format, source_file: fileName, exported_at: new Date().toISOString(), messages: payload }, null, 2));
    toast(`已导出 ${payload.length} 条标准化记录。`, 'success');
  });

  saveButton.addEventListener('click', async () => {
    if (!selected.size) return;
    const picked = messages.filter((item) => selected.has(item.id));
    const yes = await confirmDialog({
      title: `保存 ${picked.length} 条聊天证据？`,
      message: '所选文本会保存到本机长期记忆，并保留发送者、时间和来源文件。请选择你有权导入的内容；保存后仍可在记忆页查看或删除。之后若用云端模型回答相关问题，命中的记忆可能作为上下文发送到你配置的模型服务。',
      confirmText: '保存到本机',
    });
    if (!yes) return;
    let saved = 0;
    let skipped = 0;
    for (const item of picked) {
      const content = memoryContentFor(item);
      if (content.length > 600) { skipped += 1; continue; }
      try {
        await addManualMemory(COMPANION_MEMORY_SCOPE, {
          content,
          kind: 'episode',
          mapKey: `wechat:${item.sourceId}`,
          tags: [format === 'wechat-db' ? '数据库提取' : '微信导入', item.sender].filter(Boolean),
          importance: 0.42,
          confidence: 0.9,
          basis: 'explicit',
          eventTime: item.timestamp,
          eventTimeUnknown: !item.timestamp,
          source: `${format === 'wechat-db' ? '微信数据库' : 'WeChatMsg'} · ${item.sourceFile || fileName}`,
          sourceIds: [item.sourceId],
          evidenceQuote: item.text,
          triggerType: 'manual_entry',
        });
        saved += 1;
      } catch {
        skipped += 1;
      }
    }
    if (skipped) toast(`已保存 ${saved} 条，${skipped} 条因长度或格式问题跳过。`, 'warning', 3200);
    else toast(`已保存 ${saved} 条聊天证据到本机记忆。`, 'success', 2400);
  });

  const fileCard = el('section', { class: 'card chat-import-card chat-import-start' }, [
    el('div', { class: 'chat-import-card-heading' }, [el('div', {}, [el('h2', { text: '选择聊天导出文件' }), el('p', { text: '支持 CSV、JSON、TXT 和 AI-TXT，文件只在当前浏览器中读取。' })])]),
    el('div', { class: 'chat-import-file-row' }, [chooseButton, fileLabel]),
    el('details', { class: 'import-help-disclosure' }, [
      el('summary', { text: '如何准备聊天记录？' }),
      el('div', { class: 'chat-import-info' }, [
        el('span', { text: '先从 WeChatMsg 等工具导出会话，再选择文件。' }),
        el('span', { text: '预览后勾选需要保留的片段，未勾选的内容不会写入记忆。' }),
      ]),
    ]), status,
  ]);
  const filePanel = el('div', { class: 'import-source-panel', id: 'import-source-file' }, [fileCard]);
  const dbPanel = el('div', { class: 'import-source-panel', id: 'import-source-database', hidden: true }, [databaseExtractor.element]);
  const sourceButtons = ['file', 'database'].map((mode) => el('button', {
    class: `import-source-button${mode === 'file' ? ' is-active' : ''}`, type: 'button',
    dataset: { source: mode }, 'aria-pressed': String(mode === 'file'), 'aria-controls': `import-source-${mode}`,
    text: mode === 'file' ? '导出文件' : '微信数据库',
    onClick: () => {
      sourceRevision += 1;
      if (mode === 'file') databaseExtractor.cancel();
      filePanel.hidden = mode !== 'file';
      dbPanel.hidden = mode !== 'database';
      sourceButtons.forEach(button => {
        const active = button.dataset.source === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    },
  }));
  container.replaceChildren(el('div', { class: 'page chat-import-page' }, [
    el('header', { class: 'page-header chat-import-header' }, [
      el('div', {}, [el('h1', { class: 'page-title', text: '导入聊天记录' }), el('p', { class: 'page-sub', text: '把选定的对话片段转成有来源、可回放的记忆证据。' })]),
      el('span', { class: 'chat-import-local-badge', text: '本地解析' }),
    ]),
    el('div', { class: 'chat-import-body' }, [
      el('div', { class: 'import-source-heading' }, [el('h2', { text: '从哪里导入？' }), el('div', { class: 'import-source-control', role: 'group', 'aria-label': '聊天记录来源' }, sourceButtons)]),
      filePanel, dbPanel,
      mapCard,
      resultCard,
      annualDisclosure,
    ]),
    fileInput,
  ]));

  return () => { fileInput.remove(); annualReport.dispose(); databaseExtractor.dispose(); };
}
