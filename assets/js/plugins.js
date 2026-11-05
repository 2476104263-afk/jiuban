/* ==========================================================================
   jiuban · 插件注册表与工具运行时
   内置插件目录 / Function Calling 工具 schema / 安全执行 / 提示词注入 / 持久化
   —— 本模块尽量保持纯逻辑（只在访问 localStorage 时做 window 判断），
      不主动操作 DOM、不发起任何网络请求、不使用 eval / new Function。
   ========================================================================== */

import { store, emit as storeEmit } from './store.js';

export const PLUGINS_STORAGE_KEY = 'jiuban.plugins.v1';
export const LEGACY_PLUGINS_STORAGE_KEY = 'qchat.plugins.v1'; // 旧品牌 QChat 的插件配置
export const TODOS_STORAGE_KEY = 'jiuban.plugins.todos.v1';
export const LEGACY_TODOS_STORAGE_KEY = 'qchat.plugins.todos.v1'; // 旧品牌 QChat 的待办
export const CONFIG_VERSION = 1;
export const MAX_CUSTOM_PLUGINS = 30;
export const DEFAULT_INSTALLED_IDS = ['calculator', 'time', 'todos', 'translator'];

const MAX_NAME_LEN = 20;
const MAX_DESC_LEN = 80;
const MAX_PROMPT_LEN = 2000;
const MAX_CUSTOM_CATEGORY_LEN = 10;
const MAX_EXPRESSION_LEN = 200;
const MAX_TOOL_RESULT_LEN = 4000;

/* ==========================================================================
   基础工具（不依赖 DOM）
   ========================================================================== */

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clampInt(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function safeLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__jiuban_plugins_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

const storage = safeLocalStorage();

function randomInt(max) {
  if (max <= 0) return 0;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] % max;
    }
  } catch (err) {
    /* 降级到 Math.random */
  }
  return Math.floor(Math.random() * max);
}

function uuidV4() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (err) {
    /* 降级到自实现 */
  }
  const bytes = new Uint8Array(16);
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
  } catch (err) {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) throw new Error('计算结果不是有效数值');
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  let text = String(Math.round(value * 1e10) / 1e10);
  if (text.includes('e')) {
    text = value
      .toFixed(10)
      .replace(/0+$/, '')
      .replace(/\.$/, '');
  }
  return text;
}

function firstGrapheme(input, fallback = '🧩') {
  const text = String(input == null ? '' : input).trim();
  if (!text) return fallback;
  const chars = Array.from(text);
  return chars[0] || fallback;
}

function truncate(text, max) {
  const value = String(text == null ? '' : text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/* ==========================================================================
   计算器：tokenizer + 递归下降解析（绝不使用 eval / new Function）
   支持 + - * / % ** 与括号、一元正负号、小数、pi / e 常量
   ========================================================================== */

function tokenizeExpression(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j += 1;
      const text = source.slice(i, j);
      if (text === '.' || (text.match(/\./g) || []).length > 1) {
        throw new Error(`数字格式不正确：${text}`);
      }
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(`数字格式不正确：${text}`);
      tokens.push({ type: 'number', value });
      i = j;
      continue;
    }
    if (ch === '*' && source[i + 1] === '*') {
      tokens.push({ type: 'operator', value: '**' });
      i += 2;
      continue;
    }
    if ('+-*/%'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i += 1;
      continue;
    }
    throw new Error(`不支持的字符「${ch}」`);
  }
  return tokens;
}

