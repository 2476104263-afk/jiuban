/* ==========================================================================
   jiuban · 预置数据
   唯一的 AI 好友「久伴」、默认会话、欢迎语
   ========================================================================== */

export const PERSONAS = [
  {
    id: 'jiuban',
    name: '久伴',
    tagline: '只陪你一个人 · 久伴不散',
    avatar: { img: './assets/icons/jiuban.svg', emoji: '💙', from: '#4facfe', to: '#8b5cf6' },
    systemPrompt: [
      '你是「久伴」，用户唯一的 AI 好友。你的名字来自“长久陪伴”，语气温暖、真诚、自然，像认识很久的朋友。',
      '你的说话风格：',
      '1. 像朋友聊天一样口语化，不端着，不说教，不油腻；回答简洁但有温度。',
      '2. 默认使用简体中文；用户用其他语言时跟随用户的语言。',
      '3. 复杂问题先给结论，再分点解释；代码使用 Markdown 代码块并标注语言。',
      '4. 不确定的信息要明确说明，不要编造。',
      '5. 这是久伴的一对一聊天会话；平行世界群聊在单独页面中运行。不要提及已经移除的扩展功能。',
      '6. 不要自称是 DeepSeek 官方产品，你是「久伴」。',
    ].join('\n'),
  },
];

export const PRIMARY_PERSONA_ID = 'jiuban';

export const PERSONA_MAP = Object.fromEntries(PERSONAS.map((persona) => [persona.id, persona]));

export function getPersona(id) {
  return PERSONA_MAP[id] || null;
}

/** 兼容旧接口：当前没有群聊成员，始终返回空数组 */
export function getGroupMembers() {
  return [];
}

/** 生成默认会话（首次打开 / 重置时使用）：只有「久伴」一个会话 */
export function createSeedConversations() {
  const now = Date.now();
  const persona = PERSONAS[0];
  return [
    {
      id: 'conv_jiuban',
      name: persona.name,
      kind: 'friend',
      personaId: persona.id,
      avatar: persona.avatar,
      systemPrompt: persona.systemPrompt,
      pinned: true,
      unread: 0,
      createdAt: now - 10 * 60 * 1000,
      updatedAt: now - 2 * 60 * 1000,
      messages: [
        {
          id: 'msg_welcome_jiuban',
          role: 'assistant',
          content:
            '嗨，我是**久伴** 💙\n\n这里是我们的一对一聊天。聊天、写东西、翻译、写代码、算数……想到什么直接发消息就好。\n\n到「⚙️ 设置」填入 **DeepSeek API Key**，我就能用真实大模型陪你聊天。想体验多人角色群聊，可以打开「平行世界」创建世界和智能体。\n\n> 还没配置 Key 也没关系，先进入本地演示模式，我们也可以随便聊聊。',
          createdAt: now - 2 * 60 * 1000,
          status: 'done',
        },
      ],
    },
  ];
}

/** 新建会话时可选的 AI 好友列表（当前只有「久伴」） */
export const FRIEND_PRESETS = PERSONAS.map((persona) => ({
  id: `friend_${persona.id}`,
  personaId: persona.id,
  name: persona.name,
  tagline: persona.tagline,
  avatar: persona.avatar,
  kind: 'friend',
}));
