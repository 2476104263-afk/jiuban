import { streamCompletion } from './api.js';
import { store } from './store.js';
import { confirmDialog, el, modal, renderMarkdown, toast } from './util.js';

const STORAGE_KEY = 'jiuban.people-memories.v1';
const MAX_PROFILES = 40;
const MAX_MEMORIES = 120;
const MAX_MESSAGES = 100;

function makeId(prefix = 'person') {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function readProfiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.id && item.name).map((item) => ({
      id: String(item.id),
      name: String(item.name).slice(0, 32),
      context: String(item.context || '').slice(0, 1200),
      voice: String(item.voice || '').slice(0, 1200),
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
      memories: Array.isArray(item.memories) ? item.memories.slice(0, MAX_MEMORIES) : [],
      messages: Array.isArray(item.messages) ? item.messages.slice(-MAX_MESSAGES) : [],
    }));
  } catch {
    return [];
  }
}

function saveProfiles(profiles) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles.slice(0, MAX_PROFILES)));
    return true;
  } catch {
    toast('保存失败，浏览器本地存储空间可能不足。', 'error');
    return false;
  }
}

function dateInputValue(value) {
  const time = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(time)) return new Date().toISOString().slice(0, 10);
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateLabel(value) {
  const time = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
    : '时间未记录';
}

function evidenceTerms(text) {
  const source = String(text || '').toLowerCase();
  const terms = new Set(source.match(/[a-z0-9]+|[\u3400-\u9fff]/g) || []);
  for (const group of source.match(/[\u3400-\u9fff]+/g) || []) {
    for (let i = 0; i < group.length - 1; i += 1) terms.add(group.slice(i, i + 2));
  }
  return terms;
}

function findEvidence(profile, query, limit = 5) {
  const terms = evidenceTerms(query);
  if (!terms.size) return [];
  return (profile.memories || []).map((memory) => {
    const text = `${memory.content || ''} ${memory.quote || ''} ${memory.tags || ''}`;
    const memoryTerms = evidenceTerms(text);
    let overlap = 0;
    for (const term of terms) if (memoryTerms.has(term)) overlap += 1;
    return { memory, score: overlap / terms.size };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.memory.eventTime || 0) - Number(a.memory.eventTime || 0))
    .slice(0, limit)
    .map((item) => item.memory);
}

function parseReply(raw, allowedIds) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      const answer = String(parsed.answer || parsed.reply || '').trim();
      if (answer) {
        const allowed = new Set(allowedIds);
        const memoryIds = (Array.isArray(parsed.memoryIds) ? parsed.memoryIds : []).map(String).filter((id) => allowed.has(id)).slice(0, 5);
        return {
          answer,
          memoryIds,
          uncertainty: String(parsed.uncertainty || (memoryIds.length ? '' : '本次回答未引用档案记忆；涉及个人的内容不能当作事实。')).trim().slice(0, 240),
          mode: memoryIds.length ? 'model' : 'model-unreferenced',
        };
      }
    } catch { /* 兼容只返回普通文本的模型 */ }
  }
  return {
    answer: cleaned.slice(0, 1600) || '模型没有返回可显示的内容。',
    memoryIds: [],
    uncertainty: '模型回复没有提供可核验的记忆引用。',
    mode: 'model-unreferenced',
  };
}

function localReply(question, evidence) {
  if (!evidence.length) {
    return {
      answer: '这份档案里没有找到足以回答这个问题的相关回忆。我不会替对方编造共同经历或现在的想法。你可以先补充一条经过你确认的记忆，再继续整理。',
      memoryIds: [],
      uncertainty: '本地演示只检索你保存的材料，不会推断对方当前的真实想法。',
      mode: 'local-demo',
    };
  }
  const first = evidence[0];
  return {
    answer: `这是依据档案材料生成的有限模拟，不代表对方本人。\n\n你保存的相关回忆是：“${first.quote || first.content}”${first.eventTime ? `（${dateLabel(first.eventTime)}）` : ''}。这段记录可以帮助你回看当时发生了什么，但不足以判断对方现在会怎么想。\n\n如果你愿意，可以补充你当时的感受，或再加一条相关经历。`,
    memoryIds: [first.id],
    uncertainty: '本地演示只引用已保存的回忆，不能还原真实人物，也不能代表其当前态度。',
    mode: 'local-demo',
  };
}

