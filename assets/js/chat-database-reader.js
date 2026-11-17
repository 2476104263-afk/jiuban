const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;
const key = (name) => name.toLowerCase().replaceAll('_', '');
const decoder = new TextDecoder('utf-8', { fatal: true });

function rows(db, sql) {
  const statement = db.prepare(sql);
  const result = [];
  try { while (statement.step()) result.push(statement.getAsObject()); }
  finally { statement.free(); }
  return result;
}

function column(columns, aliases) {
  for (const alias of aliases) {
    const found = columns.find((name) => key(name) === key(alias));
    if (found) return found;
  }
  return null;
}

function expression(name, alias, fallback = 'NULL') {
  return `${name ? `CAST(${quote(name)} AS TEXT)` : fallback} AS ${quote(alias)}`;
}

export function readChatDatabase(db, { fileName, limit = 200000, decompress, onProgress = () => {} } = {}) {
  db.run('PRAGMA query_only = ON');
  const check = rows(db, 'PRAGMA quick_check(1)');
  if (!check.length || Object.values(check[0])[0] !== 'ok') throw new Error('数据库完整性检查未通过，请重新复制完整备份。');
  const tables = rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((row) => row.name);
  const contacts = new Map();
  const records = [];
  const warnings = [];
  const stats = { messageTables: 0, nonText: 0, unreadable: 0, truncated: false };
  const getColumns = (table) => rows(db, `PRAGMA table_info(${quote(table)})`).map((row) => row.name);
  for (const table of tables.filter((name) => /^(contact|friend|contacttable|wccontact)$/i.test(name))) {
    const columns = getColumns(table);
    const user = column(columns, ['UserName', 'user_name', 'wxid']);
    const remark = column(columns, ['Remark', 'remark_name']);
    const nickname = column(columns, ['NickName', 'nick_name', 'name']);
    if (!user) continue;
    for (const row of rows(db, `SELECT ${expression(user, 'user')}, ${expression(remark, 'remark')}, ${expression(nickname, 'nickname')} FROM ${quote(table)} LIMIT 50000`)) {
      if (row.user) contacts.set(row.user, row.remark?.trim() || row.nickname?.trim() || row.user);
    }
  }
  const nameIds = new Map();
  const nameTable = tables.find((name) => name.toLowerCase() === 'name2id');
  if (nameTable) {
    const columns = getColumns(nameTable);
    const username = column(columns, ['user_name', 'username']);
    const identifier = column(columns, ['id', 'name_id']);
    if (username) {
      try {
        for (const row of rows(db, `SELECT CAST(${identifier ? quote(identifier) : 'rowid'} AS TEXT) AS id, ${expression(username, 'user')} FROM ${quote(nameTable)} LIMIT 100000`)) nameIds.set(String(row.id), row.user);
      } catch { warnings.push('部分发送者编号无法映射，将保留原始编号。'); }
    }
  }
  for (const table of tables.filter((name) => /^(MSG$|Chat_|Msg_|message$|messages$)/i.test(name))) {
    const columns = getColumns(table);
    const content = column(columns, ['StrContent', 'Message', 'message_content', 'msg_content', 'content']);
    const type = column(columns, ['Type', 'local_type', 'message_type', 'msg_type']);
    const time = column(columns, ['CreateTime', 'create_time', 'timestamp', 'message_create_time']);
    if (!content || !type || !time) continue;
    stats.messageTables += 1;
    const id = column(columns, ['localId', 'MesLocalID', 'local_id', 'id']);
    const serverId = column(columns, ['MsgSvrID', 'MesSvrID', 'server_id']);
    const talker = column(columns, ['StrTalker', 'talker', 'chat_name', 'session_id', 'conversation_id']);
    const sender = column(columns, ['sender_username', 'sender', 'real_sender_id', 'sender_id']);
    const direction = column(columns, ['IsSender', 'is_sender', 'is_send']);
    const des = column(columns, ['Des']);
    const compression = column(columns, ['WCDB_CT_message_content', 'compression_type']);
    const fields = [expression(id, 'id'), expression(serverId, 'serverId'), expression(type, 'type'), expression(time, 'time'), expression(talker, 'chatId'), expression(sender, 'senderId'), expression(direction, 'direction'), expression(des, 'des'), expression(compression, 'compression'), `${quote(content)} AS content`];
    const statement = db.prepare(`SELECT ${fields.join(', ')} FROM ${quote(table)}`);
    let index = 0;
    try {
      while (statement.step()) {
        index += 1;
        const row = statement.getAsObject();
        let baseType;
        try { baseType = Number(BigInt(row.type || '0') & 0xffffn); } catch { stats.unreadable += 1; continue; }
        if (baseType !== 1) { stats.nonText += 1; continue; }
        if (records.length >= limit) { stats.truncated = true; break; }
        let text = row.content;
        try {
          if (text instanceof Uint8Array) {
            if (text[0] === 0x28 && text[1] === 0xb5 && text[2] === 0x2f && text[3] === 0xfd) {
              if (!decompress) throw new Error('compressed');
              text = decompress(text);
            } else if (Number(row.compression) > 0) throw new Error('unsupported compression');
            text = decoder.decode(text);
          }
          if (typeof text !== 'string' || !text.trim() || text.includes('\0')) { stats.unreadable += 1; continue; }
        } catch { stats.unreadable += 1; continue; }
        const chatId = row.chatId || table;
        let senderId = nameIds.get(String(row.senderId)) || row.senderId || '';
        const outgoing = row.direction != null ? Number(row.direction) === 1 : row.des != null ? Number(row.des) === 0 : null;
        if (outgoing === false && (chatId.endsWith('@chatroom') || /^wxid_[^:\n]+:\r?\n/.test(text))) {
          const group = text.match(/^([^:\n]{1,128}):\r?\n([\s\S]*)$/);
          if (group) { senderId = group[1]; text = group[2]; }
        }
        const numericTime = Number(row.time);
        const timestamp = Number.isFinite(numericTime) && row.time != null ? (numericTime < 100000000000 ? numericTime * 1000 : numericTime) : null;
        records.push({
          sourceId: `wechat-db:${fileName}:${table}:${row.id || index}`,
          timestamp: timestamp != null && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : null,
          senderId, outgoing, chatId, table, fileName, text, serverId: row.serverId || '',
        });
        if (index % 5000 === 0) onProgress({ stage: `读取消息（${records.length} 条）`, percent: 100 });
      }
    } finally { statement.free(); }
  }
  return { records, contacts, warnings, stats };
}

export function normalizeDatabaseMessages(records, contacts = new Map(), selfName = '我') {
  return records.map((row, index) => {
    const group = row.chatId.endsWith('@chatroom');
    const unknownChat = /^(Chat_|Msg_)/i.test(row.chatId);
    const chat = contacts.get(row.chatId) || (unknownChat ? `会话 ${row.chatId.slice(0, 20)}` : row.chatId);
    const senderId = row.senderId || (row.outgoing === false && !group && !unknownChat ? row.chatId : '');
    return {
      id: `db-${index + 1}`, sourceId: row.sourceId, timestamp: row.timestamp,
      timestampText: '', sender: row.outgoing === true ? selfName : contacts.get(senderId) || senderId || (group ? '群成员（未识别）' : '未识别发送者'),
      chat, text: row.text, sourceFile: row.fileName, sourceTable: row.table,
    };
  }).sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity));
}
