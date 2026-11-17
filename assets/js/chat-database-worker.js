importScripts('../vendor/chat-database/sql-wasm.js');
const engine = initSqlJs({ locateFile: (file) => new URL(`../vendor/chat-database/${file}`, self.location.href).href });

self.onmessage = async ({ data }) => {
  let key = data.key || '';
  try {
    const [SQL, { decryptDatabase }, { readChatDatabase, normalizeDatabaseMessages }, { decompress }] = await Promise.all([
      engine, import('./chat-database-crypto.js'), import('./chat-database-reader.js'), import('../vendor/chat-database/fzstd.mjs'),
    ]);
    const records = [];
    const contacts = new Map();
    const reports = [];
    let failures = 0;
    for (let index = 0; index < data.files.length; index++) {
      const file = data.files[index];
      let db;
      let plain;
      try {
        self.postMessage({ progress: `${index + 1}/${data.files.length} · ${file.name} · 读取数据库` });
        const result = await decryptDatabase(new Uint8Array(await file.arrayBuffer()), key, {
          profileId: data.profileId,
          onProgress: ({ stage, percent }) => self.postMessage({ progress: `${index + 1}/${data.files.length} · ${file.name} · ${stage} ${percent}%` }),
        });
        plain = result.bytes;
        db = new SQL.Database(plain);
        const read = readChatDatabase(db, { fileName: file.webkitRelativePath || file.name, limit: Math.max(0, 200000 - records.length), decompress });
        for (const record of read.records) records.push(record);
        for (const [id, name] of read.contacts) contacts.set(id, name);
        reports.push({ file: file.name, profile: result.profile, text: read.records.length, ...read.stats, warnings: read.warnings });
      } catch (error) {
        failures += 1;
        reports.push({ file: file.name, error: error.message || '数据库读取失败' });
      } finally { db?.close(); plain?.fill(0); }
    }
    const messages = normalizeDatabaseMessages(records, contacts, data.selfName || '我');
    self.postMessage({ result: { messages, reports, failures, sourceName: `微信数据库（${data.files.length} 个文件）` } });
  } catch (error) {
    self.postMessage({ error: error.message || '数据库提取模块加载失败，请刷新重试。' });
  } finally { key = ''; data.key = ''; }
};