function parseExpressionTokens(tokens) {
  let pos = 0;
  let steps = 0;

  const guard = () => {
    steps += 1;
    if (steps > 3000) throw new Error('表达式过于复杂');
  };
  const peek = () => tokens[pos] || null;
  const isOperator = (value) => {
    const token = peek();
    return Boolean(token && token.type === 'operator' && token.value === value);
  };
  const isParen = (value) => {
    const token = peek();
    return Boolean(token && token.type === 'paren' && token.value === value);
  };
  const next = () => {
    const token = tokens[pos];
    pos += 1;
    return token;
  };

  function parsePrimary() {
    guard();
    const token = peek();
    if (!token) throw new Error('表达式不完整');
    if (isParen('(')) {
      next();
      const value = parseAdditive();
      if (!isParen(')')) throw new Error('括号不匹配');
      next();
      return value;
    }
    if (token.type === 'number') {
      next();
      return token.value;
    }
    throw new Error(`无法识别的符号「${String(token.value)}」`);
  }

  function parsePower() {
    guard();
    const base = parsePrimary();
    if (isOperator('**')) {
      next();
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parseUnary() {
    guard();
    if (isOperator('-')) {
      next();
      return -parseUnary();
    }
    if (isOperator('+')) {
      next();
      return parseUnary();
    }
    return parsePower();
  }

  function parseMultiplicative() {
    let left = parseUnary();
    for (;;) {
      guard();
      if (isOperator('*')) {
        next();
        left *= parseUnary();
      } else if (isOperator('/')) {
        next();
        const right = parseUnary();
        if (right === 0) throw new Error('除数不能为 0');
        left /= right;
      } else if (isOperator('%')) {
        next();
        const right = parseUnary();
        if (right === 0) throw new Error('取余的除数不能为 0');
        left %= right;
      } else {
        return left;
      }
    }
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    for (;;) {
      guard();
      if (isOperator('+')) {
        next();
        left += parseMultiplicative();
      } else if (isOperator('-')) {
        next();
        left -= parseMultiplicative();
      } else {
        return left;
      }
    }
  }

  const result = parseAdditive();
  if (pos !== tokens.length) throw new Error('表达式格式不正确');
  return result;
}

function safeEvaluateExpression(expression) {
  const raw = String(expression == null ? '' : expression).trim();
  if (!raw) throw new Error('表达式为空');
  if (raw.length > MAX_EXPRESSION_LEN) throw new Error(`表达式过长（最多 ${MAX_EXPRESSION_LEN} 个字符）`);
  const normalized = raw
    .replace(/[×✕✖]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/，/g, '')
    .replace(/[pi]/g, (match) => match) // 保留字母用于常量识别（见下）
    .replace(/\s+/g, '');
  const cleaned = normalized.replace(/π/g, 'pi').replace(/[Pp][Ii]/g, 'pi');
  // 常量识别：把独立的 pi / e 替换为数值字面量，避免解析器引入标识符分支
  const withConstants = cleaned
    .replace(/(?<![a-z0-9.])pi(?![a-z0-9.])/g, `${Math.PI}`)
    .replace(/(?<![a-z0-9.])e(?![a-z0-9.])/g, `${Math.E}`);
  if (/[a-z]/i.test(withConstants)) throw new Error('表达式只支持数字、+ - * / % ** 与括号');
  const tokens = tokenizeExpression(withConstants);
  if (!tokens.length) throw new Error('表达式为空');
  const value = parseExpressionTokens(tokens);
  if (!Number.isFinite(value)) throw new Error('计算结果不是有效数值');
  return { expression: raw, value };
}

/* ==========================================================================
   单位换算表
   ========================================================================== */

const UNIT_GROUPS = {
  length: {
    label: '长度',
    units: [
      ['mm', ['毫米', '公厘'], 0.001],
      ['cm', ['厘米', '公分'], 0.01],
      ['m', ['米', '公尺'], 1],
      ['km', ['千米', '公里'], 1000],
      ['in', ['英寸', '寸'], 0.0254],
      ['ft', ['英尺', '呎'], 0.3048],
      ['yd', ['码', 'yard'], 0.9144],
      ['mi', ['英里'], 1609.344],
    ],
  },
  mass: {
    label: '重量',
    units: [
      ['mg', ['毫克'], 1e-6],
      ['g', ['克', '公克'], 0.001],
      ['kg', ['千克', '公斤'], 1],
      ['t', ['吨', '公吨'], 1000],
      ['oz', ['盎司'], 0.028349523125],
      ['lb', ['磅'], 0.45359237],
    ],
  },
  temperature: {
    label: '温度',
    units: [
      ['c', ['摄氏', '摄氏度', 'celsius', '°c'], 1],
      ['f', ['华氏', '华氏度', 'fahrenheit', '°f'], 1],
      ['k', ['开', '开尔文', 'kelvin'], 1],
    ],
  },
};

const UNIT_LOOKUP = new Map();
const UNIT_DISPLAY = new Map();

function normalizeUnitKey(input) {
  return String(input == null ? '' : input)
    .trim()
    .toLowerCase()
    .replace(/[°\s]/g, '');
}

for (const [groupKey, group] of Object.entries(UNIT_GROUPS)) {
  for (const [key, aliases, factor] of group.units) {
    const entry = { group: groupKey, key, factor, label: aliases[0] };
    UNIT_DISPLAY.set(`${groupKey}:${key}`, aliases[0]);
    for (const alias of [key, ...aliases]) {
      UNIT_LOOKUP.set(normalizeUnitKey(alias), entry);
    }
  }
}

function toCelsius(value, key) {
  if (key === 'c') return value;
  if (key === 'f') return ((value - 32) * 5) / 9;
  return value - 273.15;
}

function fromCelsius(value, key) {
  if (key === 'c') return value;
  if (key === 'f') return (value * 9) / 5 + 32;
  return value + 273.15;
}

function convertUnitValue(value, fromEntry, toEntry) {
  if (fromEntry.group === 'temperature') {
    return fromCelsius(toCelsius(value, fromEntry.key), toEntry.key);
  }
  return (value * fromEntry.factor) / toEntry.factor;
}

/* ==========================================================================
   待办清单（localStorage）
   ========================================================================== */

let todosCache = null;

function normalizeTodo(item) {
  if (!item || typeof item !== 'object') return null;
  const text = String(item.text == null ? '' : item.text).trim();
  if (!text) return null;
  return {
    text: truncate(text, 160),
    done: Boolean(item.done),
    createdAt: Number(item.createdAt) || Date.now(),
  };
}

function loadTodos() {
  if (todosCache) return todosCache;
  todosCache = [];
  if (storage) {
    try {
      const raw =
        storage.getItem(TODOS_STORAGE_KEY) || storage.getItem(LEGACY_TODOS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        todosCache = parsed.map(normalizeTodo).filter(Boolean);
      }
      // 旧品牌迁移：把 qchat.plugins.todos.v1 的数据落到新 key
      if (storage.getItem(LEGACY_TODOS_STORAGE_KEY) && !storage.getItem(TODOS_STORAGE_KEY)) {
        try {
          storage.setItem(TODOS_STORAGE_KEY, JSON.stringify(todosCache));
        } catch (err) {
          /* 配额不足时忽略 */
        }
      }
    } catch (err) {
      todosCache = [];
    }
  }
  return todosCache;
}

function saveTodos(list) {
  todosCache = list;
  if (!storage) return;
  try {
    storage.setItem(TODOS_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    /* 配额不足时静默降级为内存态 */
  }
}

function formatTodoList(list) {
  if (!list.length) return '待办清单还是空的，可以用 add 添加一项。';
  const doneCount = list.filter((item) => item.done).length;
  const lines = list.map((item, index) => `${index + 1}. ${item.done ? '✅' : '⬜'} ${item.text}`);
  return `待办清单（共 ${list.length} 项，已完成 ${doneCount} 项）：\n${lines.join('\n')}`;
}

function findTodoIndex(list, input) {
  const text = String(input == null ? '' : input).trim();
  if (!text) return -1;
  if (/^\d+$/.test(text)) {
    const index = Number(text);
    if (index >= 1 && index <= list.length) return index - 1;
  }
  const exact = list.findIndex((item) => item.text === text);
  if (exact >= 0) return exact;
  return list.findIndex((item) => item.text.includes(text));
}

/* ==========================================================================
   内置插件目录
   ========================================================================== */

const weatherConditions = [
  ['晴', '☀️', '适合出门散步'],
  ['多云', '⛅', '体感舒适'],
  ['阴', '☁️', '光线偏暗'],
  ['小雨', '🌧️', '记得带伞'],
  ['雷阵雨', '⛈️', '尽量减少外出'],
  ['小雪', '🌨️', '路面湿滑，注意保暖'],
];

function formatTimeText(timeZone) {
  const now = new Date();
  let zone = String(timeZone == null ? '' : timeZone).trim();
  let validZone = false;
  if (zone) {
    try {
      new Intl.DateTimeFormat('zh-CN', { timeZone: zone }).format(now);
      validZone = true;
    } catch (err) {
      validZone = false;
    }
  }
  if (!validZone) zone = '';
  const options = {
    timeZone: zone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hourCycle: 'h23',
  };
  let parts;
  try {
    parts = new Intl.DateTimeFormat('zh-CN', options).formatToParts(now);
  } catch (err) {
    parts = new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: undefined }).formatToParts(now);
  }
  const get = (type) => {
    const part = parts.find((item) => item.type === type);
    return part ? part.value : '';
  };
  let resolvedZone = zone || '本地时区';
  try {
    resolvedZone = Intl.DateTimeFormat().resolvedOptions().timeZone || resolvedZone;
  } catch (err) {
    /* 忽略 */
  }
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const hh = get('hour');
  const mm = get('minute');
  const ss = get('second');
  const weekday = get('weekday');
  const requestedNote = timeZone && !validZone ? `（未识别时区「${timeZone}」，已回退到本地时区）` : '';
  return {
    zone: resolvedZone,
    weekday,
    dateText: `${y}-${m}-${d}`,
    timeText: `${hh}:${mm}:${ss}`,
    fullText: `${y}年${Number(m)}月${Number(d)}日 ${weekday} ${hh}:${mm}:${ss}（${resolvedZone}）${requestedNote}`,
    timestamp: now.getTime(),
  };
}

function demoWeather(city) {
  const name = truncate(String(city == null ? '' : city).trim() || '北京', 32);
  const seed = hashString(name);
  const [condition, emoji, tip] = weatherConditions[seed % weatherConditions.length];
  const temperature = 8 + (seed % 22);
  const feel = temperature + ((seed >> 3) % 4) - 2;
  const humidity = 32 + (seed % 58);
  const windLevel = 1 + (seed % 5);
  const windDir = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'][seed % 8];
  return {
    city: name,
    condition,
    emoji,
    tip,
    temperature,
    feel,
    humidity,
    windDir,
    windLevel,
  };
}

function demoSearch(query) {
  const name = truncate(String(query == null ? '' : query).trim() || '久伴', 60);
  const templates = [
    {
      title: `${name} · 官方文档`,
      snippet: `与「${name}」相关的基础概念、快速上手与常见问题汇总（演示条目）。`,
    },
    {
      title: `${name} 最佳实践与踩坑记录`,
      snippet: `社区开发者整理的「${name}」实践笔记，包含性能与兼容性经验（演示条目）。`,
    },
    {
      title: `${name} 最新动态与讨论`,
      snippet: `关于「${name}」的近期讨论与版本更新摘要（演示条目）。`,
    },
  ];
  return { query: name, results: templates };
}

export const BUILTIN_PLUGINS = [
  {
    id: 'calculator',
    name: '计算器',
    icon: '🧮',
    kind: 'tool',
    category: '效率',
    desc: '让 AI 精确计算数学表达式，避免心算错误',
    tools: [
      {
        type: 'function',
        function: {
          name: 'calculate',
          description: '计算数学表达式，支持 + - * / % ** 与括号、小数和 pi/e 常量。当用户需要精确算术时调用。',
          parameters: {
            type: 'object',
            properties: {
              expression: {
                type: 'string',
                description: '要计算的数学表达式，例如 (12+8)*3/4 或 2**10',
              },
            },
            required: ['expression'],
            additionalProperties: false,
          },
        },
      },
    ],
    async handler(args) {
      const { expression, value } = safeEvaluateExpression(args.expression);
      const formatted = formatNumber(value);
      return {
        ok: true,
        result: `表达式 ${expression} 的计算结果是 ${formatted}。`,
        display: `🧮 ${truncate(expression, 40)} = ${formatted}`,
      };
    },
  },
  {
    id: 'time',
    name: '时间助手',
    icon: '⏰',
    kind: 'tool',
    category: '效率',
    desc: '读取真实本地时间、日期与星期，可指定 IANA 时区',
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_current_time',
          description: '获取当前真实日期时间与星期。用户在问现在几点、今天几号、星期几时调用。',
          parameters: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: '可选，IANA 时区名称，例如 Asia/Shanghai、America/New_York；不传则使用本地时区',
              },
            },
            additionalProperties: false,
          },
        },
      },
    ],
    async handler(args) {
      const info = formatTimeText(args.timezone);
      return {
        ok: true,
        result: `当前时间：${info.fullText}。星期：${info.weekday}。时间戳：${info.timestamp}。`,
        display: `⏰ ${info.dateText} ${info.timeText.slice(0, 5)} · ${info.weekday}`,
      };
    },
  },
  {
    id: 'weather',
    name: '天气助手',
    icon: '🌤️',
    kind: 'tool',
    category: '生活',
    desc: '查询城市天气（内置演示数据，未联网，用于演示函数调用）',
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description:
            '查询指定城市的天气。注意：当前为内置演示数据，不会联网获取真实天气，回答时请明确告知用户这是演示数据。',
          parameters: {
            type: 'object',
            properties: {
              city: {
                type: 'string',
                description: '城市名称，例如 北京、上海、深圳',
              },
            },
            required: ['city'],
            additionalProperties: false,
          },
        },
      },
    ],
    async handler(args) {
      const city = String(args.city == null ? '' : args.city).trim();
      if (!city) throw new Error('请提供城市名称');
      const weather = demoWeather(city);
      return {
        ok: true,
        result: [
          '【演示数据 · 未联网】',
          `城市：${weather.city}`,
          `天气：${weather.condition} ${weather.emoji}，气温 ${weather.temperature}°C（体感 ${weather.feel}°C）`,
          `湿度：${weather.humidity}%　风向风力：${weather.windDir} ${weather.windLevel} 级`,
          `提示：${weather.tip}`,
          '说明：这是 久伴 内置的演示天气数据，未接入任何真实天气接口。回答用户时请说明是演示数据。',
        ].join('\n'),
        display: `🌤️ ${truncate(weather.city, 12)} · ${weather.condition} ${weather.temperature}°C（演示）`,
      };
    },
  },
  {
    id: 'todos',
    name: '待办清单',
    icon: '✅',
    kind: 'tool',
    category: '效率',
    desc: '增删查改本地待办事项，数据只保存在浏览器',
    tools: [
      {
        type: 'function',
        function: {
          name: 'manage_todos',
          description: '管理用户的本地待办清单。可添加、查看、完成、清空待办事项。',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['add', 'list', 'done', 'clear'],
                description: '操作类型：add 添加、list 查看、done 标记完成、clear 清空全部',
              },
              item: {
                type: 'string',
                description: '待办内容（action=add 时必填）或要标记完成的事项序号/关键字（action=done 时必填）',
              },
            },
            required: ['action'],
            additionalProperties: false,
          },
        },
      },
    ],
    async handler(args) {
      const action = String(args.action == null ? '' : args.action).trim().toLowerCase();
      const list = loadTodos();
      if (action === 'list') {
        return {
          ok: true,
          result: formatTodoList(list),
          display: list.length
            ? `✅ ${list.length} 项待办 · ${list.filter((item) => !item.done).length} 项未完成`
            : '✅ 待办清单是空的',
        };
      }
      if (action === 'add') {
        const text = truncate(String(args.item == null ? '' : args.item).trim(), 160);
        if (!text) throw new Error('添加待办需要提供内容（item）');
        if (list.some((item) => !item.done && item.text === text)) {
          return {
            ok: true,
            result: `待办「${text}」已经存在，无需重复添加。\n\n${formatTodoList(list)}`,
            display: `✅ 待办已存在：${truncate(text, 24)}`,
          };
        }
        list.push({ text, done: false, createdAt: Date.now() });
        saveTodos(list);
        return {
          ok: true,
          result: `已添加待办「${text}」。\n\n${formatTodoList(list)}`,
          display: `✅ 已添加：${truncate(text, 24)}`,
        };
      }
      if (action === 'done') {
        if (!list.length) throw new Error('待办清单是空的，没有可完成的事项');
        const index = findTodoIndex(list, args.item);
        if (index < 0) throw new Error(`没有找到待办「${truncate(String(args.item == null ? '' : args.item), 40)}」`);
        const target = list[index];
        if (target.done) {
          return {
            ok: true,
            result: `待办「${target.text}」已经完成过了。\n\n${formatTodoList(list)}`,
            display: `✅ 已完成过：${truncate(target.text, 24)}`,
          };
        }
        target.done = true;
        saveTodos(list);
        return {
          ok: true,
          result: `已完成待办「${target.text}」。\n\n${formatTodoList(list)}`,
          display: `✅ 已完成：${truncate(target.text, 24)}`,
        };
      }
      if (action === 'clear') {
        const count = list.length;
        saveTodos([]);
        return {
          ok: true,
          result: count ? `已清空全部 ${count} 项待办。` : '待办清单本来就是空的。',
          display: count ? `✅ 已清空 ${count} 项待办` : '✅ 待办清单是空的',
        };
      }
      throw new Error(`不支持的操作「${action}」，可用：add / list / done / clear`);
    },
  },
  {
    id: 'dice',
    name: '骰子与随机',
    icon: '🎲',
    kind: 'tool',
    category: '娱乐',
    desc: '掷骰子、生成随机数，适合做决定或玩游戏',
    tools: [
      {
        type: 'function',
        function: {
          name: 'roll_dice',
          description: '掷骰子：可指定骰子面数与数量，返回每次点数与总和。',
          parameters: {
            type: 'object',
            properties: {
              sides: { type: 'integer', description: '骰子面数，默认 6，范围 2-1000' },
              count: { type: 'integer', description: '骰子数量，默认 1，范围 1-20' },
            },
            additionalProperties: false,
          },
        },
      },
    ],
    async handler(args) {
      const sides = clampInt(args.sides, 2, 1000, 6);
      const count = clampInt(args.count, 1, 20, 1);
      const rolls = Array.from({ length: count }, () => 1 + randomInt(sides));
      const total = rolls.reduce((sum, value) => sum + value, 0);
      const detail = count === 1 ? `${rolls[0]}` : `${rolls.join(' + ')} = ${total}`;
      return {
        ok: true,
        result: `掷骰结果：${count} 颗 ${sides} 面骰 → ${rolls.join(', ')}；合计 ${total}。（结果由浏览器本地随机生成）`,
        display: `🎲 ${detail}${count === 1 ? `（${sides} 面骰）` : ` · ${sides} 面骰`}`,
      };
    },
  },
  {
    id: 'random',
    name: '随机选择',
    icon: '🎯',
    kind: 'tool',
    category: '娱乐',
    desc: '从候选列表中随机抽取，帮你做选择',
    tools: [
      {
        type: 'function',
        function: {
          name: 'random_pick',
          description: '从用户给出的候选列表中随机抽取若干项（不重复）。用户在纠结选择时调用。',
          parameters: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { type: 'string' },
                description: '候选列表，例如 ["火锅", "烧烤", "日料"]；也可以传用逗号分隔的字符串',
              },
              count: { type: 'integer', description: '抽取数量，默认 1，不能超过候选数量' },
            },
            required: ['items'],
            additionalProperties: false,
          },
        },
      },
    ],
    async handler(args) {
      let items = args.items;
      if (typeof items === 'string') {
        items = items.split(/[,，、;；\n|]+/);
      }
      if (!Array.isArray(items)) throw new Error('items 需要是数组或用逗号分隔的文本');
      const pool = Array.from(new Set(items.map((item) => String(item == null ? '' : item).trim()).filter(Boolean)));
      if (!pool.length) throw new Error('候选列表不能为空');
      const count = clampInt(args.count, 1, pool.length, 1);
      const shuffled = pool.slice();
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const picked = shuffled.slice(0, count);
      return {
        ok: true,
        result: `从 [${pool.join('、')}] 中随机选中：${picked.join('、')}。（结果由浏览器本地随机生成，每次可能不同）`,
        display: `🎯 ${picked.join('、')}${count === 1 ? '' : `（共 ${count} 项）`}`,
      };
    },
  },
  {
    id: 'converter',
    name: '单位换算',
    icon: '📏',
    kind: 'tool',
    category: '效率',
    desc: '长度、重量、温度常用单位互换，含中文单位名',
    tools: [
      {
        type: 'function',
        function: {
          name: 'convert_units',
          description:
            '单位换算，支持长度（mm/cm/m/km/in/ft/yd/mi）、重量（mg/g/kg/t/oz/lb）与温度（摄氏度/华氏度/开尔文），支持中文单位名。',
          parameters: {
            type: 'object',
            properties: {
              value: { type: 'number', description: '要换算的数值，例如 100' },
              from: { type: 'string', description: '原单位，例如 cm、厘米、摄氏度' },
              to: { type: 'string', description: '目标单位，例如 m、米、华氏度' },
            },
            required: ['value', 'from', 'to'],
            additionalProperties: false,
          },
        },
      },
    ],
    async handler(args) {
      const value = Number(args.value);
      if (!Number.isFinite(value)) throw new Error('value 需要是有效数字');
      const from = UNIT_LOOKUP.get(normalizeUnitKey(args.from));
      const to = UNIT_LOOKUP.get(normalizeUnitKey(args.to));
      if (!from) throw new Error(`不支持的单位「${String(args.from == null ? '' : args.from)}」`);
      if (!to) throw new Error(`不支持的单位「${String(args.to == null ? '' : args.to)}」`);
      if (from.group !== to.group) {
        throw new Error(`不能跨类别换算：${from.label}（${UNIT_GROUPS[from.group].label}）与 ${to.label}（${UNIT_GROUPS[to.group].label}）`);
      }
      const result = convertUnitValue(value, from, to);
      const formatted = formatNumber(result);
      const fromLabel = UNIT_DISPLAY.get(`${from.group}:${from.key}`);
      const toLabel = UNIT_DISPLAY.get(`${to.group}:${to.key}`);
      return {
        ok: true,
        result: `${formatNumber(value)} ${fromLabel} = ${formatted} ${toLabel}（${UNIT_GROUPS[from.group].label}换算）`,
        display: `📏 ${formatNumber(value)} ${fromLabel} = ${formatted} ${toLabel}`,
      };
    },
  },
  {
    id: 'uuid',
    name: '密码与 UUID',
    icon: '🔐',
    kind: 'tool',
    category: '安全',
    desc: '本地生成随机密码或 UUID v4，不经过任何服务器',
    tools: [
      {
        type: 'function',
        function: {
          name: 'generate_secret',
          description: '在浏览器本地生成随机密码或 UUID v4。用户需要密码、随机字符串、UUID 时调用。',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['password', 'uuid'],
                description: '生成类型：password 随机密码，uuid UUID v4',
              },
              length: { type: 'integer', description: '密码长度，默认 16，范围 6-64（type=uuid 时忽略）' },
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
      },
    ],
    async handler(args) {
      const type = String(args.type == null ? '' : args.type).trim().toLowerCase();
      if (type === 'uuid') {
        const uuid = uuidV4();
        return {
          ok: true,
          result: `生成的 UUID v4：${uuid}（由浏览器本地生成）`,
          display: '🔐 已生成 UUID v4',
        };
      }
      if (type === 'password') {
        const length = clampInt(args.length, 6, 64, 16);
        const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+';
        let password = '';
        for (let i = 0; i < length; i += 1) {
          password += charset[randomInt(charset.length)];
        }
        return {
          ok: true,
          result: `生成的 ${length} 位随机密码：${password}（由浏览器本地生成，未上传任何服务器；重要账号建议使用专门密码管理器）`,
          display: `🔐 已生成 ${length} 位随机密码`,
        };
      }
      throw new Error('type 只能是 password 或 uuid');
    },
  },
  {
    id: 'search',
    name: '联网搜索',
    icon: '🔎',
    kind: 'tool',
    category: '信息',
    desc: '模拟联网检索（内置演示数据，不发起真实网络请求）',
    tools: [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description:
            '搜索互联网信息。注意：当前为内置演示数据，不会发起真实网络请求，回答时请明确告知用户这是演示结果。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词或问题' },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
      },
    ],
    async handler(args) {
      const query = truncate(String(args.query == null ? '' : args.query).trim(), 60);
      if (!query) throw new Error('请提供搜索关键词');
      const { results } = demoSearch(query);
      const lines = results.map((item, index) => `${index + 1}. ${item.title}\n   ${item.snippet}`);
      return {
        ok: true,
        result: [
          `【演示数据 · 未联网】关于「${query}」的搜索结果：`,
          ...lines,
          '说明：联网搜索插件目前是演示实现，不会发起真实网络请求。回答用户时请说明这是演示结果，不要把它当作真实信息。',
        ].join('\n'),
        display: `🔎 ${truncate(query, 20)} · ${results.length} 条演示结果`,
      };
    },
  },
  {
    id: 'translator',
    name: '翻译官',
    icon: '🌐',
    kind: 'prompt',
    category: '语言',
    desc: '中英互译并保留原文格式，代码与术语不翻译',
    prompt: [
      '你现在启用了「翻译官」插件技能：',
      '1. 自动判断语言方向：用户用中文时翻译成英文，用其他语言时翻译成简体中文；用户明确指定目标语言时按指定语言。',
      '2. 严格保留原文的段落、列表、表格、代码块与 Markdown 结构，代码、变量名、命令不翻译。',
      '3. 专有名词与术语保持前后一致；不确定的术语在译文后用括号保留原文。',
      '4. 只输出译文，不添加解释、总结或寒暄；用户同时提供了术语表时按术语表翻译。',
    ].join('\n'),
  },
  {
    id: 'weekly',
    name: '周报助手',
    icon: '📝',
    kind: 'prompt',
    category: '写作',
    desc: '把零散记录整理成结构化周报，量化产出与风险',
    prompt: [
      '你现在启用了「周报助手」插件技能：',
      '把用户提供的零散记录（聊天片段、提交记录、待办、会议要点）整理成结构化周报，使用 Markdown 与以下结构：',
      '1. 本周概览（2-3 句话总结）',
      '2. 关键产出（按项目分组，尽量量化结果）',
      '3. 进行中（当前进度与预计完成时间）',
      '4. 风险与阻塞（没有就写「暂无」）',
      '5. 下周计划（3-5 条可执行事项）',
      '信息不足时用「待补充」标注，不要编造数据、日期或人名。',
    ].join('\n'),
  },
  {
    id: 'reviewer',
    name: '代码审查员',
    icon: '🧐',
    kind: 'prompt',
    category: '开发',
    desc: '按安全、性能、可读性分级审查代码并给出修复建议',
    prompt: [
      '你现在启用了「代码审查员」插件技能：',
      '审查用户提供的代码，按以下顺序输出：',
      '1. 总体结论：能否合并、主要风险（1-2 句）。',
      '2. 问题清单：按「严重 / 重要 / 建议」分级，每条包含「位置 · 问题 · 影响 · 修复建议」，必要时给出修改后的代码片段。',
      '3. 审查维度：正确性与边界条件、安全（注入 / 越权 / 密钥泄露 / XSS）、性能（复杂度 / N+1 / 内存）、可读性与可维护性、错误处理。',
      '4. 若代码没有明显问题，请明确说明，并给出可选的优化点。',
      '只审查用户给出的代码，不要编造未提供的上下文。',
    ].join('\n'),
  },
];

