/* ==========================================================================
   qqai · DeepSeek API 客户端
   - 浏览器端直连 DeepSeek（官方允许 CORS），或任意兼容 OpenAI 协议的 baseUrl
   - 流式 SSE 解析：delta.content / delta.reasoning_content / delta.tool_calls
   - 非流式兼容（settings.stream === false）
   - 所有错误统一为中文 message + err.code
   本模块加载时不会发起任何网络请求。
   ========================================================================== */

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';

export const DEEPSEEK_MODELS = [
  { id: 'deepseek-flash', label: 'DeepSeek-V4.1 Flash · 默认 · 通用对话' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek-V4 Pro · 更强推理' },
  { id: 'deepseek-chat', label: 'deepseek-chat（旧版兼容）' },
  { id: 'deepseek-reasoner', label: 'deepseek-reasoner（旧版兼容）' },
];

const ERROR_MESSAGES = {
  auth: 'API Key 无效或已失效，请检查后重新填写。',
  balance: 'DeepSeek 账户余额不足，请前往开放平台充值后再试。',
  rate_limit: '请求过于频繁，已触发限流，请稍后再试。',
  network: '无法连接到 DeepSeek 服务，请检查网络、代理或接口地址（浏览器跨域被拦截也会导致此问题）。',
  server: 'DeepSeek 服务暂时不可用，请稍后重试。',
  bad_request: '请求参数有误，请检查模型名称、消息格式或接口地址。',
  aborted: '请求已取消。',
  unknown: '请求失败，请稍后重试。',
};

const noop = () => {};

/* ==========================================================================
   基础工具
   ========================================================================== */

function createApiError(code, message, cause) {
  const error = new Error(message || ERROR_MESSAGES.unknown);
  error.code = code;
  error.name = code === 'aborted' ? 'AbortError' : 'ApiError';
  if (cause) error.cause = cause;
  return error;
}

function createAbortError() {
  return createApiError('aborted', ERROR_MESSAGES.aborted);
}

function isAbortLike(err, signal) {
  if (signal && signal.aborted) return true;
  if (!err) return false;
  return err.name === 'AbortError' || err.code === 'aborted';
}

/** 规范化 baseUrl：补协议、去尾部斜杠、容忍误粘贴的完整接口路径 */
function normalizeBaseUrl(raw) {
  let base = String(raw == null ? '' : raw).trim();
  if (!base) base = DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/i, '');
  base = base.replace(/\/models$/i, '');
  return base || DEFAULT_BASE_URL;
}

function buildUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function authHeaders(apiKey, withJsonBody = false) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (withJsonBody) headers['Content-Type'] = 'application/json';
  return headers;
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampNumber(value, min, max, fallback) {
  return Math.min(max, Math.max(min, toNumber(value, fallback)));
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
}

function extractModelIds(data) {
  if (!data) return [];
  const list = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : [];
  return list
    .map((item) => (typeof item === 'string' ? item : item && (item.id || item.name)))
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim());
}

/** 把 HTTP 状态码映射为契约里的 err.code */
function codeFromStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'balance';
  if (status === 429) return 'rate_limit';
  if (status === 408 || status === 502 || status === 503 || status === 504) return 'server';
  if (status >= 500) return 'server';
  if (status === 400 || status === 404 || status === 405 || status === 413 || status === 422) {
    return 'bad_request';
  }
  return 'unknown';
}

/** 读取失败响应并转换为中文 Error（不会把原始 body 写进 message，避免泄露敏感信息） */
async function errorFromResponse(response) {
  const status = Number(response && response.status) || 0;
  const code = codeFromStatus(status);
  let message = ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown;

  let withStatus = true;
  if (status === 404) {
    message = '接口地址不存在（HTTP 404），请检查 Base URL 是否填写正确。';
    withStatus = false;
  } else if (status === 405) {
    message = '该接口不支持当前请求方式（HTTP 405），请检查 Base URL 是否为兼容 OpenAI 协议的地址。';
    withStatus = false;
  }

  const detail = withStatus && status ? `（HTTP ${status}）` : '';
  const error = createApiError(code, `${message}${detail}`);
  error.status = status;
  return error;
}

