/* ==========================================================================
   qqai · 工具函数
   DOM 辅助 / Markdown 渲染 / Toast / Modal / 图标 / 时间格式化
   ========================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 创建元素：el('div', { class, text, html, dataset, style, onClick }, children) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'value') node.value = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==========================================================================
   Markdown（安全子集）
   ========================================================================== */

const CODE_LANGS = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  json: 'JSON',
  python: 'Python',
  py: 'Python',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  text: 'Text',
  diff: 'Diff',
};

function inlineMd(str) {
  let out = str;
  // 行内代码
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
  // 粗体 / 斜体 / 删除线
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  // 链接（内容已经过 HTML 转义）
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // 裸链接
  out = out.replace(
    /(^|[\s(])(https?:\/\/[^\s<>"')]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>'
  );
  return out;
}

/**
 * 把 AI 输出的 Markdown 渲染成安全 HTML 字符串。
 * 支持：标题 / 段落 / 列表 / 引用 / 分割线 / 表格 / 围栏代码块 / 行内样式 / 链接
 */
export function renderMarkdown(text) {
  if (!text) return '';
  const source = String(text).replace(/\r\n?/g, '\n');
  const codeBlocks = [];
  let src = source.replace(/```([\w#+.-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.push({ lang: (lang || '').trim(), code }) - 1;
    return `\u0000CODEBLOCK${index}\u0000`;
  });
  src = escapeHtml(src);

  const lines = src.split('\n');
  const html = [];
  let paragraph = [];
  let listType = null;
  let quoteLines = [];
  let tableLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(inlineMd).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    html.push(`<blockquote>${quoteLines.map((l) => `<p>${inlineMd(l)}</p>`).join('')}</blockquote>`);
    quoteLines = [];
  };
  const flushTable = () => {
    if (tableLines.length < 2) {
      if (tableLines.length) paragraph.push(...tableLines);
      tableLines = [];
      return;
    }
    const rows = tableLines.map((line) =>
      line
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((cell) => cell.trim())
    );
    const header = rows[0];
    const body = rows.slice(2);
    const thead = `<thead><tr>${header.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${body
      .map((row) => `<tr>${row.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody>`;
    html.push(`<div class="md-table"><table>${thead}${tbody}</table></div>`);
    tableLines = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
    if (tableLines.length) flushTable();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // 代码块占位
    const codeMatch = trimmed.match(/^\u0000CODEBLOCK(\d+)\u0000$/);
    if (codeMatch) {
      flushAll();
      const block = codeBlocks[Number(codeMatch[1])];
      const lang = block.lang.toLowerCase();
      const label = CODE_LANGS[lang] || (block.lang ? block.lang.toUpperCase() : '代码');
      html.push(
        `<div class="md-code"><div class="md-code-head"><span class="md-code-lang">${escapeHtml(
          label
        )}</span><button type="button" class="md-copy" title="复制代码">${icon(
          'copy',
          13
        )}<span>复制</span></button></div><pre><code>${escapeHtml(block.code.replace(
          /\n$/,
          ''
        ))}</code></pre></div>`
      );
      continue;
    }

    // 表格
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      tableLines.push(line);
      continue;
    }
    if (tableLines.length) flushTable();

    // 空行
    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    // 标题
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length + 1, 6);
      html.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }

    // 分割线
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushAll();
      html.push('<hr>');
      continue;
    }

    // 引用
    const quote = trimmed.match(/^(?:>|&gt;)\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }
    if (quoteLines.length) flushQuote();

    // 列表
    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    const ol = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (ul || ol) {
      flushParagraph();
      const type = ul ? 'ul' : 'ol';
      if (listType && listType !== type) flushList();
      if (!listType) {
        listType = type;
        html.push(`<${type}>`);
      }
      html.push(`<li>${inlineMd(ul ? ul[1] : ol[2])}</li>`);
      continue;
    }
    if (listType) flushList();

    paragraph.push(trimmed);
  }
  flushAll();

  return html.join('');
}

/* ==========================================================================
   时间 / 通用格式化
   ========================================================================== */

const pad2 = (n) => String(n).padStart(2, '0');

export function formatTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

export function formatDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start - dayStart) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function relativeTime(ts) {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return formatTime(ts);
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const tsDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((dayStart - tsDay) / 86400000);
  if (dayDiff === 1) return '昨天';
  if (dayDiff === 2) return '前天';
  if (dayDiff < 7) return `${d.getMonth() + 1}/${d.getDate()}`;
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function debounce(fn, wait = 200) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function throttle(fn, wait = 120) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ==========================================================================
   Toast / 弹窗
   ========================================================================== */

const TOAST_ICONS = {
  success: '✅',
  error: '⚠️',
  warning: '⚠️',
  info: '💡',
};

export function toast(message, type = 'info', duration = 2600) {
  const root = document.getElementById('toast-root') || document.body;
  const node = el('div', { class: `toast toast-${type}`, role: 'status' }, [
    el('span', { class: 'toast-icon', text: TOAST_ICONS[type] || '💡' }),
    el('span', { class: 'toast-text', text: String(message == null ? '' : message) }),
  ]);
  root.append(node);
  setTimeout(() => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 220);
  }, duration);
  return node;
}