const BUILTIN_BY_ID = new Map(BUILTIN_PLUGINS.map((plugin) => [plugin.id, plugin]));
const TOOL_INDEX = new Map();

for (const plugin of BUILTIN_PLUGINS) {
  for (const tool of plugin.tools || []) {
    const name = tool && tool.function && tool.function.name;
    if (!name) continue;
    if (TOOL_INDEX.has(name)) {
      // 开发期兜底：工具函数名必须全局唯一
      console.warn(`[jiuban] 工具函数名重复：${name}`);
      continue;
    }
    TOOL_INDEX.set(name, plugin);
  }
}

/* ==========================================================================
   状态与持久化
   ========================================================================== */

function emptyState() {
  return { version: CONFIG_VERSION, installed: {}, customs: [] };
}

function defaultState() {
  const state = emptyState();
  const now = Date.now();
  for (const id of DEFAULT_INSTALLED_IDS) {
    if (BUILTIN_BY_ID.has(id)) state.installed[id] = { enabled: true, installedAt: now };
  }
  return state;
}

function normalizeCustom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = truncate(String(raw.name == null ? '' : raw.name).trim(), MAX_NAME_LEN);
  const prompt = String(raw.prompt == null ? '' : raw.prompt).trim();
  if (!name || prompt.length < 10) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('custom'),
    name,
    icon: firstGrapheme(raw.icon, '🧩'),
    desc: truncate(String(raw.desc == null ? '' : raw.desc).trim(), MAX_DESC_LEN),
    prompt: truncate(prompt, MAX_PROMPT_LEN),
    category: truncate(String(raw.category == null ? '' : raw.category).trim(), MAX_CUSTOM_CATEGORY_LEN) || '自定义',
    kind: 'prompt',
    custom: true,
    enabled: raw.enabled !== false,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const state = emptyState();
  if (raw.installed && typeof raw.installed === 'object' && !Array.isArray(raw.installed)) {
    for (const [id, record] of Object.entries(raw.installed)) {
      if (!BUILTIN_BY_ID.has(id)) continue;
      state.installed[id] = {
        enabled: !record || record.enabled !== false,
        installedAt: Number(record && record.installedAt) || Date.now(),
      };
    }
  }
  if (Array.isArray(raw.customs)) {
    const seen = new Set();
    for (const item of raw.customs) {
      if (state.customs.length >= MAX_CUSTOM_PLUGINS) break;
      const custom = normalizeCustom(item);
      if (!custom) continue;
      if (seen.has(custom.id)) custom.id = uid('custom');
      seen.add(custom.id);
      state.customs.push(custom);
    }
  }
  return state;
}

