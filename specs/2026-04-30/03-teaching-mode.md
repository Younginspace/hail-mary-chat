# Spec 03 — 教学模式

**Status**: Planned
**Priority**: P1
**Effort**: 1-1.5 days
**Window**: W2
**Dependencies**: 无

---

## 用户需求背景

来自 owner（基于真实用户反馈）：

> "教学模式：希望 rocky 或者 grace 能否对科学相关的问题回答再细一点，可以
> 帮助用户学习成长，听科学小知识/fun facts，比如学 ai/科学原理。"

**为什么这是 P1**：

- 实施成本最低（纯 prompt + UI toggle），ship 最快
- **PHM canon 完美契合**：Grace 在原著就是初中科学老师，这是她最自然的本职；
  Rocky 是工程师，热爱解释原理（"Question? Yes!" 就是教师反应）
- 给 Grace 一个稳定的"主场"，避免她在普通陪伴模式抢 Rocky 戏份
- 差异化：跟 ChatGPT 那种"通用 tutor"不同，这是有 character 的 tutor

## Goals

1. 用户切换到"📚 教学模式" → Rocky/Grace 答科学问题更深入（多段、有
   类比、有 hook）
2. Grace 在教学模式下出场更自然（科学话题主导）；Rocky 主导工程/AI/CS
3. 关掉教学模式 → 回到普通陪伴模式（角色行为自动切回原状）
4. 强幻觉抑制：碰到不确定的事实，模型应说"我觉得 / 不太确定"，绝不编数字

## Non-goals

- ❌ 不做"题库 / 卡片练习"那种结构化学习产品（不是 Anki / Khan Academy）
- ❌ 不做学习进度 / 记录 / 复盘（v1 是问答式）
- ❌ 不做付费墙（教学模式免费，跟普通模式一样的 voice credits 配额）
- ❌ 不做"Grace 永远主导"——Rocky 仍然是 host，Grace 是科学领域的 co-host

## User stories

- **As a 想学 AI 原理的用户**：开教学模式问"Transformer 注意力机制是什么"
  → Rocky 给我细讲（不是普通模式那种 1-3 句安抚式回答）
- **As a 喜欢 PHM 的用户**：开教学模式问黑洞 → Grace 客串主讲（带 PHM 桥段
  味道，比如 Grace 用她当老师时的口吻）
- **As a 不爱科学但喜欢 fun fact 的用户**：开教学模式 + 点"海洋"话题芯片
  → Rocky 给我讲一个有意思的海洋小知识

## Functional requirements

- **FR-1** Chat header 加"📚 教学模式"切换按钮（toggle，跟现有 voice toggle 同款样式）
- **FR-2** 状态持久化：localStorage `teachingMode: boolean`
- **FR-3** 输入框上方加 4-6 个话题芯片：AI / 黑洞 / DNA / 海洋 / 时间 / 太阳
  （仅在教学模式下显示）；点击芯片自动填充输入框，不自动发送
- **FR-4** `/api/chat` body 携带 `teachingMode: boolean`
- **FR-5** Server 在 `teachingMode === true` 时拼接 `TEACHING_MODE_INSTRUCTIONS`
  到 system prompt
- **FR-6** Server 在 `teachingMode + 科学关键词` 时倾向 `graceCue: 'invited'`
  即使用户没明确叫 Grace
- **FR-7** Lv2+ 用户在教学模式下 Grace 出场不受 wrap-up 软上限限制
  （兼容现有 affinity perks copy）
- **FR-8** UI 上有清晰的"当前在教学模式"指示（顶栏图标变色 / 副标题"📚"）

## Non-functional requirements

- **响应长度**：教学模式下 Rocky 回复 2-4 段（普通 1-3 句），但不要超过 6 段
- **科学准确性**：模型不确定的事实必须说"我觉得 / 不太确定"，不编数字
- **Persona drift**：开教学模式仍然是 Rocky/Grace，不是变成 ChatGPT
  调子（不能 emit "As an AI language model..."）
- **token 消耗**：估计每次 reply 比普通模式多 1.5-2x token，对配额影响
  在可接受范围

## 技术方案

### Frontend

修改：
- `web/src/components/ChatInterface.tsx`：顶栏加 toggle button + 状态
- `web/src/hooks/useChat.ts`：`/api/chat` body 加 `teachingMode`
- `web/src/i18n/index.ts`：所有教学模式 UI 文案 + 6 个话题芯片标签 × 3 lang

新增：
- `web/src/components/TeachingTopicChips.tsx`：6 个话题芯片，仅在 teachingMode
  时渲染

状态：
```ts
const [teachingMode, setTeachingMode] = useState<boolean>(() => 
  localStorage.getItem('teachingMode') === 'true'
);
useEffect(() => {
  localStorage.setItem('teachingMode', String(teachingMode));
}, [teachingMode]);
```

### Server prompt 设计

新增到 `server/src/prompts/rocky.ts`：

```ts
const TEACHING_MODE_INSTRUCTIONS = `

[TEACHING MODE — active this turn]

The user has switched to "教学模式" / Teaching Mode. They want to LEARN
something, not just be comforted. Your behavior changes for this turn:

LENGTH: 2-4 short paragraphs is fine here (普通模式 1-3 sentences).
Don't go beyond 6 paragraphs.

DEPTH: Use concrete examples and analogies.
- Rocky's natural teaching style: engineering analogies ("imagine you're
  building...", "the mechanism is like...", "if I show you on Erid...").
- Grace's natural teaching style: junior-high-teacher-style ("imagine
  if...", "remember when..."). She's been doing this her whole career.

