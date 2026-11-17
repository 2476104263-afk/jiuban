const FIELD_ALIASES = {
  time: ['time', 'timestamp', 'create_time', 'created_at', 'send_time', 'msg_time', 'datetime', 'date', 'strtime', '发送时间', '时间', '时间戳', '消息时间', '日期'],
  sender: ['sender', 'from', 'author', 'username', 'nickname', 'sender_name', 'display_name', 'is_sender', '发送者', '发言人', '昵称', '用户名', '成员'],
  content: ['content', 'strcontent', 'text', 'message', 'msg', 'body', 'message_content', '消息内容', '内容', '文本', '正文'],
  chat: ['chat', 'chat_name', 'session', 'conversation', 'contact', 'strtalker', 'talkerid', '群聊', '会话', '联系人', '聊天对象'],
};

function keyForm(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-.:：/\\()[\]{}]+/g, '');
}

function findField(headers, field) {
  const aliases = FIELD_ALIASES[field].map(keyForm);
  return headers.find((header) => {
    const key = keyForm(header);
    return aliases.some((alias) => key === alias || (alias.length >= 4 && key.includes(alias)));
  }) || '';
}

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    for (const key of ['text', 'content', 'title', 'desc', 'message', 'value']) {
      if (value[key] != null) {
        const text = cellText(value[key]);
        if (text) return text;
      }
    }
  }
  return '';
}

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value).trim())) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const ms = numeric < 100000000000 ? numeric * 1000 : numeric;
    return Number.isFinite(new Date(ms).getTime()) ? ms : null;
  }
  const raw = String(value).trim().replace(/[年月]/g, '-').replace(/[日号]/g, ' ').replace(/[./]/g, '-');
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRecords(records, fileName, mapping = {}) {
  if (!Array.isArray(records) || !records.length) return [];
  const headers = [...new Set(records.slice(0, 20).flatMap((row) => Object.keys(row || {})))];
  const columns = Object.fromEntries(['time', 'sender', 'content', 'chat'].map((field) => [
    field,
    Object.prototype.hasOwnProperty.call(mapping, field) ? mapping[field] : findField(headers, field),
  ]));
  if (!columns.content) return [];
  return records.map((row, index) => {
    const text = cellText(row?.[columns.content]);
    if (!text) return null;
    return {
      id: `row-${index + 1}`,
      sourceId: `wechat:${fileName}:${index + 1}`,
      timestamp: parseTimestamp(row?.[columns.time]),
      timestampText: cellText(row?.[columns.time]),
      sender: cellText(row?.[columns.sender]) || '未识别发送者',
      chat: cellText(row?.[columns.chat]),
      text,
    };
  }).filter(Boolean);
}

function parseCsv(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] || '';
  const candidates = [',', '\t', ';'];
  const delimiter = candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => String(value).trim())) rows.push(row);
  if (rows.length < 2) throw new Error('CSV 文件没有可读取的表头和聊天记录。');
  const headers = rows[0].map((value, index) => String(value || '').trim() || `列 ${index + 1}`);
  const records = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  return { headers, records };
}

function collectJsonRecords(value, output = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonRecords(item, output, depth + 1);
    return output;
  }
  if (typeof value !== 'object') return output;
  const entries = Object.entries(value);
  const headers = entries.map(([key]) => key);
  const hasContent = Boolean(findField(headers, 'content'));
  const contentValue = hasContent ? value[findField(headers, 'content')] : null;
  const contentLooksLikeLeaf = typeof contentValue === 'string' || typeof contentValue === 'number' || (contentValue && typeof contentValue === 'object');
  if (hasContent && contentLooksLikeLeaf && (findField(headers, 'time') || findField(headers, 'sender') || entries.length <= 8)) {
    output.push(value);
    return output;
  }
  for (const [, child] of entries) {
    if (child && typeof child === 'object') collectJsonRecords(child, output, depth + 1);
  }
  return output;
}

function parseTextTranscript(text, fileName) {
  const records = [];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const dated = /^(?:\[)?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)(?:\])?\s+(?:\[)?(.{1,80}?)(?:\])?\s*[:：]\s*(.*)$/;
  const tabbed = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)\t([^\t]+)\t(.*)$/;
  const undated = /^(?:\[)?(.{1,60}?)(?:\])?\s*[:：]\s*(.+)$/;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const tabMatch = line.match(tabbed);
    const match = tabMatch || line.match(dated);
    if (match) {
      const time = match[1];
      const sender = match[2].trim().replace(/^\*\*(.*?)\*\*$/, '$1');
      const content = match[3].trim();
      if (content) records.push({
        id: `line-${index + 1}`,
        sourceId: `wechat:${fileName}:line-${index + 1}`,
        timestamp: parseTimestamp(time),
        timestampText: time,
        sender: sender || '未识别发送者',
        chat: '',
        text: content,
      });
      continue;
    }
    const plain = line.match(undated);
    if (plain && !/^[-=*_]{3,}$/.test(line)) {
      records.push({
        id: `line-${index + 1}`,
        sourceId: `wechat:${fileName}:line-${index + 1}`,
        timestamp: null,
        timestampText: '',
        sender: plain[1].trim().replace(/^\*\*(.*?)\*\*$/, '$1') || '未识别发送者',
        chat: '',
        text: plain[2].trim(),
      });
    }
  }
  return records;
}

export function detectColumnMapping(headers) {
  return {
    time: findField(headers, 'time'),
    sender: findField(headers, 'sender'),
    content: findField(headers, 'content'),
    chat: findField(headers, 'chat'),
  };
}

export function remapChatRecords(records, fileName, mapping) {
  return normalizeRecords(records, fileName, mapping);
}

export function parseChatExport(fileName, text) {
  const ext = String(fileName).split('.').pop().toLowerCase();
  const source = String(text || '').replace(/^\uFEFF/, '');
  if (!source.trim()) throw new Error('文件内容为空。');
  if (ext === 'csv') {
    const parsed = parseCsv(source);
    return { format: 'csv', headers: parsed.headers, records: parsed.records, mapping: detectColumnMapping(parsed.headers), messages: normalizeRecords(parsed.records, fileName) };
  }
  if (ext === 'json') {
    let value;
    try { value = JSON.parse(source); } catch { throw new Error('JSON 格式无法解析。'); }
    const records = collectJsonRecords(value);
    if (!records.length) throw new Error('JSON 中没有识别出聊天消息对象。');
    const headers = [...new Set(records.slice(0, 20).flatMap((row) => Object.keys(row || {})))];
    return { format: 'json', headers, records, mapping: detectColumnMapping(headers), messages: normalizeRecords(records, fileName) };
  }
  if (['txt', 'md', 'log'].includes(ext)) {
    const messages = parseTextTranscript(source, fileName);
    if (!messages.length) throw new Error('没有识别出文本聊天行。请导出带有“时间 + 发送者 + 内容”的 CSV/JSON，或使用“发送者：消息”格式的 TXT。');
    return { format: 'text', headers: [], records: [], mapping: {}, messages };
  }
  throw new Error('暂支持 WeChatMsg 导出的 CSV、JSON、TXT / AI-TXT 文件。');
}
