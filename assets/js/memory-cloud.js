import { el } from './util.js';

const TYPES = {
  episode: { label: '经历', color: '#f0aa4d' },
  fact: { label: '事实', color: '#4b9ef0' },
  preference: { label: '偏好', color: '#a27ae8' },
  relation: { label: '关系', color: '#e47796' },
  goal: { label: '计划', color: '#39b987' },
  reflection: { label: '认知', color: '#51b8c6' },
};
const TYPE_ORDER = Object.keys(TYPES);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function dateText(memory) {
  const time = Number(memory.eventTime || memory.createdAt);
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '时间未知';
}

export function createMemoryCloud(initialRows = []) {
  const canvas = el('canvas', { class: 'memory-cloud-canvas', role: 'img', 'aria-label': '可交互的记忆点阵云图，点击点查看记忆详情' });
  const count = el('span', { class: 'memory-count memory-cloud-count' });
  const legend = el('div', { class: 'memory-cloud-legend' });
  const preview = el('div', { class: 'memory-cloud-preview' }, [el('span', { class: 'memory-cloud-preview-empty', text: '点击云图中的圆点查看记忆' })]);
  const plot = el('div', { class: 'memory-cloud-plot' }, [canvas]);
  const rows = [];
  let filter = 'all';
  let selectedId = null;
  let points = [];
  let query = '';
  const context = canvas.getContext('2d');

  function renderPreview(memory) {
    preview.replaceChildren();
    if (!memory) {
      preview.append(el('span', { class: 'memory-cloud-preview-empty', text: rows.length ? '没有匹配的记忆' : '添加记忆后，这里会出现点阵云图' }));
      return;
    }
    const type = TYPES[memory.kind] || { label: '记忆', color: '#4b9ef0' };
    preview.append(
      el('div', { class: 'memory-cloud-preview-meta' }, [
        el('span', { class: 'memory-type-tag', style: { '--memory-type-color': type.color }, text: type.label }),
        memory.status === 'past' ? el('span', { class: 'memory-cloud-history-tag', text: '历史记忆' }) : null,
        el('time', { text: dateText(memory) }),
      ]),
      el('p', { class: 'memory-cloud-preview-content', text: memory.content }),
      memory.tags?.length ? el('div', { class: 'memory-tags', text: memory.tags.map((tag) => `#${tag}`).join('  ') }) : null,
    );
  }

  function filteredRows() {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => (filter === 'all' || row.kind === filter)
      && (!normalizedQuery || `${row.content} ${(row.tags || []).join(' ')}`.toLowerCase().includes(normalizedQuery)));
  }

  function layoutPoints(visible, width, height) {
    const cols = width < 620 ? 2 : 3;
    const centers = new Map();
    const maxRows = Math.ceil(TYPE_ORDER.length / cols);
    const cellW = width / cols;
    const cellH = height / maxRows;
    TYPE_ORDER.forEach((kind, index) => {
      centers.set(kind, {
        x: cellW * (index % cols + 0.5),
        y: cellH * (Math.floor(index / cols) + 0.5),
      });
    });
    const grouped = new Map(TYPE_ORDER.map((kind) => [kind, []]));
    visible.forEach((row) => grouped.get(TYPES[row.kind] ? row.kind : 'fact').push(row));
    const spread = Math.max(18, Math.min(cellW * 0.32, cellH * 0.32));
    const laidOut = [];
    for (const kind of TYPE_ORDER) {
      const group = grouped.get(kind);
      group.sort((a, b) => hash(a.id) - hash(b.id));
      const center = centers.get(kind);
      group.forEach((row, index) => {
        const seed = hash(row.id);
        const angle = (index * 2.399963229728653) + ((seed % 1000) / 1000) * Math.PI * 2;
        const radius = spread * Math.sqrt((index + 0.5) / Math.max(1, group.length)) * (0.72 + (seed % 35) / 100);
        const pointRadius = 3 + clamp(Number(row.importance ?? 0.5), 0, 1) * 3.8;
        const edge = Math.min(16, pointRadius + 8);
        laidOut.push({
          row,
          x: clamp(center.x + Math.cos(angle) * radius, edge, Math.max(edge, width - edge)),
          y: clamp(center.y + Math.sin(angle) * radius, edge, Math.max(edge, height - edge)),
          r: pointRadius,
          color: TYPES[kind].color,
        });
      });
    }
    return laidOut;
  }

  function paint() {
    const width = Math.max(0, plot.clientWidth);
    const height = Math.max(0, plot.clientHeight);
    if (!width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    points = layoutPoints(filteredRows(), width, height);

    // 只画有共同标签的轻量连线，让相关记忆自然聚成小簇。
    const tagOwners = new Map();
    const edges = new Set();
    for (const point of points) {
      for (const tag of point.row.tags || []) {
        const key = String(tag).trim().toLowerCase();
        if (!key) continue;
        const prior = tagOwners.get(key) || [];
        for (const other of prior.slice(-2)) edges.add(`${other.id}|${point.row.id}`);
        prior.push(point.row);
        tagOwners.set(key, prior);
      }
    }
    const byId = new Map(points.map((point) => [point.row.id, point]));
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(106, 134, 179, 0.16)';
    for (const edge of edges) {
      const [left, right] = edge.split('|');
      const a = byId.get(left);
      const b = byId.get(right);
      if (!a || !b) continue;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }

    const labelRows = width < 620 ? 3 : 2;
    const cols = width < 620 ? 2 : 3;
    const cellW = width / cols;
    const cellH = height / labelRows;
    context.textAlign = 'center';
    context.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif';
    TYPE_ORDER.forEach((kind, index) => {
      const centerX = cellW * (index % cols + 0.5);
      const centerY = cellH * (Math.floor(index / cols) + 0.5);
      const typeCount = points.filter((point) => point.row.kind === kind).length;
      context.fillStyle = 'rgba(95, 108, 132, 0.64)';
      context.fillText(`${TYPES[kind].label} · ${typeCount}`, centerX, centerY - cellH * 0.4);
    });

    for (const point of points) {
      const selected = point.row.id === selectedId;
      if (selected) {
        context.beginPath();
        context.arc(point.x, point.y, point.r + 7, 0, Math.PI * 2);
        context.fillStyle = `${point.color}22`;
        context.fill();
        context.strokeStyle = `${point.color}99`;
        context.lineWidth = 1;
        context.stroke();
      }
      context.beginPath();
      context.arc(point.x, point.y, selected ? point.r + 1 : point.r, 0, Math.PI * 2);
      context.fillStyle = point.color;
      context.globalAlpha = selected ? 1 : point.row.status === 'past' ? 0.34 : 0.78;
      context.shadowColor = `${point.color}88`;
      context.shadowBlur = selected ? 13 : 5;
      context.fill();
      context.shadowBlur = 0;
      context.globalAlpha = 1;
    }
    count.textContent = `${points.length} 个点`;
    const selected = points.find((point) => point.row.id === selectedId)?.row || points[0]?.row || null;
    if (!selected || selected.id !== selectedId) selectedId = selected?.id || null;
    renderPreview(selected);
  }

  function setFilter(value) {
    filter = value;
    legend.querySelectorAll('button').forEach((button) => button.classList.toggle('is-active', button.dataset.kind === filter));
    paint();
  }

  const allButton = el('button', { class: 'memory-cloud-filter is-active', type: 'button', dataset: { kind: 'all' }, text: '全部', onClick: () => setFilter('all') });
  legend.append(allButton);
  for (const kind of TYPE_ORDER) {
    legend.append(el('button', { class: 'memory-cloud-filter', type: 'button', dataset: { kind }, onClick: () => setFilter(kind) }, [
      el('i', { style: { background: TYPES[kind].color } }), TYPES[kind].label,
    ]));
  }

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = points.map((point) => ({ point, distance: Math.hypot(point.x - x, point.y - y) }))
      .filter((item) => item.distance <= Math.max(12, item.point.r + 6))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest) {
      selectedId = nearest.point.row.id;
      paint();
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    canvas.style.cursor = points.some((point) => Math.hypot(point.x - x, point.y - y) <= Math.max(11, point.r + 5)) ? 'pointer' : 'default';
  });

  const resizeObserver = new ResizeObserver(() => requestAnimationFrame(paint));
  resizeObserver.observe(plot);

  function update(nextRows = initialRows, nextQuery = '') {
    rows.splice(0, rows.length, ...nextRows.filter((row) => row.status !== 'deleted'));
    query = nextQuery;
    paint();
  }

  const element = el('section', { class: 'card memory-card memory-cloud-card' }, [
    el('div', { class: 'memory-card-heading' }, [el('div', {}, [
      el('h2', { text: '记忆点阵云图' }),
      el('p', { text: '每个圆点代表一条记忆；颜色区分类型，大小代表重要程度，点按可查看内容。' }),
    ]), count]),
    el('div', { class: 'memory-cloud-tools' }, [legend]),
    el('div', { class: 'memory-cloud-layout' }, [plot, preview]),
  ]);

  update(initialRows);
  return { element, update, dispose: () => resizeObserver.disconnect() };
}