/**
 * 通用弹窗。返回 { close, el, body, footer }。
 * body / footer 可以是 HTML 字符串、Node 或 Node 数组。
 */
export function modal({ title, body = '', footer = null, wide = false, onClose = null } = {}) {
  const mask = el('div', { class: 'modal-mask' });
  const box = el('div', {
    class: `modal${wide ? ' modal-wide' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || '对话框',
  });
  const bodyWrap = el('div', { class: 'modal-body' });
  const footWrap = el('div', { class: 'modal-foot' });

  const appendContent = (wrap, content) => {
    const list = Array.isArray(content) ? content : [content];
    for (const item of list) {
      if (item == null) continue;
      if (item instanceof Node) wrap.append(item);
      else if (typeof item === 'string') wrap.insertAdjacentHTML('beforeend', item);
    }
  };

  appendContent(bodyWrap, body);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    mask.remove();
    if (typeof onClose === 'function') onClose();
  };

  const head = el('div', { class: 'modal-head' }, [
    el('div', { class: 'modal-title', text: title || '' }),
    el('button', { class: 'btn-icon', title: '关闭', 'aria-label': '关闭', onClick: close }, [
      el('span', { html: icon('x', 18) }),
    ]),
  ]);

  box.append(head, bodyWrap);
  if (footer) {
    appendContent(footWrap, footer);
    box.append(footWrap);
  }
  mask.append(box);

  const getFocusable = () =>
    Array.from(
      box.querySelectorAll(
        'a[href], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => node.offsetParent !== null || node === document.activeElement);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusable();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !box.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !box.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };
  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) close();
  });
  document.addEventListener('keydown', onKeyDown);

  (document.getElementById('modal-root') || document.body).append(mask);
  setTimeout(() => {
    const focusable = getFocusable();
    const preferred =
      focusable.find((node) => /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) ||
      focusable.find((node) => node.classList.contains('newchat-item')) ||
      focusable[0];
    if (preferred) preferred.focus();
  }, 30);

  return { close, el: box, body: bodyWrap, footer: footWrap };
}

export function confirmDialog({
  title = '确认操作',
  message = '确定要继续吗？',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = modal({
      title,
      body: el('div', { class: 'confirm-message', html: escapeHtml(message).replace(/\n/g, '<br>') }),
      footer: [
        el('button', { class: 'btn btn-ghost', onClick: () => { done(false); dialog.close(); } }, cancelText),
        el(
          'button',
          {
            class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
            onClick: () => { done(true); dialog.close(); },
          },
          confirmText
        ),
      ],
      onClose: () => done(false),
    });
  });
}

export function promptDialog({
  title = '请输入',
  label = '',
  placeholder = '',
  value = '',
  multiline = false,
  confirmText = '确定',
  validate = null,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const field = el(multiline ? 'textarea' : 'input', {
      class: multiline ? 'textarea' : 'input',
      placeholder,
      value,
      rows: multiline ? 4 : undefined,
    });
    const errorNode = el('div', { class: 'field-error', hidden: true });
    const body = el('div', {}, [
      label ? el('label', { class: 'label', text: label }) : null,
      field,
      errorNode,
    ]);
    const submit = () => {
      const text = field.value.trim();
      if (validate) {
        const result = validate(text);
        if (result !== true) {
          errorNode.hidden = false;
          errorNode.textContent = typeof result === 'string' ? result : '输入不合法';
          field.focus();
          return;
        }
      }
      done(text);
      dialog.close();
    };
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
      }
    });
    const dialog = modal({
      title,
      body,
      footer: [
        el('button', { class: 'btn btn-ghost', onClick: () => { done(null); dialog.close(); } }, '取消'),
        el('button', { class: 'btn btn-primary', onClick: submit }, confirmText),
      ],
      onClose: () => done(null),
    });
  });
}

export async function copyText(text) {
  const value = String(text == null ? '' : text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (err) {
    /* 降级 */
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch (err) {
    return false;
  }
}

export function download(filename, content, mime = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('没有选择文件'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/* ==========================================================================
   内联图标（Feather 风格，24×24，stroke=currentColor）
   ========================================================================== */

const ICON_PATHS = {
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9"/><path d="m16 5 3 3"/><path d="m19 2 3 3"/>',
  plug: '<path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v4h1.5a2.5 2.5 0 0 1 0 5H2v4a2 2 0 0 0 2 2h4v-1.5a2.5 2.5 0 0 1 5 0V22h4a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  warn: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  'alert-triangle': '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><path d="M10 14 21 3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  loader: '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  message: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L7 20"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  bot: '<rect x="3" y="8" width="18" height="12" rx="3"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="8" y2="18"/><line x1="12" y1="18" x2="12" y2="18"/><line x1="16" y1="18" x2="16" y2="18"/>',
  'cloud-sun': '<path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41"/><path d="M15.95 10.05a5.5 5.5 0 0 1 1.4 10.83H8a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 8.45-2.86z"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="8.5" cy="15.5" r="1"/>',
  'list-checks': '<path d="M3 6h11M3 12h11M3 18h11"/><path d="m17 5 2 2 4-4"/><path d="m17 11 2 2 4-4"/><path d="m17 17 2 2 4-4"/>',
  ruler: '<path d="M21.3 8.7 8.7 21.3a2.4 2.4 0 0 1-3.4 0L2.7 18.7a2.4 2.4 0 0 1 0-3.4L15.3 2.7a2.4 2.4 0 0 1 3.4 0l2.6 2.6a2.4 2.4 0 0 1 0 3.4z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>',
  'search-web': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6M11 8v6"/>',
  brush: '<path d="M9.06 11.9 2.5 18.5a2 2 0 1 0 3 3l6.6-6.56"/><path d="M14.5 3.5 20 9l-8 8-5.5-5.5z"/>',
  translate: '<path d="M4 5h7M7 3v2c0 4-2 7-5 9"/><path d="M6 8c1 2 3 4 5 5"/><path d="m13 21 4-10 4 10"/><path d="M14.5 18h5"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  wand: '<path d="m15 4 5 5L9 20H4v-5z"/><path d="m13 6 5 5"/><path d="M19 3v4M21 5h-4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  palette: '<circle cx="12" cy="12" r="10"/><circle cx="8" cy="9" r="1.2"/><circle cx="12" cy="7" r="1.2"/><circle cx="16" cy="9" r="1.2"/><circle cx="16" cy="14" r="1.2"/><circle cx="12" cy="17" r="1.2"/><circle cx="8" cy="14" r="1.2"/>',
  'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
};

export function icon(name, size = 18) {
  const paths = ICON_PATHS[name];
  if (!paths) return '';
  return `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
