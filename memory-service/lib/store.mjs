/**
 * store.mjs — SQLite 元数据 + 二进制块文件（AURORA 三层存储的工程实现）
 *
 * L1 活跃索引：memories.code16（4/8/16-bit 前缀均从这 16-bit 完整编码派生）
 * L2 细化编码：同样从 code16 前缀派生（读取成本远低于块文件；这里用同一行模拟）
 * L3 精确向量与证据：vectors.bin 中的定长块（每块 16 条 × DIM float32），
 *    原始文本、来源、版本、确认/删除状态保存在 SQLite。
 *
 * 一致性：新增先写证据与精确向量，再原子写入可检索行；修改生成新版本并使旧版本失效；
 * 删除先置为不可检索，再释放存储槽位。单进程、单用户一致性优先。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DIM, embed, encodeCode16 } from './vector.mjs';

export const BLOCK_SIZE = 16;
export const VECTOR_BYTES = DIM * 4;
export const BLOCK_BYTES = BLOCK_SIZE * VECTOR_BYTES;
const CACHE_BLOCKS = 32;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS memories (
  memory_id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL,
  content TEXT NOT NULL,
  normalized_fact TEXT,
  event_time REAL,
  event_time_text TEXT,
  valid_from REAL,
  valid_to REAL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  quote TEXT,
  memory_type TEXT NOT NULL,
  topics TEXT,
  entities TEXT,
  base_weight REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.5,
  confirmation_state TEXT NOT NULL DEFAULT 'candidate',
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  last_confirmed_at REAL,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at REAL,
  storage_block_id INTEGER,
  storage_slot INTEGER,
  code16 BLOB,
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  permission TEXT NOT NULL DEFAULT 'private'
);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(owner_scope, deleted, confirmation_state);
CREATE TABLE IF NOT EXISTS slots (
  block_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  memory_id TEXT,
  PRIMARY KEY (block_id, slot)
);
CREATE TABLE IF NOT EXISTS confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  action TEXT NOT NULL,
  patch TEXT,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  activation REAL NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS query_logs (
  query_id TEXT PRIMARY KEY,
  created_at REAL NOT NULL,
  query TEXT NOT NULL,
  owner_scope TEXT,
  top_k INTEGER NOT NULL,
  result TEXT,
  trace TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  created_at REAL NOT NULL,
  owner_scope TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT,
  branch_id TEXT,
  content TEXT,
  event_time REAL,
  confirmed INTEGER NOT NULL DEFAULT 1,
  created_at REAL NOT NULL
);
`;

function nowMs() { return Date.now(); }
function newId(prefix) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`; }
function jsonOrNull(value) {
  if (value == null) return null;
  try { return JSON.stringify(value); } catch { return null; }
}
function parseJson(value) {
  if (!value) return [];
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return []; }
}

export class MemoryStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir || process.env.MEMORY_DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
    this.dataDir = path.resolve(this.dataDir);
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.dbPath = path.join(this.dataDir, 'memory.db');
    this.vectorPath = path.join(this.dataDir, 'vectors.bin');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(SCHEMA);
    this.vectorFd = fs.openSync(this.vectorPath, fs.existsSync(this.vectorPath) ? 'r+' : 'w+');
    this.blockCache = new Map();
    this.stats = { blocksRead: 0, bytesRead: 0, vectorsWritten: 0 };
    this.#reconcileSlots();
    this.#initMeta();
  }

  #initMeta() {
    const get = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    if (!get.get('next_slot')) this.#setMeta('next_slot', '0');
    if (!get.get('free_slots')) this.#setMeta('free_slots', '[]');
    if (!get.get('schema_version')) this.#setMeta('schema_version', '1');
  }

  #setMeta(key, value) {
    this.db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }

  #getMeta(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  #freeSlots() {
    try { return JSON.parse(this.#getMeta('free_slots', '[]')); } catch { return []; }
  }

  #saveFreeSlots(list) { this.#setMeta('free_slots', JSON.stringify(list)); }

  /** 启动时根据已索引记忆重建槽位表，避免块文件与元数据不一致 */
  #reconcileSlots() {
    const rows = this.db.prepare('SELECT memory_id, storage_block_id, storage_slot FROM memories WHERE storage_block_id IS NOT NULL AND storage_slot IS NOT NULL').all();
    const seen = new Set();
    const insert = this.db.prepare('INSERT OR REPLACE INTO slots(block_id, slot, memory_id) VALUES(?, ?, ?)');
    this.db.exec('BEGIN');
    let maxSlot = -1;
    try {
      this.db.exec('DELETE FROM slots');
      for (const row of rows) {
        const slot = Number(row.storage_slot);
        insert.run(Number(row.storage_block_id), slot, row.memory_id);
        seen.add(slot);
        if (slot > maxSlot) maxSlot = slot;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    const next = Math.max(Number(this.#getMeta('next_slot', '0')), maxSlot + 1);
    this.#setMeta('next_slot', next);
    const free = this.#freeSlots().filter((s) => !seen.has(s) && s < next);
    this.#saveFreeSlots(free);
  }

  #allocateSlot() {
    const free = this.#freeSlots();
    let slot;
    if (free.length) slot = free.pop();
    else slot = Number(this.#getMeta('next_slot', '0'));
    this.#setMeta('next_slot', Math.max(Number(this.#getMeta('next_slot', '0')), slot + 1));
    this.#saveFreeSlots(free);
    const blockId = Math.floor(slot / BLOCK_SIZE);
    const inBlock = slot % BLOCK_SIZE;
    this.db.prepare('INSERT OR REPLACE INTO slots(block_id, slot, memory_id) VALUES(?, ?, ?)').run(blockId, slot, null);
    return { slot, blockId, inBlock };
  }

  #releaseSlot(blockId, slot) {
    const free = this.#freeSlots();
    if (!free.includes(slot)) free.push(slot);
    this.#saveFreeSlots(free.sort((a, b) => a - b));
    this.db.prepare('DELETE FROM slots WHERE block_id = ? AND slot = ?').run(blockId, slot);
  }

  #writeVector(slot, vec) {
    const offset = slot * VECTOR_BYTES;
    const buf = Buffer.from(new Float32Array(vec).buffer);
    fs.writeSync(this.vectorFd, buf, 0, VECTOR_BYTES, offset);
    this.stats.vectorsWritten += 1;
    this.blockCache.delete(Math.floor(slot / BLOCK_SIZE));
  }

  #ensureBlock(blockId) {
    if (this.blockCache.has(blockId)) {
      return { block: this.blockCache.get(blockId), cached: true };
    }
    const buf = Buffer.alloc(BLOCK_BYTES);
    let bytes = 0;
    try {
      bytes = fs.readSync(this.vectorFd, buf, 0, BLOCK_BYTES, blockId * BLOCK_BYTES);
    } catch {
      bytes = 0;
    }
    const vectors = [];
    for (let i = 0; i < BLOCK_SIZE; i += 1) {
      const off = i * VECTOR_BYTES;
      vectors.push(new Float32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + VECTOR_BYTES)));
    }
    this.blockCache.set(blockId, vectors);
    if (this.blockCache.size > CACHE_BLOCKS) {
      const oldest = this.blockCache.keys().next().value;
      this.blockCache.delete(oldest);
    }
    return { block: vectors, cached: false, bytes: bytes || 0 };
  }

  /** 精确读取一条记忆的向量，返回读数（块级 I/O 计数） */
  readExactVector(slot) {
    const blockId = Math.floor(slot / BLOCK_SIZE);
    const inBlock = slot % BLOCK_SIZE;
    const { block, cached, bytes } = this.#ensureBlock(blockId);
    if (!cached) {
      this.stats.blocksRead += 1;
      this.stats.bytesRead += bytes || 0;
    }
    return { vector: block[inBlock], cached, bytesRead: cached ? 0 : bytes || 0, blockId };
  }

  insertMemory(record) {
    const now = nowMs();
    const memoryId = record.memory_id || newId('mem');
    const content = String(record.content || '').trim();
    if (!content) throw new Error('content required');
    const vec = record.embedding || embed(content);
    const { slot, blockId } = this.#allocateSlot();
    this.#writeVector(slot, vec);
    const code = encodeCode16(vec);
    const row = {
      memory_id: memoryId,
      owner_scope: record.owner_scope || 'default',
      content,
      normalized_fact: record.normalized_fact || content,
      event_time: record.event_time ?? null,
      event_time_text: record.event_time_text ?? null,
      valid_from: record.valid_from ?? null,
      valid_to: record.valid_to ?? null,
      source_type: record.source_type || 'manual',
      source_id: record.source_id ?? null,
      quote: record.quote ?? content,
      memory_type: record.memory_type || 'fact',
      topics: jsonOrNull(record.topics || []),
      entities: jsonOrNull(record.entities || []),
      base_weight: Number(record.base_weight ?? 0.5),
      confidence: Number(record.confidence ?? 0.5),
      confirmation_state: record.confirmation_state || 'candidate',
      version: Number(record.version || 1),
      supersedes_id: record.supersedes_id ?? null,
      created_at: now,
      updated_at: now,
      last_confirmed_at: record.confirmation_state === 'confirmed' ? now : null,
      deleted: 0,
      storage_block_id: blockId,
      storage_slot: slot,
      code16: code,
      embedding_status: 'indexed',
    };
    this.db.prepare(`INSERT INTO memories (
      memory_id, owner_scope, content, normalized_fact, event_time, event_time_text, valid_from, valid_to,
      source_type, source_id, quote, memory_type, topics, entities, base_weight, confidence,
      confirmation_state, version, supersedes_id, created_at, updated_at, last_confirmed_at,
      deleted, deleted_at, storage_block_id, storage_slot, code16, embedding_status, permission
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      row.memory_id, row.owner_scope, row.content, row.normalized_fact, row.event_time, row.event_time_text,
      row.valid_from, row.valid_to, row.source_type, row.source_id, row.quote, row.memory_type, row.topics,
      row.entities, row.base_weight, row.confidence, row.confirmation_state, row.version, row.supersedes_id,
      row.created_at, row.updated_at, row.last_confirmed_at, row.deleted, row.deleted_at ?? null,
      row.storage_block_id, row.storage_slot, row.code16, row.embedding_status, 'private',
    );
    this.db.prepare('UPDATE slots SET memory_id = ? WHERE block_id = ? AND slot = ?').run(memoryId, blockId, slot);
    return this.getMemory(memoryId);
  }

  getMemory(memoryId) {
    const row = this.db.prepare('SELECT * FROM memories WHERE memory_id = ?').get(memoryId);
    return row ? this.#rowToJson(row) : null;
  }

  listMemories({ owner_scope, includeDeleted = false, limit = 200 } = {}) {
    const clauses = [];
    const params = [];
    if (owner_scope) { clauses.push('owner_scope = ?'); params.push(owner_scope); }
    if (!includeDeleted) { clauses.push('deleted = 0'); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM memories ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit);
    return rows.map((r) => this.#rowToJson(r));
  }

  candidates(ownerScope) {
    const rows = this.db.prepare(`SELECT * FROM memories
      WHERE owner_scope = ? AND deleted = 0 AND confirmation_state != 'retracted'
        AND embedding_status = 'indexed' AND code16 IS NOT NULL`).all(ownerScope);
    return rows;
  }

  /** 确认 / 修正 / 拒绝 / 过期 / 撤回 */
  applyAction(memoryId, action, patch = {}) {
    const old = this.getMemory(memoryId);
    if (!old) throw new Error('memory not found');
    const now = nowMs();
    const log = this.db.prepare('INSERT INTO confirmations(memory_id, action, patch, created_at) VALUES(?,?,?,?)');
    if (action === 'confirm') {
      this.db.prepare(`UPDATE memories SET confirmation_state = 'confirmed', confidence = MAX(confidence, 0.75),
        base_weight = MIN(1.0, ROUND(base_weight + 0.1, 4)), last_confirmed_at = ?, updated_at = ? WHERE memory_id = ?`).run(now, now, memoryId);
      log.run(memoryId, 'confirm', jsonOrNull(patch), now);
      return { memory: this.getMemory(memoryId), supersedes: null };
    }
    if (action === 'correct') {
      const content = String(patch.content || old.content).trim();
      if (!content) throw new Error('content required for correction');
      const nextVec = embed(content);
      const created = this.insertMemory({
        owner_scope: old.owner_scope,
        content,
        normalized_fact: patch.normalized_fact || content,
        event_time: patch.event_time ?? old.event_time,
        event_time_text: patch.event_time_text ?? old.event_time_text,
        valid_from: patch.valid_from ?? old.valid_from,
        valid_to: patch.valid_to ?? old.valid_to,
        source_type: old.source_type,
        source_id: old.source_id,
        quote: patch.quote || content,
        memory_type: patch.memory_type || old.memory_type,
        topics: patch.topics || old.topics,
        entities: patch.entities || old.entities,
        base_weight: Math.max(0.5, old.base_weight),
        confidence: 0.8,
        confirmation_state: 'confirmed',
        version: Number(old.version || 1) + 1,
        supersedes_id: old.memory_id,
        embedding: nextVec,
      });
      this.db.prepare(`UPDATE memories SET confirmation_state = 'corrected', valid_to = ?, updated_at = ? WHERE memory_id = ?`).run(now, now, memoryId);
      log.run(memoryId, 'correct', jsonOrNull({ new_memory_id: created.memory_id }), now);
      return { memory: created, supersedes: this.getMemory(memoryId) };
    }
    if (action === 'reject' || action === 'retract') {
      this.db.prepare('UPDATE memories SET confirmation_state = ?, updated_at = ? WHERE memory_id = ?').run(action === 'reject' ? 'retracted' : 'retracted', now, memoryId);
      if (action === 'retract') this.db.prepare('UPDATE memories SET deleted = 1, deleted_at = ? WHERE memory_id = ?').run(now, memoryId);
      log.run(memoryId, action, jsonOrNull(patch), now);
      return { memory: this.getMemory(memoryId), supersedes: null };
    }
    if (action === 'expire') {
      this.db.prepare('UPDATE memories SET confirmation_state = ?, valid_to = COALESCE(?, valid_to), updated_at = ? WHERE memory_id = ?').run('expired', patch.valid_to ?? now, now, memoryId);
      log.run(memoryId, 'expire', jsonOrNull(patch), now);
      return { memory: this.getMemory(memoryId), supersedes: null };
    }
    throw new Error(`unknown action: ${action}`);
  }

  deleteMemory(memoryId, { hard = false } = {}) {
    const row = this.db.prepare('SELECT * FROM memories WHERE memory_id = ?').get(memoryId);
    if (!row) return null;
    const now = nowMs();
    this.db.prepare('UPDATE memories SET deleted = 1, deleted_at = ?, confirmation_state = ?, updated_at = ? WHERE memory_id = ?')
      .run(now, 'retracted', now, memoryId);
    let released = false;
    if (hard && row.storage_slot != null) {
      this.#releaseSlot(Number(row.storage_block_id), Number(row.storage_slot));
      this.db.prepare('UPDATE memories SET storage_block_id = NULL, storage_slot = NULL, code16 = NULL, embedding_status = ? WHERE memory_id = ?').run('removed', memoryId);
      released = true;
    }
    return { memory_id: memoryId, hard, released, memory: this.getMemory(memoryId) };
  }

  logActivations(queryId, memoryIds, scores) {
    const stmt = this.db.prepare('INSERT INTO activations(query_id, memory_id, activation, created_at) VALUES(?,?,?,?)');
    const now = nowMs();
    memoryIds.forEach((id, i) => stmt.run(queryId, id, scores[i] ?? 0, now));
  }

  logQuery(queryId, query, ownerScope, topK, result, trace) {
    this.db.prepare('INSERT OR REPLACE INTO query_logs(query_id, created_at, query, owner_scope, top_k, result, trace) VALUES(?,?,?,?,?,?,?)')
      .run(queryId, nowMs(), query, ownerScope, topK, jsonOrNull(result), jsonOrNull(trace));
  }

  createSnapshot(ownerScope, payload) {
    const id = newId('snap');
    this.db.prepare('INSERT INTO snapshots(snapshot_id, created_at, owner_scope, payload) VALUES(?,?,?,?)')
      .run(id, nowMs(), ownerScope, JSON.stringify(payload));
    return { snapshot_id: id, ...payload };
  }

  getSnapshot(id) {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE snapshot_id = ?').get(id);
    if (!row) return null;
    return { snapshot_id: row.snapshot_id, owner_scope: row.owner_scope, created_at: row.created_at, payload: JSON.parse(row.payload) };
  }

  addOutcome(record) {
    this.db.prepare('INSERT INTO outcomes(decision_id, branch_id, content, event_time, confirmed, created_at) VALUES(?,?,?,?,?,?)')
      .run(record.decision_id ?? null, record.branch_id ?? null, record.content ?? '', record.event_time ?? null, record.confirmed === false ? 0 : 1, nowMs());
  }

  statsSummary() {
    const total = this.db.prepare('SELECT COUNT(*) AS c FROM memories').get().c;
    const active = this.db.prepare("SELECT COUNT(*) AS c FROM memories WHERE deleted = 0 AND confirmation_state != 'retracted'").get().c;
    const confirmed = this.db.prepare("SELECT COUNT(*) AS c FROM memories WHERE confirmation_state = 'confirmed'").get().c;
    const slots = this.db.prepare('SELECT COUNT(*) AS c FROM slots').get().c;
    const blocks = Math.max(0, Math.ceil(Number(this.#getMeta('next_slot', '0')) / BLOCK_SIZE));
    return {
      total, active, confirmed, slots, blocks,
      vectorsFileBytes: fs.existsSync(this.vectorPath) ? fs.statSync(this.vectorPath).size : 0,
      blockBytes: BLOCK_BYTES,
      io: { blocksRead: this.stats.blocksRead, bytesRead: this.stats.bytesRead, vectorsWritten: this.stats.vectorsWritten },
      dim: DIM,
    };
  }

  exportAll(ownerScope) {
    const memories = ownerScope
      ? this.listMemories({ owner_scope: ownerScope, includeDeleted: true, limit: 10000 })
      : this.listMemories({ includeDeleted: true, limit: 10000 });
    const confirmations = this.db.prepare('SELECT * FROM confirmations ORDER BY id').all();
    return { exported_at: nowMs(), dim: DIM, memories, confirmations };
  }

  importAll(payload) {
    if (!payload || !Array.isArray(payload.memories)) throw new Error('invalid import payload');
    let imported = 0;
    for (const m of payload.memories) {
      if (!m || !m.content) continue;
      const exists = this.db.prepare('SELECT 1 FROM memories WHERE memory_id = ?').get(m.memory_id || '');
      if (exists) continue;
      this.insertMemory({ ...m, memory_id: m.memory_id, embedding: undefined });
      imported += 1;
    }
    return { imported };
  }

  #rowToJson(row) {
    return {
      memory_id: row.memory_id,
      owner_scope: row.owner_scope,
      content: row.content,
      normalized_fact: row.normalized_fact,
      event_time: row.event_time,
      event_time_text: row.event_time_text,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      source_type: row.source_type,
      source_id: row.source_id,
      quote: row.quote,
      memory_type: row.memory_type,
      topics: parseJson(row.topics),
      entities: parseJson(row.entities),
      base_weight: Number(Number(row.base_weight).toFixed(4)),
      confidence: Number(Number(row.confidence).toFixed(4)),
      confirmation_state: row.confirmation_state,
      version: row.version,
      supersedes_id: row.supersedes_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_confirmed_at: row.last_confirmed_at,
      deleted: Boolean(row.deleted),
      storage_block_id: row.storage_block_id,
      storage_slot: row.storage_slot,
      code16: row.code16 ? Buffer.from(row.code16).toString('base64') : null,
      embedding_status: row.embedding_status,
    };
  }

  close() {
    try { fs.closeSync(this.vectorFd); } catch {}
    try { this.db.close(); } catch {}
  }
}