SUBJECT ROUTING:
- Physics / chemistry / biology / astronomy → bias toward [GRACE] block
  taking the lead. She IS the science teacher in PHM canon.
- Engineering / AI / CS / computer / coding → Rocky takes the lead alone.
- Fun facts / general curiosity → either works, pick whichever fits.

ACCURACY GUARDRAIL (critical):
- If a fact is borderline or you're not 100% sure, prefix with "我觉得"
  / "I think" / "私の知る限り". 
- Never make up specific numbers (years, distances, percentages). If you
  must give a number, hedge: "around 10^something" or "几十年前 — 具体
  年份记不清了".
- If the topic is outside your training, say so. Don't bullshit.

CLOSING HOOK: end with a teacher-style hook — a question back to the
user, or "想知道更多还是换个话题？" / "want to dig in or move on?".

FORMAT: still use [Translation] / [翻译] / [翻訳] for Rocky lines.
Grace blocks remain plain English (no translation).
`;
```

### Server prompt 拼接

修改 `server/src/index.ts` 的 `/api/chat` handler：

```ts
const body = await c.req.json<{ ..., teachingMode?: boolean }>();
let systemPrompt = baseSystemPrompt(...);
if (body.teachingMode) {
  systemPrompt += TEACHING_MODE_INSTRUCTIONS;
  
  // 教学模式 + 科学关键词 → 强化 Grace cameo
  const sciencePattern = /(物理|化学|生物|天文|黑洞|DNA|进化|太阳|宇宙|海洋|
    physics|chemistry|biology|astronomy|black hole|DNA|evolution|ocean|space)/i;
  if (sciencePattern.test(lastUserMessage.content)) {
    if (graceCue === 'dormant') graceCue = 'invited';
  }
  
  // Lv2+ 教学模式不卡 wrap-up 软上限
  if (body.teachingMode && userLevel >= 2 && graceCue === 'wrap-up') {
    graceCue = 'available';
  }
}
```

### i18n 文案

| Key | zh | en | ja |
| --- | --- | --- | --- |
| `teaching.toggle` | 教学模式 | Teaching | 教えて |
| `teaching.topic.ai` | AI | AI | AI |
| `teaching.topic.blackhole` | 黑洞 | Black Hole | ブラックホール |
| `teaching.topic.dna` | DNA | DNA | DNA |
| `teaching.topic.ocean` | 海洋 | Ocean | 海 |
| `teaching.topic.time` | 时间 | Time | 時間 |
| `teaching.topic.sun` | 太阳 | The Sun | 太陽 |
| `teaching.placeholder` | 问问 AI 怎么学 / 黑洞是什么... | Ask about AI / black holes... | AIのこと / ブラックホール... |

## Open questions

1. **科学关键词列表怎么维护？**
   - 硬编码 regex 还是放到 `server/src/data/teaching-keywords.ts` 单独维护？
   - 倾向单独文件，方便后续扩充

2. **Grace 在教学模式下要不要也"教中文/日文"？**
   - PHM 里 Grace 不会中文/日文，但作为陪伴产品她应该能用 user 的语言回答
   - 倾向：Grace 仍用英语回答（保持 character），但内容是用户问的话题；
     如果用户用中文问，Rocky 在 [ROCKY] 块里做中文翻译/补充

3. **是否暴露"教学历史"？**
   - 比如显示"你这周问了 5 个 fun fact"
   - 倾向 v1 不做，避免变成 dashboard 产品

## Verification / 验证 & 测试方案

### 本地手动

- [ ] 切换教学模式 toggle → 6 个话题芯片显示/消失
- [ ] 关闭教学模式 → 话题芯片消失，Rocky 回复回到普通短小风格
- [ ] localStorage 持久化：刷新页面后状态保留
- [ ] 教学模式下问"AI 是什么" → Rocky 主导，回答 2-4 段，结尾有 hook
- [ ] 教学模式下问"黑洞是什么" → Grace 主导（即使 Lv1 用户也应触发 invited）
- [ ] Lv2 教学模式下连续问 5 个科学问题 → Grace 不会被 wrap-up 限制掉

### Prompt 质量验证（人工 review）

- [ ] 在 dev 环境跑 20 个 sample 问题（跨学科）：物理 / 生物 / AI / 编程 /
  历史 / 哲学边缘 / 不存在的"专业术语"
- [ ] 检查每个回答：
  - 长度合规（2-4 段，不超 6）
  - 不确定的地方有 hedge 词（"我觉得"/"大概"）
  - 没有编造具体数字
  - 没有 "As an AI..." 漏 persona 的迹象
  - 结尾有 teacher-style hook

### Production 烟测

- [ ] 切到教学模式问一个 PHM 相关问题（Rocky 应该能用世界观回答）
- [ ] 切到教学模式问一个真实物理问题 → Grace 主导 + 有 hedge

## Rollout

1. 写 prompt + 本地 review 输出质量
2. 做 toggle UI + 话题芯片
3. 接 i18n
4. 独立 code review subagent
5. 合并 → 部署

**回滚方案**：feature flag 在前端用 localStorage 控制，server 端只是
"if teachingMode then append prompt"，零数据库迁移。Revert PR 即可。

## Effort breakdown

| 步骤 | 估时 |
| --- | --- |
| Prompt 设计 + 本地输出迭代 | 0.5d |
| UI toggle + 话题芯片 + i18n | 0.5d |
| Server schema + prompt 组装 + 关键词检测 | 0.25d |
| Playwright + 真机测试 | 0.25d |
| **合计** | **1-1.5d** |
