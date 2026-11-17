import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import initSqlJs from '../node_modules/sql.js/dist/sql-wasm.js';
import { decompress } from '../node_modules/fzstd/esm/index.mjs';
import { decryptDatabase } from '../../../assets/js/chat-database-crypto.js';
import { readChatDatabase, normalizeDatabaseMessages } from '../../../assets/js/chat-database-reader.js';

const SQL = await initSqlJs({ locateFile: (file) => fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url)) });
const fixture = (name) => fs.readFile(new URL(`./fixtures/${name}`, import.meta.url));
const TEST_KEY = '11'.repeat(32); // Public synthetic-fixture key, never a real account key.

// Reference encoder uses Node/OpenSSL, independently of the browser WebCrypto
// decoder, and standard SQLite files created with reserved page space.
function encryptFixture(plain, { pageSize, reserve, hash, iterations = 0 }) {
  const salt = Buffer.from('2233445566778899aabbccddeeff0011', 'hex');
  const password = Buffer.from(TEST_KEY, 'hex');
  const key = iterations ? crypto.pbkdf2Sync(password, salt, iterations, 32, hash) : password;
  const macKey = crypto.pbkdf2Sync(key, Buffer.from(salt.map((value) => value ^ 0x3a)), 2, 32, hash);
  const output = Buffer.alloc(plain.length);
  output.set(salt);
  for (let start = 0, number = 1; start < plain.length; start += pageSize, number++) {
    const offset = number === 1 ? 16 : 0;
    const iv = Buffer.alloc(16, number);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    cipher.setAutoPadding(false);
    const payload = Buffer.concat([cipher.update(plain.subarray(start + offset, start + pageSize - reserve)), cipher.final()]);
    output.set(payload, start + offset);
    output.set(iv, start + pageSize - reserve);
    const pageNumber = Buffer.alloc(4);
    pageNumber.writeUInt32LE(number);
    output.set(crypto.createHmac(hash, macKey).update(payload).update(iv).update(pageNumber).digest(), start + pageSize - reserve + 16);
  }
  return output;
}

test('reads Windows text messages, direction, group senders, contacts and exact large IDs', async () => {
  const data = await decryptDatabase(await fixture('windows-plain.db'));
  const db = new SQL.Database(data.bytes);
  try {
    const result = readChatDatabase(db, { fileName: 'MSG0.db' });
    assert.equal(result.records.length, 3);
    assert.equal(result.stats.nonText, 1);
    assert.equal(result.records[0].serverId, '921234567890123456');
    const messages = normalizeDatabaseMessages(result.records, result.contacts, '测试本人');
    assert.equal(messages[0].sender, '测试本人');
    assert.equal(messages[1].sender, '测试好友');
    assert.equal(messages[1].chat, '测试好友');
    assert.equal(messages[2].sender, 'wxid_member');
    assert.equal(messages[2].text, '明天一起开会');
    assert.match(messages[0].sourceId, /MSG0.db:MSG:1$/);
  } finally { db.close(); }
});

test('decodes MemoTrace 0.2.8 page format with independent OpenSSL fixture and checks every page', async () => {
  const plain = await fixture('windows-reserved.db');
  const encrypted = encryptFixture(plain, { pageSize: 4096, reserve: 48, hash: 'sha1', iterations: 64000 });
  await fs.writeFile(new URL('./fixtures/windows-encrypted.db', import.meta.url), encrypted);
  const decoded = await decryptDatabase(encrypted, TEST_KEY);
  assert.deepEqual(Buffer.from(decoded.bytes), plain);
  const damaged = Buffer.from(encrypted);
  damaged[4096 + 5] ^= 1;
  await assert.rejects(() => decryptDatabase(damaged, TEST_KEY), /第 2 页校验失败/);
  await assert.rejects(() => decryptDatabase(encrypted, '22'.repeat(32)), /密钥不匹配/);
});

test('reads Mac-style tables and decrypts 1024-byte raw-key SQLCipher pages', async () => {
  const plain = await fixture('mac-legacy.db');
  const encrypted = encryptFixture(plain, { pageSize: 1024, reserve: 48, hash: 'sha1' });
  const decoded = await decryptDatabase(encrypted, TEST_KEY);
  assert.deepEqual(Buffer.from(decoded.bytes), plain);
  const db = new SQL.Database(decoded.bytes);
  try {
    const read = readChatDatabase(db, { fileName: 'msg_0.db' });
    const messages = normalizeDatabaseMessages(read.records);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].sender, '我');
    assert.equal(messages[1].sender, '未识别发送者');
    assert.match(messages[0].chat, /会话 Chat_demo/);
  } finally { db.close(); }
});

test('decodes SQLCipher 4 raw-key pages and Zstd text without rounding IDs', async () => {
  const plain = await fixture('modern-reserved.db');
  const encrypted = encryptFixture(plain, { pageSize: 4096, reserve: 80, hash: 'sha512' });
  const decoded = await decryptDatabase(encrypted, TEST_KEY);
  assert.deepEqual(Buffer.from(decoded.bytes), plain);
  const db = new SQL.Database(decoded.bytes);
  try {
    const read = readChatDatabase(db, { fileName: 'message_0.db', decompress });
    assert.equal(read.records[0].text, '压缩文本项目计划');
    assert.equal(read.records[0].serverId, '9223372036854775806');
    assert.equal(read.records[0].senderId, 'wxid_friend');
    assert.equal(read.stats.unreadable, 0);
    assert.equal(readChatDatabase(db, { fileName: 'message_0.db' }).stats.unreadable, 1);
  } finally { db.close(); }
});

test('handles schema names as identifiers, reports truncation, and never returns a key in errors', async () => {
  const db = new SQL.Database(await fixture('windows-plain.db'));
  try {
    const result = readChatDatabase(db, { fileName: 'test.db', limit: 1 });
    assert.equal(result.records.length, 1);
    assert.equal(result.stats.truncated, true);
    assert.throws(() => db.run('DROP TABLE MSG'), /readonly/);
  } finally { db.close(); }
  await assert.rejects(() => decryptDatabase(new Uint8Array(4096), TEST_KEY), (error) => !error.message.includes(TEST_KEY) && /密钥不匹配/.test(error.message));
  await assert.rejects(() => decryptDatabase(new Uint8Array(4096), 'not-a-key'), /十六进制/);
});

test('supports remaining raw/derived page profiles and validates an explicit salt', async () => {
  for (const [file, config] of [
    ['windows-reserved.db', { pageSize: 4096, reserve: 48, hash: 'sha1' }],
    ['mac-legacy.db', { pageSize: 1024, reserve: 48, hash: 'sha1', iterations: 64000 }],
    ['modern-reserved.db', { pageSize: 4096, reserve: 80, hash: 'sha512', iterations: 256000 }],
  ]) {
    const plain = await fixture(file);
    const encrypted = encryptFixture(plain, config);
    assert.deepEqual(Buffer.from((await decryptDatabase(encrypted, TEST_KEY)).bytes), plain);
    const withSalt = `${TEST_KEY}${encrypted.subarray(0, 16).toString('hex')}`;
    assert.deepEqual(Buffer.from((await decryptDatabase(encrypted, withSalt)).bytes), plain);
  }
  await assert.rejects(() => decryptDatabase(new Uint8Array(4096), `${TEST_KEY}${'ff'.repeat(16)}`), /盐值/);
});
