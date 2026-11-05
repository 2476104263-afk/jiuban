/* ==========================================================================
   qqai · 全局状态与持久化
   会话 / 消息 / 设置，全部保存在 localStorage
   ========================================================================== */

import { createSeedConversations } from './data.js';
import { uid } from './util.js';

export const STORAGE_KEY = 'jiuban.state.v1';
export const LEGACY_STORAGE_KEY = 'qchat.state.v1'; // 旧品牌 QChat 的数据，读取后自动迁移
export const STATE_VERSION = 2; // v2：产品改为单一好友「久伴」

export const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  temperature: 1.0,
  maxTokens: 8192,
  stream: true,
  showReasoning: true,
  enterToSend: true,
  theme: 'light',
};

const listeners = new Map();

function safeStorage() {
  try {
    const key = '__jiuban_test__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

const storage = safeStorage();

function normalizeSettings(raw) {
  const base = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (raw[key] !== undefined && raw[key] !== null) base[key] = raw[key];
  }
  const temperature = Number(base.temperature);
  base.temperature = Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : 1;
  const maxTokens = Number(base.maxTokens);
  base.maxTokens = Number.isFinite(maxTokens)
    ? Math.min(8192, Math.max(128, Math.round(maxTokens)))
    : 8192;
  base.baseUrl = String(base.baseUrl || DEFAULT_SETTINGS.baseUrl).trim() || DEFAULT_SETTINGS.baseUrl;
  base.model = String(base.model || DEFAULT_SETTINGS.model);
  base.apiKey = typeof base.apiKey === 'string' ? base.apiKey.trim() : '';
  base.theme = 'light'; // 深色模式已移除
  base.stream = Boolean(base.stream);
  base.showReasoning = base.showReasoning !== false;
  base.enterToSend = base.enterToSend !== false;
  return base;
}

function normalizeConversation(conv) {
  if (!conv || typeof conv !== 'object' || !conv.id) return null;
  const fallbackAvatar = { emoji: '🤖', from: '#5ac8fa', to: '#007aff' };
  const messages = Array.isArray(conv.messages)
    ? conv.messages
        .filter((m) => m && m.role && typeof m.content === 'string')
        .map((m) => {
          const message = {
            ...m,
            id: m.id || uid('msg'),
            createdAt: m.createdAt || Date.now(),
          };
          // 页面刷新 / 崩溃时，清掉永远停在 streaming 的占位消息
          if (message.status === 'streaming') {
            message.status = 'done';
            message.aborted = true;
            if (!message.content) message.content = '（页面已刷新，本次生成被中断）';
          }
          return message;
        })
    : [];
  return {
    id: String(conv.id),
    name: conv.name || '久伴',
    kind: conv.kind === 'group' ? 'group' : 'friend',
    personaId: conv.personaId || null,
    avatar: conv.avatar && conv.avatar.emoji ? conv.avatar : fallbackAvatar,
    members: Array.isArray(conv.members) ? conv.members : [],
    systemPrompt: typeof conv.systemPrompt === 'string' ? conv.systemPrompt : '',
    pinned: Boolean(conv.pinned),
    unread: Number(conv.unread) || 0,
    createdAt: conv.createdAt || Date.now(),
    updatedAt: conv.updatedAt || Date.now(),
    messages,
  };
}

function loadState() {
  const fallback = () => {
    const conversations = createSeedConversations();
    return {
      version: STATE_VERSION,
      conversations,
      activeConvId: conversations[0]?.id || null,
      settings: { ...DEFAULT_SETTINGS },
    };
  };

  if (!storage) return fallback();
  let parsed = null;
  try {
    const raw = storage.getItem(STORAGE_KEY) || storage.getItem(LEGACY_STORAGE_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch (err) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return fallback();

  const settings = normalizeSettings(parsed.settings);

  // v2 迁移：旧版本有多个 AI 好友/群聊，现在改为只有「久伴」一个会话；
  // 保留用户设置（含 DeepSeek API Key、模型参数、主题等），会话数据重置为默认。
  const storedVersion = Number(parsed.version) || 1;
  if (storedVersion < 2) {
    const migrated = createSeedConversations();
    return {
      version: STATE_VERSION,
      conversations: migrated,
      activeConvId: migrated[0]?.id || null,
      settings,
    };
  }

  const conversations = Array.isArray(parsed.conversations)
    ? parsed.conversations.map(normalizeConversation).filter(Boolean)
    : [];
  if (!conversations.length) return fallback();

  const activeConvId =
    conversations.some((c) => c.id === parsed.activeConvId)
      ? parsed.activeConvId
      : conversations[0].id;

  return {
    version: STATE_VERSION,
    conversations,
    activeConvId,
    settings,
  };
}

const state = loadState();

let saveTimer = null;
let dirty = false;

function persistNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!storage) {
    dirty = false;
    return;
  }
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STATE_VERSION,
        conversations: state.conversations,
        activeConvId: state.activeConvId,
        settings: state.settings,
      })
    );
    dirty = false;
  } catch (err) {
    // 存储配额不足（比如消息里带了很大的图片）时静默降级
  }
}

function persist() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 220);
}

window.addEventListener('pagehide', () => {
  if (dirty) persistNow();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && dirty) persistNow();
});

export function emit(event, payload) {
  const exact = listeners.get(event);
  if (exact) {
    for (const fn of Array.from(exact)) {
      try {
        fn(payload, event);
      } catch (err) {
        console.error(`[jiuban] 事件处理器出错 (${event})`, err);
      }
    }
  }
  const wildcard = listeners.get('*');
  if (wildcard) {
    for (const fn of Array.from(wildcard)) {
      try {
        fn(event, payload);
      } catch (err) {
        console.error('[jiuban] 通配事件处理器出错', err);
      }
    }
  }
}