/** GET /models 或补全接口返回 200 但 body 里带 error 的情况 */
function errorFromPayload(payload) {
  const raw = payload && (payload.error || payload);
  const text = String((raw && (raw.message || raw.msg || raw.type)) || '');
  let code = 'unknown';
  if (/authentication|invalid.*api.?key|unauthori[sz]ed|api.?key/i.test(text)) code = 'auth';
  else if (/insufficient|balance|quota/i.test(text)) code = 'balance';
  else if (/rate.?limit|too many requests/i.test(text)) code = 'rate_limit';
  else if (/model.*(not.*found|does not exist)|invalid.*model/i.test(text)) code = 'bad_request';
  return createApiError(code, ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown);
}

/* ==========================================================================
   连通性测试
   ========================================================================== */

/**
 * 测试 API Key / 网络 / 模型可用性（GET /models）。
 * @param {object} settings store.settings（至少含 apiKey / baseUrl / model）
 * @returns {Promise<{ok:boolean, message:string, code?:string, latency?:number, models?:string[]}>}
 */
export async function testConnection(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const apiKey = String(source.apiKey == null ? '' : source.apiKey).trim();
  if (!apiKey) {
    return {
      ok: false,
      code: 'auth',
      message: '还没有填写 API Key，请先在下方输入以 sk- 开头的密钥。',
    };
  }

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(buildUrl(source.baseUrl, '/models'), {
      method: 'GET',
      headers: authHeaders(apiKey),
      cache: 'no-store',
    });
  } catch (err) {
    return {
      ok: false,
      code: 'network',
      message: ERROR_MESSAGES.network,
      latency: Math.max(1, Date.now() - startedAt),
    };
  }

  const latency = Math.max(1, Date.now() - startedAt);

  // 少数兼容接口不提供 /models，退化为一次最小对话来验证 Key 是否可用
  if (response.status === 404 || response.status === 405) {
    return testViaCompletion(source, apiKey, latency);
  }

  if (!response.ok) {
    const error = await errorFromResponse(response);
    return { ok: false, code: error.code, message: error.message, latency };
  }

  const data = await safeJson(response);
  const models = extractModelIds(data);
  const currentModel = String(source.model || '').trim();

  if (!models.length) {
    return {
      ok: true,
      code: 'ok',
      message: `连接成功，延迟 ${latency}ms（该接口没有返回模型列表）`,
      latency,
      models: [],
    };
  }

  let note = '';
  if (currentModel && !models.includes(currentModel)) {
    note = `；当前模型 ${currentModel} 不在可用列表中`;
  }
  return {
    ok: true,
    code: 'ok',
    message: `连接成功，延迟 ${latency}ms，可用模型 ${models.length} 个${note}`,
    latency,
    models,
  };
}