function loadState() {
  if (!storage) return defaultState();
  let parsed = null;
  try {
    const raw =
      storage.getItem(PLUGINS_STORAGE_KEY) || storage.getItem(LEGACY_PLUGINS_STORAGE_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch (err) {
    parsed = null;
  }
  const normalized = normalizeState(parsed);
  if (normalized) return normalized;
  // 首次使用：写入默认安装状态，保证 localStorage 与运行时一致
  const initial = defaultState();
  try {
    storage.setItem(
      PLUGINS_STORAGE_KEY,
      JSON.stringify({ version: CONFIG_VERSION, installed: initial.installed, customs: initial.customs })
    );
  } catch (err) {
    /* 存储不可用时静默降级 */
  }
  return initial;
}

let state = loadState();

function persist() {
  if (!storage) return;
  try {
    storage.setItem(
      PLUGINS_STORAGE_KEY,
      JSON.stringify({
        version: CONFIG_VERSION,
        installed: state.installed,
        customs: state.customs,
      })
    );
  } catch (err) {
    /* 配额不足时静默降级为内存态 */
  }
}

/* ==========================================================================
   订阅
   ========================================================================== */

const listeners = new Set();

function findCustom(id) {
  return state.customs.find((item) => item.id === id) || null;
}

function isPluginInstalled(id) {
  if (typeof id !== 'string') return false;
  if (findCustom(id)) return true;
  return Boolean(state.installed[id]) && BUILTIN_BY_ID.has(id);
}

function isEnabled(id) {
  const custom = findCustom(id);
  if (custom) return custom.enabled !== false;
  const record = state.installed[id];
  if (!record || !BUILTIN_BY_ID.has(id)) return false;
  return record.enabled !== false;
}

function customToPlugin(custom) {
  return {
    id: custom.id,
    name: custom.name,
    icon: custom.icon,
    kind: 'prompt',
    category: custom.category,
    desc: custom.desc || '自定义提示词插件',
    prompt: custom.prompt,
    custom: true,
  };
}

function resolvePlugin(id) {
  const custom = findCustom(id);
  if (custom) return customToPlugin(custom);
  return BUILTIN_BY_ID.get(id) || null;
}

function getEnabledPlugins() {
  const result = [];
  for (const plugin of BUILTIN_PLUGINS) {
    if (isPluginInstalled(plugin.id) && isEnabled(plugin.id)) result.push(plugin);
  }
  for (const custom of state.customs) {
    if (custom.enabled !== false) result.push(customToPlugin(custom));
  }
  return result;
}

function toViewModel(plugin) {
  const installed = isPluginInstalled(plugin.id);
  return {
    id: plugin.id,
    name: plugin.name,
    icon: plugin.icon,
    desc: plugin.desc || '',
    category: plugin.category || '其他',
    kind: plugin.kind === 'tool' ? 'tool' : 'prompt',
    custom: Boolean(plugin.custom),
    enabled: installed ? isEnabled(plugin.id) : false,
    installed,
    prompt: plugin.prompt || '',
    tools: plugin.tools || [],
    toolNames: (plugin.tools || []).map((tool) => tool.function && tool.function.name).filter(Boolean),
  };
}

export function getSnapshot() {
  const installed = getInstalledViewModels();
  const enabled = installed.filter((item) => item.enabled);
  return {
    installedCount: installed.length,
    enabledCount: enabled.length,
    customCount: state.customs.length,
    toolCount: enabled.filter((item) => item.kind === 'tool').reduce((sum, item) => sum + item.toolNames.length, 0),
    promptCount: enabled.filter((item) => item.kind === 'prompt').length,
    enabledPluginIds: enabled.map((item) => item.id),
  };
}

function getInstalledViewModels() {
  const result = [];
  for (const plugin of BUILTIN_PLUGINS) {
    if (isPluginInstalled(plugin.id)) result.push(toViewModel(plugin));
  }
  for (const custom of state.customs) {
    result.push(toViewModel(customToPlugin(custom)));
  }
  return result;
}

function notifyChange() {
  const snapshot = getSnapshot();
  for (const fn of Array.from(listeners)) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error('[jiuban] 插件订阅回调出错', err);
    }
  }
  try {
    if (store && typeof store.emit === 'function') {
      store.emit('plugins:changed', snapshot);
    } else if (typeof storeEmit === 'function') {
      storeEmit('plugins:changed', snapshot);
    }
  } catch (err) {
    console.error('[jiuban] 广播 plugins:changed 失败', err);
  }
}