function profileForm(profile = null) {
  const name = el('input', { class: 'input', type: 'text', maxlength: 32, placeholder: '例如：小林、项目搭档、那位老师', value: profile?.name || '' });
  const context = el('textarea', { class: 'input', rows: 3, maxlength: 1200, placeholder: '关系、相识背景或你希望记住的基本情境（可跳过）', value: profile?.context || '' });
  const voice = el('textarea', { class: 'input', rows: 3, maxlength: 1200, placeholder: '你观察到的表达习惯、性格特点或常用语（可跳过）', value: profile?.voice || '' });
  const body = el('div', { class: 'people-modal-form' }, [
    el('p', { class: 'people-privacy-note', text: '请只添加你有权保存、愿意用于个人回忆整理的信息。档案保存在本机浏览器中；创建档案不会自动上传或读取其他应用数据。' }),
    el('label', { class: 'people-field' }, [el('span', { text: '代号或昵称' }), name]),
    el('label', { class: 'people-field' }, [el('span', { text: '关系与背景' }), context]),
    el('label', { class: 'people-field' }, [el('span', { text: '表达风格观察' }), voice]),
  ]);
  return { name, context, voice, body };
}

function memoryForm(memory = null) {
  const content = el('textarea', { class: 'input', rows: 3, maxlength: 1400, placeholder: '用自己的话记录一段经过确认的共同经历或事实。', value: memory?.content || '' });
  const quote = el('textarea', { class: 'input', rows: 2, maxlength: 1000, placeholder: '可粘贴你主动提供的原始片段；也可以留空。', value: memory?.quote || '' });
  const source = el('input', { class: 'input', type: 'text', maxlength: 80, placeholder: '例如：我的回忆、聊天摘录、项目记录', value: memory?.source || '我的回忆' });
  const eventDate = el('input', { class: 'input', type: 'date', value: dateInputValue(memory?.eventTime) });
  const body = el('div', { class: 'people-modal-form' }, [
    el('p', { class: 'people-privacy-note', text: '仅手动记录或粘贴的内容会进入档案。请不要上传整份聊天数据库；原始片段只用于支持个人回忆，不表示对方当前的意见。' }),
    el('label', { class: 'people-field' }, [el('span', { text: '回忆内容' }), content]),
    el('label', { class: 'people-field' }, [el('span', { text: '原始片段（可选）' }), quote]),
    el('div', { class: 'people-field-grid' }, [
      el('label', { class: 'people-field' }, [el('span', { text: '来源说明' }), source]),
      el('label', { class: 'people-field' }, [el('span', { text: '事件发生日期' }), eventDate]),
    ]),
  ]);
  return { content, quote, source, eventDate, body };
}