/** 兼容只提供 /chat/completions 的代理：用最小请求验证 */
async function testViaCompletion(source, apiKey, modelsLatency) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(buildUrl(source.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: authHeaders(apiKey, true),
      body: JSON.stringify({
        model: String(source.model || 'deepseek-flash'),
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      code: 'network',
      message: ERROR_MESSAGES.network,
      latency: Math.max(1, Date.now() - startedAt),
    };
  }

  const latency = Math.max(1, Date.now() - startedAt);
  if (!response.ok) {
    const error = await errorFromResponse(response);
    return { ok: false, code: error.code, message: error.message, latency };
  }

  const data = await safeJson(response);
  if (data && data.error) {
    const error = errorFromPayload(data.error);
    return { ok: false, code: error.code, message: error.message, latency };
  }

  return {
    ok: true,
    code: 'ok',
    message: `连接成功，延迟 ${latency}ms（该接口未提供模型列表，已用一次最小对话验证）`,
    latency,
    models: [],
  };
}

/* ==========================================================================
   单次补全（流式 / 非流式）
   ========================================================================== */

/**
 * 单次补全。函数调用只返回 toolCalls，由调用方执行。
 * @param {object}   options
 * @param {object}   options.settings
 * @param {Array}    options.messages
 * @param {Array}    [options.tools]
 * @param {AbortSignal} [options.signal]
 * @param {(event: object) => void} [options.onEvent]  事件：reasoning / content / usage
 * @returns {Promise<{content:string, reasoning:string, toolCalls:Array, finishReason:string|null, usage:object|null}>}
 */
export async function streamCompletion({
  settings = {},
  messages = [],
  tools = [],
  signal,
  onEvent = noop,
} = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const apiKey = String(source.apiKey == null ? '' : source.apiKey).trim();
  if (!apiKey) {
    throw createApiError('auth', '还没有配置 DeepSeek API Key，请先到设置页填写。');
  }
  if (signal && signal.aborted) throw createAbortError();

  const useStream = source.stream !== false;
  const emit = (event) => {
    if (typeof onEvent !== 'function') return;
    try {
      onEvent(event);
    } catch (err) {
      // 回调出错不应中断流，但要在控制台留下记录（不含 Key）
      console.error('[jiuban] streamCompletion onEvent 回调出错', err);
    }
  };

  const body = {
    model: String(source.model || 'deepseek-flash'),
    messages: normalizeMessages(messages),
    temperature: clampNumber(source.temperature, 0, 2, 1),
    max_tokens: Math.round(clampNumber(source.maxTokens, 128, 8192, 8192)),
    stream: useStream,
  };
  const toolSchemas = Array.isArray(tools)
    ? tools.filter((tool) => tool && tool.type === 'function' && tool.function && tool.function.name)
    : [];
  if (toolSchemas.length) body.tools = toolSchemas;
  // 官方 DeepSeek 支持 stream_options 拿到 usage；自定义代理可能拒绝未知字段，故只在官网开启
  const baseForStream = normalizeBaseUrl(source.baseUrl).replace(/^https?:\/\//i, '');
  if (useStream && /(?:^|\.)deepseek\.com(?:\/|$)/i.test(baseForStream)) {
    body.stream_options = { include_usage: true };
  }

  let response;
  try {
    response = await fetch(buildUrl(source.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: authHeaders(apiKey, true),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbortLike(err, signal)) throw createAbortError();
    throw createApiError('network', ERROR_MESSAGES.network, err);
  }

  if (!response.ok) {
    const error = await errorFromResponse(response);
    throw error;
  }

  try {
    if (!useStream) return await consumeJsonResponse(response, emit);

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    // 部分兼容代理会忽略 stream 参数，直接返回 JSON
    if (contentType.includes('application/json')) {
      return await consumeJsonResponse(response, emit);
    }
    const streamBody = response.body;
    if (!streamBody || typeof streamBody.getReader !== 'function') {
      return await consumeJsonResponse(response, emit);
    }
    return await consumeSseStream(streamBody, emit, signal);
  } catch (err) {
    if (isAbortLike(err, signal)) throw createAbortError();
    if (err && err.code) throw err;
    throw createApiError('unknown', ERROR_MESSAGES.unknown, err);
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message === 'object' && message.role)
    .map((message) => {
      const out = {
        role: String(message.role),
        content: message.content == null ? '' : String(message.content),
      };
      if (message.tool_call_id) out.tool_call_id = String(message.tool_call_id);
      if (message.name) out.name = String(message.name);
      if (Array.isArray(message.tool_calls)) out.tool_calls = message.tool_calls;
      // DeepSeek 思考模式 + 工具调用时，官方要求把上一轮 assistant 的 reasoning_content 原样回传，否则 400
      if (typeof message.reasoning_content === 'string') {
        out.reasoning_content = message.reasoning_content;
      }
      return out;
    });
}

/* --------------------------------------------------------------------------
   非流式响应
   -------------------------------------------------------------------------- */

async function consumeJsonResponse(response, emit) {
  const data = await safeJson(response);
  if (!data) {
    throw createApiError('server', '服务返回的数据格式无法解析，请稍后重试。');
  }
  if (data.error) throw errorFromPayload(data.error);

  const choice = (Array.isArray(data.choices) && data.choices[0]) || {};
  const message = choice.message || {};
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoning =
    typeof message.reasoning_content === 'string' ? message.reasoning_content : '';

  if (reasoning) emit({ type: 'reasoning', text: reasoning });
  if (content) emit({ type: 'content', text: content });
  if (data.usage) emit({ type: 'usage', usage: data.usage });

  return {
    content,
    reasoning,
    toolCalls: normalizeToolCalls(message.tool_calls),
    finishReason: choice.finish_reason || null,
    usage: data.usage || null,
  };
}

function normalizeToolCalls(rawCalls) {
  if (!Array.isArray(rawCalls)) return [];
  return rawCalls
    .filter((call) => call && (call.function || call.name))
    .map((call, index) => {
      const fn = call.function || {};
      const args = fn.arguments;
      return {
        id: String(call.id || `tool_call_${index}`),
        name: String(fn.name || call.name || ''),
        arguments:
          typeof args === 'string' ? args : args == null ? '' : JSON.stringify(args),
      };
    })
    .filter((call) => call.name);
}

/* --------------------------------------------------------------------------
   SSE 流式响应
   -------------------------------------------------------------------------- */

function createAccumulator() {
  return {
    content: '',
    reasoning: '',
    toolCalls: [],
    finishReason: null,
    usage: null,
  };
}

function applyToolCallDeltas(accumulator, deltas) {
  if (!Array.isArray(deltas)) return;
  for (let position = 0; position < deltas.length; position += 1) {
    const delta = deltas[position];
    if (!delta || typeof delta !== 'object') continue;
    const index = Number.isInteger(delta.index) ? delta.index : accumulator.toolCalls.length;
    if (!accumulator.toolCalls[index]) {
      accumulator.toolCalls[index] = { id: '', name: '', arguments: '' };
    }
    const slot = accumulator.toolCalls[index];
    if (delta.id) slot.id = String(delta.id);
    const fn = delta.function || {};
    if (typeof fn.name === 'string' && fn.name) {
      // 名称通常只在首块出现；若代理重复下发同名块则去重，若拆分下发则拼接
      if (!slot.name) slot.name = fn.name;
      else if (slot.name !== fn.name) slot.name += fn.name;
    }
    if (typeof fn.arguments === 'string' && fn.arguments) slot.arguments += fn.arguments;
    else if (fn.arguments && typeof fn.arguments === 'object') slot.arguments += JSON.stringify(fn.arguments);
  }
}

function handleStreamPayload(accumulator, payload, emit) {
  if (!payload) return;
  if (payload.error) throw errorFromPayload(payload.error);

  if (payload.usage) {
    accumulator.usage = payload.usage;
    emit({ type: 'usage', usage: payload.usage });
  }

  const choice = Array.isArray(payload.choices) && payload.choices[0];
  if (!choice) return;
  const delta = choice.delta || choice.message || {};

  const reasoning = delta.reasoning_content;
  if (typeof reasoning === 'string' && reasoning) {
    accumulator.reasoning += reasoning;
    emit({ type: 'reasoning', text: reasoning });
  }

  const content = delta.content;
  if (typeof content === 'string' && content) {
    accumulator.content += content;
    emit({ type: 'content', text: content });
  }

  applyToolCallDeltas(accumulator, delta.tool_calls);

  if (choice.finish_reason) accumulator.finishReason = choice.finish_reason;
}

async function consumeSseStream(body, emit, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const accumulator = createAccumulator();
  let buffer = '';
  let dataLines = [];
  let sawDone = false;

  const dispatchData = () => {
    if (!dataLines.length) return false;
    const raw = dataLines.join('\n');
    dataLines = [];
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '[DONE]') return trimmed === '[DONE]';
    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch (err) {
      return false;
    }
    handleStreamPayload(accumulator, payload, emit);
    return false;
  };

  const processLine = (line) => {
    const cleaned = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!cleaned) {
      const done = dispatchData();
      return done;
    }
    if (cleaned.startsWith(':')) return false;
    if (cleaned.startsWith('data:')) {
      dataLines.push(cleaned.slice(5).replace(/^ /, ''));
    }
    return false;
  };

  try {
    while (!sawDone) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (processLine(line)) {
          sawDone = true;
          break;
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }

    if (!sawDone) {
      buffer += decoder.decode();
      if (buffer) {
        // 末尾可能没有换行
        const lines = buffer.split('\n');
        buffer = '';
        for (const line of lines) {
          if (processLine(line)) {
            sawDone = true;
            break;
          }
        }
      }
      dispatchData();
    }
  } finally {
    if (sawDone) {
      try {
        await reader.cancel();
      } catch (err) {
        /* 已经结束的流 cancel 失败可以忽略 */
      }
    }
    try {
      reader.releaseLock();
    } catch (err) {
      /* 忽略 */
    }
  }

  if (!accumulator.content && !accumulator.reasoning && !accumulator.toolCalls.length) {
    // 200 但没有任何有效内容：大概率是代理返回了错误说明或空流
    throw createApiError('unknown', '服务没有返回任何内容，请检查接口地址与模型名称后重试。');
  }

  return {
    content: accumulator.content,
    reasoning: accumulator.reasoning,
    toolCalls: accumulator.toolCalls
      .filter(Boolean)
      .map((slot, index) => ({
        id: slot.id || `tool_call_${index}`,
        name: slot.name,
        arguments: slot.arguments,
      }))
      .filter((call) => call.name),
    finishReason: accumulator.finishReason,
    usage: accumulator.usage,
  };
}