function normalizeToolResult(result) {
  const value = result && typeof result === 'object' ? result : {};
  const ok = value.ok !== false;
  const text = String(value.result == null ? '' : value.result);
  return {
    ok,
    result: truncate(text, MAX_TOOL_RESULT_LEN),
    display: truncate(String(value.display == null ? '' : value.display), 200),
  };
}

/* ==========================================================================
   自定义插件校验
   ========================================================================== */

function assertCustomInput(input, options = {}) {
  const { skipName = false } = options;
  const data = input && typeof input === 'object' ? input : {};
  if (!skipName) {
    const name = String(data.name == null ? '' : data.name).trim();
    if (!name) throw new Error('请填写插件名称');
    if (Array.from(name).length > MAX_NAME_LEN) throw new Error(`插件名称不能超过 ${MAX_NAME_LEN} 个字`);
    const duplicated = [...BUILTIN_PLUGINS, ...state.customs].some(
      (item) => item.name === name && item.id !== data.id
    );
    if (duplicated) throw new Error(`插件名称「${name}」已存在，换个名字吧`);
  }
  if (data.desc != null) {
    const desc = String(data.desc).trim();
    if (Array.from(desc).length > MAX_DESC_LEN) throw new Error(`描述不能超过 ${MAX_DESC_LEN} 个字`);
  }
  if (data.prompt != null) {
    const prompt = String(data.prompt).trim();
    if (Array.from(prompt).length < 10) throw new Error('提示词至少需要 10 个字，描述清楚希望 AI 扮演的角色');
    if (Array.from(prompt).length > MAX_PROMPT_LEN) throw new Error(`提示词不能超过 ${MAX_PROMPT_LEN} 个字`);
  }
}