export function subscribe(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => {
    const set = listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (!set.size) listeners.delete(event);
  };
}

function findConversation(convId) {
  return state.conversations.find((conv) => conv.id === convId) || null;
}

function touchConversation(conv) {
  conv.updatedAt = Date.now();
}

export const store = {
  state,

  get settings() {
    return state.settings;
  },

  get conversations() {
    return state.conversations;
  },

  get activeConvId() {
    return state.activeConvId;
  },

  getConversation: findConversation,

  getActiveConversation() {
    return findConversation(state.activeConvId);
  },

  setActiveConversation(convId) {
    if (!findConversation(convId)) return null;
    if (state.activeConvId === convId) return findConversation(convId);
    state.activeConvId = convId;
    persist();
    emit('active:changed', convId);
    return findConversation(convId);
  },

  markRead(convId) {
    const conv = findConversation(convId);
    if (!conv || !conv.unread) return;
    conv.unread = 0;
    persist();
    emit('conversations:changed', state.conversations);
  },

  updateSettings(patch = {}) {
    const next = normalizeSettings({ ...state.settings, ...patch });
    const changed = Object.keys(next).some((key) => next[key] !== state.settings[key]);
    state.settings = next;
    if (changed) {
      persist();
      emit('settings:changed', state.settings);
    }
    return state.settings;
  },

  createConversation({ name, avatar, personaId = null, kind = 'friend', members = [], systemPrompt = '' }) {
    const conv = {
      id: uid('conv'),
      name: name || '新的好友',
      kind: kind === 'group' ? 'group' : 'friend',
      personaId,
      avatar: avatar && avatar.emoji ? avatar : { emoji: '🤖', from: '#5ac8fa', to: '#007aff' },
      members: Array.isArray(members) ? members : [],
      systemPrompt,
      pinned: false,
      unread: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    state.conversations.unshift(conv);
    state.activeConvId = conv.id;
    persist();
    emit('conversations:changed', state.conversations);
    emit('active:changed', conv.id);
    return conv;
  },

  updateConversation(convId, patch = {}) {
    const conv = findConversation(convId);
    if (!conv) return null;
    Object.assign(conv, patch);
    if (patch.avatar && !patch.avatar.emoji) conv.avatar = { emoji: '🤖', from: '#5ac8fa', to: '#007aff' };
    touchConversation(conv);
    persist();
    emit('conversations:changed', state.conversations);
    return conv;
  },

  deleteConversation(convId) {
    const index = state.conversations.findIndex((conv) => conv.id === convId);
    if (index < 0) return false;
    state.conversations.splice(index, 1);
    if (!state.conversations.length) {
      const seeded = createSeedConversations();
      state.conversations.push(...seeded);
      state.activeConvId = state.conversations[0]?.id || null;
    } else if (state.activeConvId === convId) {
      state.activeConvId = state.conversations[Math.min(index, state.conversations.length - 1)].id;
    }
    persist();
    emit('conversations:changed', state.conversations);
    emit('active:changed', state.activeConvId);
    return true;
  },

  appendMessage(convId, message) {
    const conv = findConversation(convId);
    if (!conv) return null;
    const msg = {
      id: message.id || uid('msg'),
      role: message.role || 'assistant',
      content: message.content || '',
      createdAt: message.createdAt || Date.now(),
      status: message.status || 'done',
      ...message,
    };
    conv.messages.push(msg);
    touchConversation(conv);
    if (msg.role === 'assistant' && state.activeConvId !== convId) {
      conv.unread = (conv.unread || 0) + 1;
    }
    persist();
    emit('messages:changed', { convId, message: msg, action: 'append' });
    emit('conversations:changed', state.conversations);
    return msg;
  },

  updateMessage(convId, messageId, patch = {}) {
    const conv = findConversation(convId);
    if (!conv) return null;
    const msg = conv.messages.find((item) => item.id === messageId);
    if (!msg) return null;
    Object.assign(msg, patch);
    touchConversation(conv);
    persist();
    emit('messages:changed', { convId, message: msg, action: 'update' });
    return msg;
  },

  deleteMessage(convId, messageId) {
    const conv = findConversation(convId);
    if (!conv) return false;
    const index = conv.messages.findIndex((item) => item.id === messageId);
    if (index < 0) return false;
    conv.messages.splice(index, 1);
    touchConversation(conv);
    persist();
    emit('messages:changed', { convId, action: 'delete' });
    emit('conversations:changed', state.conversations);
    return true;
  },

  resetChats() {
    state.conversations = createSeedConversations();
    state.activeConvId = state.conversations[0]?.id || null;
    persistNow();
    emit('conversations:changed', state.conversations);
    emit('active:changed', state.activeConvId);
  },

  resetAll() {
    state.conversations = createSeedConversations();
    state.activeConvId = state.conversations[0]?.id || null;
    state.settings = { ...DEFAULT_SETTINGS };
    persistNow();
    emit('settings:changed', state.settings);
    emit('conversations:changed', state.conversations);
    emit('active:changed', state.activeConvId);
  },

  flush: persistNow,

  emit,

  subscribe,
};

/* 便于其他模块清理时使用 */
export { persist };

// 首次加载后立即持久化一次：把刷新前残留的 streaming 状态归一化后写回 localStorage
persist();
