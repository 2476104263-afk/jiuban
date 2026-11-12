import { streamCompletion } from './api.js';
import { addManualMemory, COMPANION_MEMORY_SCOPE, reviseMemory, searchMemories } from './memory.js?v=1.9.9';
import { store } from './store.js';
import { getUserProfile } from './user-profile.js';
import { el, toast, confirmDialog } from './util.js';

const REVIEW_KEY = 'jiuban.decision-reviews.v1';
const KIND_LABELS = { episode: '经历', fact: '事实', preference: '偏好', relation: '关系', goal: '计划', reflection: '复盘' };

function readReviews() {
  try {
    const value = JSON.parse(localStorage.getItem(REVIEW_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item) => item && item.id && item.question) : [];
  } catch { return []; }
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateLabel(value) {
  const time = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }) : '时间未记录';
}

function makeId() {
  return `review_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function textList(values, fallback) {
  const rows = Array.isArray(values) ? values.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6) : [];
  return rows.length ? rows : [fallback];
}

function parseResponse(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回可读取的分支结构。');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function localDemoBranches(options, snapshot) {
  const evidence = snapshot[0] || null;
  const firstStep = (choice) => ({
    title: '回看相关经历',
    scenario: evidence
      ? `历史记录是：“${evidence.content}”。把它作为考虑条件，检查它与“${choice}”的相同点和差异；这条经历本身不能决定结果。`
      : `先列出“${choice}”需要的时间、资源和可求助的人，再选择一个可检查的小目标。`,
    assumption: evidence ? '这条历史记录与当前问题相关，仍值得作为背景参考。' : '你能在近期开始执行，并愿意根据反馈调整。',
    supportIds: evidence ? [evidence.id] : [],
  });
  return [
    {
      id: 'A', choice: options.a,
      premise: `假设你选择“${options.a}”，并按当前描述投入时间和精力。`,
      steps: [
        firstStep(options.a),
        { title: '阶段复盘', scenario: '把实际进展与原计划对照，记录哪些条件发生了变化。', assumption: '你会记录过程中的关键事实，而不只记录最终结果。', supportIds: [] },
      ],
      risks: ['投入时间可能挤压其他安排。'],
      uncertainties: ['执行过程中的外部支持和实际工作量尚不清楚。'],
    },
    {
      id: 'B', choice: options.b,
      premise: `假设你选择“${options.b}”，并按当前描述投入时间和精力。`,
      steps: [
        firstStep(options.b),
        { title: '阶段复盘', scenario: '把实际进展与原计划对照，记录哪些条件发生了变化。', assumption: '你会记录过程中的关键事实，而不只记录最终结果。', supportIds: [] },
      ],
      risks: ['新方案的适配成本可能高于预期。'],
      uncertainties: ['尚未验证该选择是否符合当前资源和时间限制。'],
    },
  ];
}

function normalizeBranches(raw, options, snapshot) {
  const allowed = new Set(snapshot.map((item) => item.id));
  const input = Array.isArray(raw?.branches) ? raw.branches : [];
  return ['A', 'B'].map((id, index) => {
    const matched = input.find((item) => item && String(item.id || item.option || '').toUpperCase() === id);
    const source = matched || (input[index] && typeof input[index] === 'object' ? input[index] : {});
    const steps = (Array.isArray(source.steps) ? source.steps : []).slice(0, 4).map((rawStep, stepIndex) => {
      const step = rawStep && typeof rawStep === 'object' ? rawStep : {};
      return {
      title: String(step.title || `阶段 ${stepIndex + 1}`).slice(0, 80),
      scenario: String(step.scenario || step.possibility || '模型未提供该阶段的情景描述。').slice(0, 700),
      assumption: String(step.assumption || '依据当前输入作出的条件假设；实际情况可能不同。').slice(0, 300),
      supportIds: (Array.isArray(step.supportIds) ? step.supportIds : []).map(String).filter((memoryId) => allowed.has(memoryId)).slice(0, 6),
      };
    });
    return {
      id,
      choice: options[id.toLowerCase()],
      premise: String(source.premise || `假设你选择“${options[id.toLowerCase()]}”。`).slice(0, 500),
      steps: steps.length ? steps : localDemoBranches(options, snapshot)[index].steps,
      risks: textList(source.risks, '主要风险尚未充分评估。'),
      uncertainties: textList(source.uncertainties, '未来资源、执行成本和外部变化仍不确定。'),
    };
  });
}

async function generateBranches(question, options, profile, snapshot) {
  if (!store.settings.apiKey) return { branches: localDemoBranches(options, snapshot), mode: 'local-demo', summary: '当前为本地演示路径，展示同一份记忆快照下的分支结构。' };
  const memoryEvidence = snapshot.map((item) => ({
    id: item.id,
    kind: item.kind,
    content: item.content,
    eventTime: item.eventTime ? new Date(item.eventTime).toISOString().slice(0, 10) : null,
    validFrom: item.validFrom ? new Date(item.validFrom).toISOString().slice(0, 10) : null,
    validUntil: item.validUntil ? new Date(item.validUntil).toISOString().slice(0, 10) : null,
    source: item.source,
    evidenceQuote: item.evidenceQuote || '',
  }));
  const result = await streamCompletion({
    settings: { ...store.settings, stream: false, temperature: 0.45, maxTokens: 2600 },
    messages: [
      {
        role: 'system',
        content: [
          '你为个人决策复盘生成条件化情景假设，不预测未来，不声称存在真实因果模型。',
          '两条分支必须共享同一个用户档案、全部历史记忆和背景假设。唯一变化是用户选择 A 或选择 B。不要给两条分支虚构不同性格。',
          '每条路径含 2 到 4 个阶段节点。每个节点列出 scenario、assumption 和 supportIds；supportIds 只能使用输入中的记忆 id。没有历史记忆支持的节点应留空，不要臆造引用。',
          '每条分支还需列出 risks 和 uncertainties。把推演写成“如果选择并且条件成立，可能出现……”的情景，不要把假设写成事实。',
          '只返回 JSON，不要 Markdown：{"summary":"...","branches":[{"id":"A","premise":"...","steps":[{"title":"...","scenario":"...","assumption":"...","supportIds":["memory-id"]}],"risks":["..."],"uncertainties":["..."]},{"id":"B","premise":"...","steps":[],"risks":[],"uncertainties":[]}]}。',
        ].join('\n'),
      },
      { role: 'user', content: JSON.stringify({ question, options, fixedProfile: profile, fixedMemorySnapshot: memoryEvidence }) },
    ],
  });
  const parsed = parseResponse(result.content);
  return { branches: normalizeBranches(parsed, options, snapshot), mode: 'model', summary: String(parsed.summary || '以下路径是基于当前记忆快照生成的条件化情景假设。').slice(0, 400) };
}

export async function mountDecisionView(container) {
  let reviews = readReviews();
  let activeReview = null;
  let busy = false;

  const question = el('textarea', { class: 'input decision-input', rows: 3, maxlength: 800, placeholder: '例如：这学期是优先准备挑战杯，还是先完成课程项目？' });
  const optionA = el('input', { class: 'input decision-option', type: 'text', maxlength: 120, placeholder: '选择 A，例如：优先准备挑战杯' });
  const optionB = el('input', { class: 'input decision-option', type: 'text', maxlength: 120, placeholder: '选择 B，例如：先完成课程项目' });
  const createButton = el('button', { class: 'btn btn-primary', type: 'button', text: '生成分支推演' });
  const createStatus = el('p', { class: 'decision-form-status', text: '将固定当前个人资料和检索到的记忆，只比较 A / B 两个选择。' });
  const resultRoot = el('div', { class: 'decision-result-root' });
  const savedList = el('div', { class: 'decision-saved-list' });
  const savedCount = el('span', { class: 'decision-step-label', text: `${reviews.length} 条记录` });
  const formCard = el('section', { class: 'card decision-form-card' }, [
    el('div', { class: 'decision-section-heading' }, [
      el('div', {}, [el('h2', { text: '描述一个正在面对的选择' }), el('p', { text: '两条路径使用同一份记忆快照，只有选择条件不同。' })]),
      el('span', { class: 'decision-step-label', text: '01 · 输入' }),
    ]),
    el('label', { class: 'decision-field' }, [el('span', { text: '决策问题' }), question]),
    el('div', { class: 'decision-option-grid' }, [
      el('label', { class: 'decision-field' }, [el('span', { class: 'decision-option-label is-a', text: '选择 A' }), optionA]),
      el('label', { class: 'decision-field' }, [el('span', { class: 'decision-option-label is-b', text: '选择 B' }), optionB]),
    ]),
    el('div', { class: 'decision-form-footer' }, [createStatus, createButton]),
  ]);

  function persistReviews() {
    try {
      localStorage.setItem(REVIEW_KEY, JSON.stringify(reviews.slice(0, 30)));
      return true;
    } catch (error) {
      toast('保存复盘失败，浏览器本地存储空间可能不足。', 'error');
      return false;
    }
  }

  function evidenceCard(memory) {
    return el('article', { class: 'decision-evidence-card' }, [
      el('div', { class: 'decision-evidence-meta' }, [
        el('span', { class: 'decision-memory-kind', text: KIND_LABELS[memory.kind] || '记忆' }),
        el('span', { text: dateLabel(memory.eventTime || memory.createdAt) }),
      ]),
      el('p', { class: 'decision-evidence-content', text: memory.content }),
      memory.evidenceQuote ? el('blockquote', { class: 'decision-evidence-quote', text: `原始记录：“${memory.evidenceQuote}”` }) : null,
      el('p', { class: 'decision-evidence-source', text: `来源：${memory.source || '本地记忆'}${memory.validUntil ? ` · 有效至 ${dateLabel(memory.validUntil)}` : ''}` }),
    ]);
  }

  function branchCard(review, branch) {
    const evidenceById = new Map((review.memorySnapshot || []).map((item) => [item.id, item]));
    const steps = branch.steps.map((step, index) => {
      const citations = step.supportIds.map((id) => evidenceById.get(id)).filter(Boolean);
      return el('article', { class: 'decision-node' }, [
        el('div', { class: 'decision-node-marker', text: String(index + 1).padStart(2, '0') }),
        el('div', { class: 'decision-node-body' }, [
          el('h4', { text: step.title }),
          el('p', { class: 'decision-node-scenario', text: step.scenario }),
          el('p', { class: 'decision-node-assumption' }, [el('strong', { text: '假设' }), ` ${step.assumption}`]),
          el('div', { class: 'decision-node-citations' }, [
            el('strong', { text: '引用记忆' }),
            citations.length ? citations.map((memory) => el('div', { class: 'decision-node-citation' }, [
              el('span', { text: `“${memory.content}”` }),
              el('small', { text: `${KIND_LABELS[memory.kind] || '记忆'} · ${dateLabel(memory.eventTime || memory.createdAt)}` }),
            ])) : el('span', { class: 'decision-no-citation', text: '此节点没有可追溯的历史记忆引用。' }),
          ]),
        ]),
      ]);
    });
    return el('article', { class: `decision-branch-card is-${branch.id.toLowerCase()}` }, [
      el('header', { class: 'decision-branch-heading' }, [
        el('span', { class: 'decision-branch-badge', text: branch.id }),
        el('div', {}, [el('h3', { text: branch.choice }), el('p', { text: branch.premise })]),
      ]),
      el('div', { class: 'decision-node-list' }, steps),
      el('div', { class: 'decision-branch-notes' }, [
        el('section', {}, [el('h4', { text: '可能风险' }), el('ul', {}, branch.risks.map((item) => el('li', { text: item })))]),
        el('section', {}, [el('h4', { text: '不确定因素' }), el('ul', {}, branch.uncertainties.map((item) => el('li', { text: item })))]),
      ]),
    ]);
  }

  function openReview(review) {
    activeReview = review;
    renderReview();
    resultRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderReview() {
    resultRoot.replaceChildren();
    if (!activeReview) return;
    const review = activeReview;
    const modeLabel = review.generationMode === 'model' ? '模型生成' : '本地演示';
    const outcomeDate = el('input', { class: 'input decision-date', type: 'date', value: review.outcome?.date || localDate(), 'aria-label': '实际结果日期' });
    const outcomeText = el('textarea', { class: 'input decision-outcome-input', rows: 4, maxlength: 420, placeholder: '记录实际发生的结果、执行情况或重要变化。只写你确认的内容。', value: review.outcome?.text || '' });
    const correctionSelect = el('select', { class: 'input decision-correction-select', 'aria-label': '选择需要修正的旧记忆' }, [
      el('option', { value: '', text: '不修正旧记忆，只新增复盘结果' }),
      ...(review.memorySnapshot || []).map((memory) => el('option', { value: memory.id, text: `${KIND_LABELS[memory.kind] || '记忆'} · ${memory.content.slice(0, 72)}` })),
    ]);
    const correctionText = el('textarea', { class: 'input decision-correction-input', rows: 2, maxlength: 600, placeholder: '如果所选记忆已过时，请填写经你确认的修正内容。留空时请不要选择旧记忆。' });
    const resultStatus = el('p', { class: 'decision-form-status', text: review.outcome ? `已记录实际结果 · ${dateLabel(review.outcome.date)}` : '推演只是条件情景；实际发生后可在这里补充并修订记忆。' });
    const saveOutcomeButton = el('button', { class: 'btn btn-soft', type: 'button', text: '保存实际结果' });
    const confirmOutcomeButton = el('button', { class: 'btn btn-primary', type: 'button', text: '确认结果并更新记忆' });

    saveOutcomeButton.addEventListener('click', () => {
      if (!outcomeText.value.trim()) return toast('先填写实际结果。', 'warning');
      review.outcome = { date: outcomeDate.value || localDate(), text: outcomeText.value.trim(), savedAt: Date.now(), memoryUpdated: false };
      activeReview = review;
      const saved = persistReviews();
      resultStatus.textContent = `已保存实际结果 · ${dateLabel(review.outcome.date)}；尚未修改长期记忆。`;
      if (saved) toast('实际结果已保存，长期记忆尚未修改。', 'success');
      renderSavedList();
    });

    confirmOutcomeButton.addEventListener('click', async () => {
      const outcome = outcomeText.value.trim();
      if (!outcome) return toast('先填写你确认的实际结果。', 'warning');
      if (busy) return;
      const selected = (review.memorySnapshot || []).find((item) => item.id === correctionSelect.value);
      const correction = correctionText.value.trim();
      if (selected && !correction) return toast('填写修正后的事实，或改为“不修正旧记忆”。', 'warning');
      const yes = await confirmDialog({
        title: '把实际结果写入长期记忆？',
        message: selected ? '这会新增一条复盘记忆，并将所选旧记忆标记为过去事实，保存你填写的修正版本。' : '这会把你填写的结果保存为一条明确确认的复盘记忆。',
        confirmText: '确认并更新',
      });
      if (!yes) return;
      busy = true;
      confirmOutcomeButton.disabled = true;
      confirmOutcomeButton.textContent = '正在更新记忆…';
      try {
        const outcomeTime = Date.parse(`${outcomeDate.value || localDate()}T12:00:00`) || Date.now();
        await addManualMemory(COMPANION_MEMORY_SCOPE, {
          content: `决策复盘：${review.question.slice(0, 72)}。实际结果：${outcome}`,
          kind: 'reflection',
          tags: ['决策复盘', review.id],
          mapKey: `decision-review:${review.id}`,
          importance: 0.72,
          confidence: 1,
          basis: 'explicit',
          triggerType: 'decision_review',
          source: 'user-confirmed-review',
          eventTime: outcomeTime,
          validFrom: outcomeTime,
          evidenceQuote: outcome,
          confirmedAt: Date.now(),
        });
        if (selected) {
          const effectiveAt = Date.parse(`${outcomeDate.value || localDate()}T00:00:00`) || Date.now();
          await reviseMemory(selected.id, {
            content: correction,
            eventTime: effectiveAt,
            validFrom: effectiveAt,
            source: 'user-confirmed-review-correction',
            triggerType: 'decision_review',
            evidenceQuote: correction,
          });
        }
        review.outcome = { date: outcomeDate.value || localDate(), text: outcome, savedAt: Date.now(), memoryUpdated: true, correctedMemoryId: selected?.id || null };
        activeReview = review;
        const saved = persistReviews();
        resultStatus.textContent = selected ? '实际结果已确认；复盘记录已写入，旧记忆已归档并保存修正内容。' : '实际结果已确认，并新增到长期记忆。';
        if (saved) toast(selected ? '复盘结果与记忆修正已保存' : '复盘结果已加入长期记忆', 'success');
        renderSavedList();
      } catch (error) {
        toast(`更新记忆失败：${error.message}`, 'error');
      } finally {
        busy = false;
        confirmOutcomeButton.disabled = false;
        confirmOutcomeButton.textContent = '确认结果并更新记忆';
      }
    });

    const evidence = (review.memorySnapshot || []).length
      ? el('div', { class: 'decision-evidence-grid' }, review.memorySnapshot.map(evidenceCard))
      : el('p', { class: 'decision-empty-evidence', text: '本次没有召回相关记忆；路径仅依据你输入的选择和显式假设生成。' });

    resultRoot.append(el('section', { class: 'card decision-output-card' }, [
      el('div', { class: 'decision-section-heading' }, [
        el('div', {}, [el('h2', { text: review.question }), el('p', { text: `${modeLabel} · ${dateLabel(review.createdAt)} · 条件化情景假设，不是未来预测` })]),
        el('span', { class: 'decision-step-label', text: '02 · 分支' }),
      ]),
      el('p', { class: 'decision-summary', text: review.summary || '两条路径固定同一份个人资料和记忆快照，只改变选择条件。' }),
      el('div', { class: 'decision-graph-header' }, [
        el('div', { class: 'decision-root-node' }, [el('span', { text: '决策问题' }), el('strong', { text: review.question })]),
        el('div', { class: 'decision-graph-fork', 'aria-hidden': 'true' }, [el('span'), el('i'), el('span')]),
      ]),
      el('div', { class: 'decision-branch-grid' }, (review.branches || []).map((branch) => branchCard(review, branch))),
      el('section', { class: 'decision-evidence-section' }, [
        el('div', { class: 'decision-section-heading' }, [el('div', {}, [el('h3', { text: '本次固定的历史记忆快照' }), el('p', { text: '推演生成后保存快照，引用可回到原记忆来源。' })])]),
        evidence,
      ]),
      el('section', { class: 'decision-outcome-section' }, [
        el('div', { class: 'decision-section-heading' }, [el('div', {}, [el('h3', { text: '真实结果复盘' }), el('p', { text: '确认结果后可新增复盘记忆；修正旧事实需要选择原记忆并填写修正内容。' })]), el('span', { class: 'decision-step-label', text: '03 · 修正' })]),
        el('div', { class: 'decision-outcome-fields' }, [outcomeDate, outcomeText]),
        el('label', { class: 'decision-field' }, [el('span', { text: '需要修正的旧记忆（可选）' }), correctionSelect]),
        correctionText,
        el('div', { class: 'decision-form-footer' }, [resultStatus, el('div', { class: 'decision-actions' }, [saveOutcomeButton, confirmOutcomeButton])]),
      ]),
    ]));
  }

  function renderSavedList() {
    savedList.replaceChildren();
    savedCount.textContent = `${reviews.length} 条记录`;
    if (!reviews.length) {
      savedList.append(el('p', { class: 'decision-saved-empty', text: '保存后的分支与复盘记录会列在这里。' }));
      return;
    }
    for (const review of reviews.slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt))) {
      const openButton = el('button', { class: 'decision-saved-open', type: 'button', onClick: () => openReview(review) }, [
        el('span', { class: 'decision-saved-date', text: dateLabel(review.createdAt) }),
        el('strong', { text: review.question }),
        el('span', { class: 'decision-saved-options', text: `A：${review.options?.a || ''}　/　B：${review.options?.b || ''}` }),
        el('small', { text: review.outcome?.memoryUpdated ? '已复盘并更新记忆' : (review.outcome ? '已记录结果' : '等待实际结果') }),
      ]);
      const removeButton = el('button', { class: 'btn-icon decision-saved-remove', type: 'button', title: '删除这条复盘', 'aria-label': '删除复盘记录', text: '×', onClick: async () => {
        const yes = await confirmDialog({ title: '删除这条复盘记录？', message: '只会删除分支图和实际结果记录，不会删除已写入的长期记忆。', confirmText: '删除', danger: true });
        if (!yes) return;
        reviews = reviews.filter((item) => item.id !== review.id);
        if (activeReview?.id === review.id) { activeReview = null; resultRoot.replaceChildren(); }
        persistReviews();
        renderSavedList();
      } });
      savedList.append(el('article', { class: 'decision-saved-item' }, [openButton, removeButton]));
    }
  }

  createButton.addEventListener('click', async () => {
    const prompt = question.value.trim();
    const a = optionA.value.trim();
    const b = optionB.value.trim();
    if (!prompt || !a || !b) return toast('请补全决策问题和 A、B 两个选择。', 'warning');
    if (a === b) return toast('A、B 两个选择需要有所不同。', 'warning');
    if (busy) return;
    busy = true;
    createButton.disabled = true;
    createButton.textContent = '正在生成情景…';
    createStatus.textContent = '正在读取同一份记忆快照并构造 A / B 条件分支…';
    try {
      const snapshot = await searchMemories(COMPANION_MEMORY_SCOPE, `${prompt} ${a} ${b}`, 8);
      const profile = getUserProfile();
      const generated = await generateBranches(prompt, { a, b }, { name: profile.name }, snapshot);
      const review = {
        id: makeId(), question: prompt, options: { a, b }, profileSnapshot: { name: profile.name },
        memorySnapshot: snapshot.map((memory) => ({ ...memory })),
        branches: generated.branches, summary: generated.summary, generationMode: generated.mode,
        createdAt: Date.now(), outcome: null,
      };
      activeReview = review;
      reviews.unshift(review);
      reviews = reviews.slice(0, 30);
      const saved = persistReviews();
      renderReview();
      renderSavedList();
      createStatus.textContent = saved
        ? (generated.mode === 'model' ? '已固定记忆快照并生成两条选择路径。' : '未连接模型，已生成并保存本地演示路径。')
        : '本次分支已生成，但浏览器没有保存复盘历史。';
      resultRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      createStatus.textContent = '分支生成失败；可以检查模型连接后重试。';
      toast(`分支生成失败：${error.message}`, 'error');
    } finally {
      busy = false;
      createButton.disabled = false;
      createButton.textContent = '生成分支推演';
    }
  });

  container.replaceChildren(el('div', { class: 'page decision-page' }, [
    el('header', { class: 'page-header decision-page-header' }, [
      el('div', {}, [el('h1', { class: 'page-title', text: '决策复盘' }), el('p', { class: 'page-sub', text: '把个人长期记忆作为证据，比较不同选择下的条件情景，并在真实结果出现后修订记忆。' })]),
      el('span', { class: 'decision-local-badge', text: '本地保存' }),
    ]),
    el('div', { class: 'decision-page-body' }, [
      formCard,
      resultRoot,
      el('section', { class: 'card decision-history-card' }, [
        el('div', { class: 'decision-section-heading' }, [el('div', {}, [el('h2', { text: '过往复盘' }), el('p', { text: '可重新打开分支图，补充实际结果或查看证据快照。' })]), savedCount]),
        savedList,
      ]),
    ]),
  ]));
  renderSavedList();
  return () => {};
}