/* ==========================================================================
   pluginManager
   ========================================================================== */

export const pluginManager = {
  /** 已安装插件（内置 + 自定义） */
  listInstalled() {
    return getInstalledViewModels();
  },

  /** 未安装的内置插件（插件市场） */
  listMarket() {
    return BUILTIN_PLUGINS.filter((plugin) => !isPluginInstalled(plugin.id)).map((plugin) =>
      toViewModel({ ...plugin, enabled: false })
    );
  },

  /** 查询单个插件（未知返回 null） */
  get(id) {
    const plugin = resolvePlugin(id);
    return plugin ? toViewModel(plugin) : null;
  },

  isInstalled(id) {
    return isPluginInstalled(id);
  },

  /** 安装内置插件，返回是否安装成功 */
  install(id) {
    if (!BUILTIN_BY_ID.has(id)) return false;
    if (isPluginInstalled(id)) return false;
    state.installed[id] = { enabled: true, installedAt: Date.now() };
    persist();
    notifyChange();
    return true;
  },

  /** 卸载插件（自定义插件会同时删除），返回是否成功 */
  uninstall(id) {
    if (findCustom(id)) return this.removeCustom(id);
    if (!isPluginInstalled(id)) return false;
    delete state.installed[id];
    persist();
    notifyChange();
    return true;
  },

  /** 启用 / 停用插件（未安装则返回 false） */
  setEnabled(id, enabled) {
    if (!isPluginInstalled(id)) return false;
    const next = Boolean(enabled);
    const custom = findCustom(id);
    if (custom) {
      custom.enabled = next;
      custom.updatedAt = Date.now();
    } else {
      state.installed[id].enabled = next;
    }
    persist();
    notifyChange();
    return true;
  },

  /** 切换启用状态，返回切换后的状态 */
  toggle(id) {
    if (!isPluginInstalled(id)) return false;
    const next = !isEnabled(id);
    this.setEnabled(id, next);
    return next;
  },

  /** 新增自定义提示词插件，校验失败时抛出带中文说明的 Error */
  addCustom({ name, icon, desc, prompt, category } = {}) {
    if (state.customs.length >= MAX_CUSTOM_PLUGINS) {
      throw new Error(`自定义插件最多 ${MAX_CUSTOM_PLUGINS} 个，请先删除一些`);
    }
    assertCustomInput({ name, desc, prompt });
    const now = Date.now();
    const custom = {
      id: uid('custom'),
      name: String(name).trim(),
      icon: firstGrapheme(icon, '🧩'),
      desc: truncate(String(desc == null ? '' : desc).trim(), MAX_DESC_LEN),
      prompt: truncate(String(prompt).trim(), MAX_PROMPT_LEN),
      category: truncate(String(category == null ? '' : category).trim(), MAX_CUSTOM_CATEGORY_LEN) || '自定义',
      kind: 'prompt',
      custom: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    state.customs.push(custom);
    persist();
    notifyChange();
    return toViewModel(customToPlugin(custom));
  },

  /** 更新自定义插件，返回更新后的插件对象；未找到返回 null */
  updateCustom(id, patch = {}) {
    const custom = findCustom(id);
    if (!custom) return null;
    const merged = {
      id: custom.id,
      name: patch.name !== undefined ? patch.name : custom.name,
      icon: patch.icon !== undefined ? patch.icon : custom.icon,
      desc: patch.desc !== undefined ? patch.desc : custom.desc,
      prompt: patch.prompt !== undefined ? patch.prompt : custom.prompt,
      category: patch.category !== undefined ? patch.category : custom.category,
    };
    assertCustomInput(merged);
    custom.name = String(merged.name).trim();
    custom.icon = firstGrapheme(merged.icon, '🧩');
    custom.desc = truncate(String(merged.desc == null ? '' : merged.desc).trim(), MAX_DESC_LEN);
    custom.prompt = truncate(String(merged.prompt).trim(), MAX_PROMPT_LEN);
    custom.category =
      truncate(String(merged.category == null ? '' : merged.category).trim(), MAX_CUSTOM_CATEGORY_LEN) || '自定义';
    custom.updatedAt = Date.now();
    persist();
    notifyChange();
    return toViewModel(customToPlugin(custom));
  },

  /** 删除自定义插件，返回是否成功 */
  removeCustom(id) {
    const index = state.customs.findIndex((item) => item.id === id);
    if (index < 0) return false;
    state.customs.splice(index, 1);
    persist();
    notifyChange();
    return true;
  },

  /** 已启用的工具类插件 → OpenAI function calling tools 数组 */
  getActiveToolSchemas() {
    const tools = [];
    for (const plugin of getEnabledPlugins()) {
      if (plugin.kind !== 'tool') continue;
      for (const tool of plugin.tools || []) {
        try {
          tools.push(JSON.parse(JSON.stringify(tool)));
        } catch (err) {
          /* 忽略不可序列化的 schema */
        }
      }
    }
    return tools;
  },

  /** 工具函数名 → 「🧮 计算器」 */
  getToolDisplayName(toolName) {
    const name = typeof toolName === 'string' ? toolName.trim() : '';
    if (!name) return '';
    const plugin = TOOL_INDEX.get(name);
    if (!plugin) return name;
    return `${plugin.icon} ${plugin.name}`;
  },

  /** 已启用的提示词类插件拼接成的系统提示词片段（无启用项时为空串） */
  getPromptAddons() {
    const parts = [];
    for (const plugin of getEnabledPlugins()) {
      if (plugin.kind !== 'prompt') continue;
      const prompt = String(plugin.prompt || '').trim();
      if (!prompt) continue;
      parts.push(`【插件技能 · ${plugin.name}】\n${prompt}`);
    }
    return parts.join('\n\n');
  },

  /** 执行工具调用，永不抛错 */
  async executeTool(toolName, args) {
    const name = typeof toolName === 'string' ? toolName.trim() : '';
    if (!name) return { ok: false, result: '工具调用失败：缺少工具名称', display: '' };
    const plugin = TOOL_INDEX.get(name);
    if (!plugin) return { ok: false, result: `工具调用失败：未知工具「${name}」`, display: '❓ 未知工具' };
    if (!isPluginInstalled(plugin.id)) {
      return {
        ok: false,
        result: `工具调用失败：插件「${plugin.name}」未安装，请先在「设置 → 开发人员选项」中安装并启用。`,
        display: `⚠️ ${plugin.name} 未安装`,
      };
    }
    if (!isEnabled(plugin.id)) {
      return {
        ok: false,
        result: `工具调用失败：插件「${plugin.name}」已关闭，请在「设置 → 开发人员选项」中启用后重试。`,
        display: `⚠️ ${plugin.name} 已关闭`,
      };
    }
    const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    try {
      const result = await plugin.handler(safeArgs);
      return normalizeToolResult(result);
    } catch (err) {
      return {
        ok: false,
        result: `工具执行失败：${err && err.message ? err.message : '未知错误'}`,
        display: '⚠️ 工具执行失败',
      };
    }
  },

  /** 订阅变更，返回取消函数 */
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** 导出配置（JSON 对象） */
  exportConfig() {
    const installed = {};
    for (const [id, record] of Object.entries(state.installed)) {
      installed[id] = { enabled: record.enabled !== false, installedAt: record.installedAt };
    }
    return {
      app: '久伴',
      type: 'jiuban-plugins',
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      installed,
      customs: state.customs.map((custom) => ({
        name: custom.name,
        icon: custom.icon,
        desc: custom.desc,
        prompt: custom.prompt,
        category: custom.category,
        enabled: custom.enabled !== false,
        createdAt: custom.createdAt,
      })),
    };
  },

  /** 导入配置（JSON 字符串或对象），返回 { ok, message, count } */
  importConfig(json) {
    try {
      let data = json;
      if (typeof data === 'string') data = JSON.parse(data);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { ok: false, message: '导入失败：JSON 格式不正确', count: 0 };
      }
      const payload = data.plugins && typeof data.plugins === 'object' ? data.plugins : data;
      let installedCount = 0;
      let customCount = 0;
      const installedRaw = payload.installed;
      if (Array.isArray(installedRaw)) {
        for (const item of installedRaw) {
          const id = typeof item === 'string' ? item : item && item.id;
          if (!BUILTIN_BY_ID.has(id)) continue;
          const enabled = item && typeof item === 'object' ? item.enabled !== false : true;
          state.installed[id] = { enabled, installedAt: Date.now() };
          installedCount += 1;
        }
      } else if (installedRaw && typeof installedRaw === 'object') {
        for (const [id, record] of Object.entries(installedRaw)) {
          if (!BUILTIN_BY_ID.has(id)) continue;
          state.installed[id] = {
            enabled: !record || record.enabled !== false,
            installedAt: Number(record && record.installedAt) || Date.now(),
          };
          installedCount += 1;
        }
      }
      if (Array.isArray(payload.customs)) {
        for (const item of payload.customs) {
          if (state.customs.length >= MAX_CUSTOM_PLUGINS) break;
          const custom = normalizeCustom(item);
          if (!custom) continue;
          if (state.customs.some((existing) => existing.name === custom.name)) continue;
          state.customs.push({ ...custom, id: uid('custom') });
          customCount += 1;
        }
      }
      const count = installedCount + customCount;
      if (!count) return { ok: false, message: '导入失败：没有可导入的插件配置', count: 0 };
      persist();
      notifyChange();
      return {
        ok: true,
        message: `导入成功：${installedCount} 个内置插件、${customCount} 个自定义插件`,
        count,
      };
    } catch (err) {
      const isJsonError = err instanceof SyntaxError || (err && err.name === 'SyntaxError');
      const detail = isJsonError
        ? 'JSON 格式不正确，请检查文件内容'
        : err && err.message
          ? err.message
          : 'JSON 格式不正确';
      return { ok: false, message: `导入失败：${detail}`, count: 0 };
    }
  },

  /** 恢复初始状态：清空自定义插件，恢复默认预装插件 */
  reset() {
    state = defaultState();
    persist();
    notifyChange();
  },

  /** 当前统计快照（供界面展示） */
  getSnapshot,
};