export async function mountPeopleView(container) {
  let profiles = readProfiles();
  let activeId = profiles[0]?.id || null;
  let busy = false;

  function activeProfile() {
    return profiles.find((item) => item.id === activeId) || null;
  }

  function commit() {
    const now = Date.now();
    const active = activeProfile();
    if (active) active.updatedAt = now;
    return saveProfiles(profiles);
  }

  function openProfileEditor(existing = null) {
    const form = profileForm(existing);
    let dialog;
    const saveButton = el('button', { class: 'btn btn-primary', type: 'button', text: existing ? '保存档案' : '创建档案', onClick: () => {
      const displayName = form.name.value.trim();
      if (!displayName) {
        toast('请先填写代号或昵称。', 'warning');
        form.name.focus();
        return;
      }
      if (existing) {
        const target = profiles.find((item) => item.id === existing.id);
        if (!target) return dialog.close();
        target.name = displayName;
        target.context = form.context.value.trim();
        target.voice = form.voice.value.trim();
        target.updatedAt = Date.now();
      } else {
        if (profiles.length >= MAX_PROFILES) return toast(`最多保存 ${MAX_PROFILES} 份档案。`, 'warning');
        const created = {
          id: makeId(), name: displayName, context: form.context.value.trim(), voice: form.voice.value.trim(),
          createdAt: Date.now(), updatedAt: Date.now(), memories: [], messages: [],
        };
        profiles.unshift(created);
        activeId = created.id;
      }
      const saved = saveProfiles(profiles);
      dialog.close();
      render();
      if (saved) toast(existing ? '档案已更新。' : '档案已创建。', 'success');
    } });
    dialog = modal({
      title: existing ? '编辑人物档案' : '新建人物档案',
      body: form.body,
      footer: [el('button', { class: 'btn btn-ghost', type: 'button', onClick: () => dialog.close() }, '取消'), saveButton],
      wide: true,
    });
  }

  function openMemoryEditor(profile, existing = null) {
    const form = memoryForm(existing);
    let dialog;
    const saveButton = el('button', { class: 'btn btn-primary', type: 'button', text: existing ? '保存修正' : '保存回忆', onClick: () => {
      const body = form.content.value.trim();
      if (!body) {
        toast('回忆内容不能为空。', 'warning');
        form.content.focus();
        return;
      }
      const eventTime = Date.parse(`${form.eventDate.value || dateInputValue(Date.now())}T12:00:00`) || Date.now();
      if (existing) {
        const target = profile.memories.find((item) => item.id === existing.id);
        if (!target) return dialog.close();
        target.revisionHistory = Array.isArray(target.revisionHistory) ? target.revisionHistory : [];
        target.revisionHistory.push({ content: target.content, quote: target.quote || '', source: target.source || '', eventTime: target.eventTime || null, revisedAt: Date.now() });
        target.revisionHistory = target.revisionHistory.slice(-8);
        target.content = body;
        target.quote = form.quote.value.trim();
        target.source = form.source.value.trim() || '我的回忆';
        target.eventTime = eventTime;
        target.updatedAt = Date.now();
      } else {
        if (profile.memories.length >= MAX_MEMORIES) return toast(`每份档案最多保存 ${MAX_MEMORIES} 条回忆。`, 'warning');
        profile.memories.unshift({
          id: makeId('memory'), content: body, quote: form.quote.value.trim(),
          source: form.source.value.trim() || '我的回忆', eventTime, createdAt: Date.now(), updatedAt: Date.now(), revisionHistory: [],
        });
      }
      profile.updatedAt = Date.now();
      const saved = saveProfiles(profiles);
      dialog.close();
      render();
      if (saved) toast(existing ? '已保存修正版本，旧版本保留在记录中。' : '回忆已加入档案。', 'success');
    } });
    dialog = modal({
      title: existing ? '修正回忆' : '补充一段回忆', body: form.body,
      footer: [el('button', { class: 'btn btn-ghost', type: 'button', onClick: () => dialog.close() }, '取消'), saveButton], wide: true,
    });
  }

  function evidenceCard(profile, memory) {
    const history = Array.isArray(memory.revisionHistory) ? memory.revisionHistory : [];
    const actions = el('div', { class: 'people-evidence-actions' }, [
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '修正', onClick: () => openMemoryEditor(profile, memory) }),
      el('button', { class: 'btn-icon people-memory-delete', type: 'button', title: '删除回忆', 'aria-label': '删除回忆', text: '×', onClick: async () => {
        const yes = await confirmDialog({ title: '删除这段回忆？', message: '这会从当前人物档案和后续模拟中删除这条记录。', confirmText: '删除', danger: true });
        if (!yes) return;
        profile.memories = profile.memories.filter((item) => item.id !== memory.id);
        commit();
        render();
      } }),
    ]);
    const children = [
      el('div', { class: 'people-evidence-meta' }, [
        el('span', { class: 'people-evidence-date', text: dateLabel(memory.eventTime) }),
        el('span', { text: memory.source || '我的回忆' }),
      ]),
      el('p', { class: 'people-evidence-content', text: memory.content }),
    ];
    if (memory.quote) children.push(el('blockquote', { class: 'people-evidence-quote', text: `原始片段：“${memory.quote}”` }));
    if (history.length) {
      children.push(el('details', { class: 'people-revision-history' }, [
        el('summary', { text: `修订记录 · ${history.length} 个旧版本` }),
        el('div', { class: 'people-revision-list' }, history.slice().reverse().map((item) => el('div', { class: 'people-revision-item' }, [
          el('small', { text: `修正于 ${dateLabel(item.revisedAt)} · 事件日期 ${dateLabel(item.eventTime)}` }),
          el('p', { text: item.content }),
          item.quote ? el('blockquote', { text: `原始片段：“${item.quote}”` }) : null,
        ]))),
      ]));
    }
    children.push(actions);
    return el('article', { class: 'people-evidence-card' }, children);
  }

  function renderMessages(profile, memoryById) {
    const transcript = el('div', { class: 'people-transcript', 'aria-live': 'polite' });
    if (!profile.messages.length) {
      transcript.append(el('div', { class: 'people-chat-empty' }, [
        el('span', { class: 'people-chat-empty-icon', text: '◌' }),
        el('strong', { text: '从一段具体回忆开始' }),
        el('p', { text: '你可以问一件档案里有记录的事。证据不足时，模拟会明确说明无法判断。' }),
      ]));
      return transcript;
    }
    for (const message of profile.messages) {
      const isUser = message.role === 'user';
      const refs = (message.memoryIds || []).map((id) => memoryById.get(id)).filter(Boolean);
      const bubbleContent = isUser
        ? el('p', { text: message.content })
        : el('div', { class: 'people-message-markdown', html: renderMarkdown(message.content) });
      const children = [
        el('div', { class: 'people-message-meta' }, [
          el('strong', { text: isUser ? '我' : `${profile.name} · 模拟回忆` }),
          el('time', { text: new Date(message.createdAt || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }),
        ]),
        bubbleContent,
      ];
      if (!isUser && message.mode) children.push(el('span', { class: 'people-mode-label', text: message.mode === 'model' ? '模型模拟' : (message.mode === 'local-demo' ? '本地演示' : '未附证据引用') }));
      if (!isUser && refs.length) children.push(el('div', { class: 'people-citation-list' }, [
        el('span', { class: 'people-citation-title', text: '引用的档案记忆' }),
        ...refs.map((memory) => el('button', { class: 'people-citation', type: 'button', title: '定位到证据记录', text: `“${memory.content.slice(0, 72)}${memory.content.length > 72 ? '…' : ''}” · ${dateLabel(memory.eventTime)}`, onClick: () => document.getElementById(`people-memory-${memory.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) })),
      ]));
      if (!isUser && message.uncertainty) children.push(el('p', { class: 'people-uncertainty', text: `不确定因素：${message.uncertainty}` }));
      transcript.append(el('article', { class: `people-message ${isUser ? 'is-user' : 'is-assistant'}` }, [el('div', { class: 'people-message-bubble' }, children)]));
    }
    return transcript;
  }

  function renderDetail(profile) {
    const memoryById = new Map(profile.memories.map((memory) => [memory.id, memory]));
    const addMemoryButton = el('button', { class: 'btn btn-soft', type: 'button', text: '+ 添加回忆', onClick: () => openMemoryEditor(profile) });
    const editProfileButton = el('button', { class: 'btn btn-ghost', type: 'button', text: '编辑档案', onClick: () => openProfileEditor(profile) });
    const deleteProfileButton = el('button', { class: 'btn btn-ghost people-delete-profile', type: 'button', text: '删除档案', onClick: async () => {
      const yes = await confirmDialog({ title: `删除“${profile.name}”的档案？`, message: '档案、回忆、修订历史和对话都会从本地浏览器删除。', confirmText: '删除档案', danger: true });
      if (!yes) return;
      profiles = profiles.filter((item) => item.id !== profile.id);
      activeId = profiles[0]?.id || null;
      saveProfiles(profiles);
      render();
    } });
    const transcript = renderMessages(profile, memoryById);
    const composer = el('textarea', { class: 'input people-composer-input', rows: 2, maxlength: 900, placeholder: `问一件与${profile.name}有关、且可以从回忆中核对的事…`, 'aria-label': '输入回忆问题' });
    const sendButton = el('button', { class: 'btn btn-primary people-send-button', type: 'button', text: '生成模拟' });
    const clearButton = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '清空对话', onClick: async () => {
      if (!profile.messages.length) return;
      const yes = await confirmDialog({ title: '清空这份档案的对话？', message: '只会清除模拟对话，保存的回忆和修订记录会保留。', confirmText: '清空对话' });
      if (!yes) return;
      profile.messages = [];
      commit();
      render();
    } });

    const send = async () => {
      const question = composer.value.trim();
      if (!question) return toast('先写下你想回看的问题。', 'warning');
      if (busy) return;
      busy = true;
      sendButton.disabled = true;
      sendButton.textContent = store.settings.apiKey ? '准备模拟…' : '整理回忆…';
      try {
        const evidence = findEvidence(profile, question, 5);
        let reply;
        if (store.settings.apiKey) {
          const proceed = await confirmDialog({
            title: '确认将档案内容发送给模型？',
            message: `本次会发送代号、关系与表达风格描述、${evidence.length} 条相关回忆和最近对话到当前配置的模型服务。内容可能离开本机；仅在你有权使用并愿意发送时继续。`,
            confirmText: '发送并生成',
          });
          if (!proceed) return;
          const memoryPayload = evidence.map((memory) => ({
            id: memory.id, eventDate: dateLabel(memory.eventTime), content: memory.content,
            originalQuote: memory.quote || '', source: memory.source || '我的回忆',
          }));
          const system = [
            `你在 Memora 中提供“${profile.name}”的条件化情景模拟。这是基于用户主动保存材料的虚构回忆练习，不是真人、不是该真人的账号，也不代表其当前想法或意见。`,
            '不要声称你就是现实中的这个人；不要把未提供的信息说成事实，不要虚构共同经历、承诺、道歉或对方当前意图。资料不足时直接说无法判断。避免鼓励骚扰、跟踪或未经同意的联系。',
            '可以参考用户提供的表达风格，但要温和、简短，并明确这是模拟。把档案记忆作为唯一的个人事实依据；推测须标为假设。',
            `关系与背景观察：${profile.context || '未提供'}`,
            `表达风格观察：${profile.voice || '未提供'}`,
            `本轮相关记忆（仅可引用这些 ID）：${JSON.stringify(memoryPayload)}`,
            '请只返回 JSON，不要 Markdown 代码围栏：{"answer":"对用户的中文回复","memoryIds":["可引用的记忆ID"],"uncertainty":"本回复的主要不确定因素"}。memoryIds 只能填写上方记忆中存在的 ID；没有证据时返回空数组。',
          ].join('\n\n');
          const recent = profile.messages.slice(-8).map((message) => ({ role: message.role, content: message.content }));
          const result = await streamCompletion({
            settings: { ...store.settings, stream: false, temperature: 0.45, maxTokens: 900 },
            messages: [{ role: 'system', content: system }, ...recent, { role: 'user', content: question }],
          });
          reply = parseReply(result.content, evidence.map((memory) => memory.id));
        } else {
          reply = localReply(question, evidence);
        }
        profile.messages.push({ id: makeId('message'), role: 'user', content: question, createdAt: Date.now() });
        profile.messages.push({
          id: makeId('message'), role: 'assistant', content: reply.answer,
          memoryIds: reply.memoryIds, uncertainty: reply.uncertainty, mode: reply.mode, createdAt: Date.now(),
        });
        profile.messages = profile.messages.slice(-MAX_MESSAGES);
        profile.updatedAt = Date.now();
        saveProfiles(profiles);
        render();
        const nextInput = container.querySelector('.people-composer-input');
        if (nextInput) nextInput.focus();
      } catch (error) {
        toast(`生成失败：${error.message}`, 'error');
      } finally {
        busy = false;
        sendButton.disabled = false;
        sendButton.textContent = '生成模拟';
      }
    };
    sendButton.addEventListener('click', send);
    composer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });

    const transcriptPane = el('section', { class: 'people-chat-panel card' }, [
      el('header', { class: 'people-panel-heading' }, [
        el('div', {}, [el('h2', { text: '回忆对话' }), el('p', { text: '依据你保存的资料进行模拟；可查看引用记录和不确定因素。' })]),
        clearButton,
      ]),
      transcript,
      el('div', { class: 'people-composer' }, [
        composer,
        el('div', { class: 'people-composer-footer' }, [
          el('span', { class: 'people-composer-note', text: store.settings.apiKey ? '发送前逐次确认模型数据传输' : '本地演示 · 未配置模型，不会发送数据' }),
          sendButton,
        ]),
      ]),
    ]);

    const memoryCards = profile.memories.length
      ? profile.memories.slice().sort((a, b) => Number(b.eventTime || b.createdAt) - Number(a.eventTime || a.createdAt)).map((memory) => el('div', { id: `people-memory-${memory.id}` }, [evidenceCard(profile, memory)]))
      : [el('div', { class: 'people-memory-empty' }, [el('strong', { text: '还没有回忆证据' }), el('p', { text: '添加一段手动记录或原始片段；没有证据的内容不会被当作事实。' }), el('button', { class: 'btn btn-soft', type: 'button', text: '添加第一段回忆', onClick: () => openMemoryEditor(profile) })])];
    const evidencePanel = el('aside', { class: 'people-evidence-panel card' }, [
      el('header', { class: 'people-panel-heading' }, [
        el('div', {}, [el('h2', { text: '经历与证据' }), el('p', { text: `${profile.memories.length} 条 · 原始来源可查看` })]),
        addMemoryButton,
      ]),
      el('div', { class: 'people-evidence-list' }, memoryCards),
    ]);

    const profileInfo = el('div', { class: 'people-profile-context' }, [
      el('section', { class: 'people-profile-note' }, [el('span', { text: '关系与背景' }), el('p', { text: profile.context || '尚未补充' })]),
      el('section', { class: 'people-profile-note' }, [el('span', { text: '表达风格观察' }), el('p', { text: profile.voice || '尚未补充' })]),
    ]);
    return el('div', { class: 'people-workspace' }, [
      el('header', { class: 'people-profile-header card' }, [
        el('div', { class: 'people-profile-title' }, [
          el('div', { class: 'people-avatar', text: profile.name.slice(0, 1) || '人' }),
          el('div', {}, [el('div', { class: 'people-profile-eyebrow', text: '人物回忆 · 模拟档案' }), el('h2', { text: profile.name }), el('p', { text: 'AI 生成内容是情景模拟，不是真人发言。' })]),
        ]),
        el('div', { class: 'people-profile-actions' }, [editProfileButton, deleteProfileButton]),
        profileInfo,
      ]),
      el('div', { class: 'people-content-grid' }, [transcriptPane, evidencePanel]),
    ]);
  }

  function render() {
    const list = el('aside', { class: 'people-list-panel card' });
    const listHeader = el('div', { class: 'people-list-heading' }, [
      el('div', {}, [el('h2', { text: '人物档案' }), el('p', { text: `${profiles.length} 份本地档案` })]),
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '+ 新建', onClick: () => openProfileEditor() }),
    ]);
    const rows = el('div', { class: 'people-list-rows' });
    if (!profiles.length) rows.append(el('div', { class: 'people-list-empty', text: '创建代号档案，开始整理回忆。' }));
    for (const profile of profiles) {
      rows.append(el('button', { class: `people-list-item${profile.id === activeId ? ' is-active' : ''}`, type: 'button', onClick: () => { activeId = profile.id; render(); } }, [
        el('span', { class: 'people-list-avatar', text: profile.name.slice(0, 1) || '人' }),
        el('span', { class: 'people-list-copy' }, [el('strong', { text: profile.name }), el('small', { text: `${profile.memories.length} 条回忆` })]),
      ]));
    }
    list.append(listHeader, rows, el('div', { class: 'people-list-footnote', text: '档案只保存在本机浏览器。删除档案会一并删除其回忆和对话。' }));

    const profile = activeProfile();
    const main = profile
      ? renderDetail(profile)
      : el('section', { class: 'people-welcome card' }, [
        el('span', { class: 'people-welcome-icon', text: '◌' }),
        el('h2', { text: '整理一份有证据的回忆档案' }),
        el('p', { text: '从代号、背景和表达观察开始，再逐条添加你主动提供的回忆。对话模拟会引用已保存材料，并标明不确定之处。' }),
        el('button', { class: 'btn btn-primary', type: 'button', text: '创建人物档案', onClick: () => openProfileEditor() }),
        el('small', { text: '不会自动读取聊天软件、联系人或照片。' }),
      ]);
    container.replaceChildren(el('div', { class: 'page people-page' }, [
      el('header', { class: 'page-header people-page-header' }, [
        el('div', {}, [el('h1', { class: 'page-title', text: '人物回忆' }), el('p', { class: 'page-sub', text: '把记忆、观察与模拟表达分开保存，让每段回答都能回到来源。' })]),
        el('span', { class: 'people-local-badge', text: '本地档案' }),
      ]),
      el('div', { class: 'people-page-body' }, [list, main]),
    ]));
  }

  render();
  return () => {};
}