// 启动时落盘一次：兼容旧品牌 key 迁移，并保证新 key 已写入
persist();
loadTodos();

/* ==========================================================================
   兼容层：模块级函数导出
   聊天模块（chat.js）当前以 `pluginsApi.getActiveToolSchemas()` / `executeTool()`
   等模块级函数的形式调用插件运行时；这里提供等价别名，内部统一走 pluginManager，
   保证两种调用方式都可用。
   ========================================================================== */

export const listInstalled = () => pluginManager.listInstalled();
export const listMarket = () => pluginManager.listMarket();
export const get = (id) => pluginManager.get(id);
export const isInstalled = (id) => pluginManager.isInstalled(id);
export const install = (id) => pluginManager.install(id);
export const uninstall = (id) => pluginManager.uninstall(id);
export const setEnabled = (id, enabled) => pluginManager.setEnabled(id, enabled);
export const toggle = (id) => pluginManager.toggle(id);
export const subscribe = (fn) => pluginManager.subscribe(fn);
export const getActiveToolSchemas = () => pluginManager.getActiveToolSchemas();
export const getToolDisplayName = (toolName) => pluginManager.getToolDisplayName(toolName);
export const getPromptAddons = () => pluginManager.getPromptAddons();
export const executeTool = (toolName, args) => pluginManager.executeTool(toolName, args);
export const exportConfig = () => pluginManager.exportConfig();
export const importConfig = (json) => pluginManager.importConfig(json);
export const reset = () => pluginManager.reset();

/* 首次加载时若没有持久化记录，默认已安装状态会由 defaultState() 提供。 */
