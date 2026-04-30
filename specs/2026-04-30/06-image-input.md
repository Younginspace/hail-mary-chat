# Spec 06 — 识图（图像理解）

**Status**: Planned
**Priority**: P2
**Effort**: 3-4 days
**Window**: W3+
**Dependencies**: `DASHSCOPE_API_KEY` secret（与 #07 共享）, R2 bucket 用于
图片存储

---

## 用户需求背景

来自 owner（基于真实用户反馈）：

> "识图：允许用户上传图片（每次一张，只能图片），rocky（llm）底层的
> minimax 本身是多模态模型应该可以理解。"

**调研结论**：MiniMax M2.x 文本 LLM **不接受图像输入**（已经 cross-verify
官方 docs 三个页面）。需要外接 vision vendor。已选 **DashScope Qwen-VL-Max**
（详见 INDEX.md "调研结论"段）。

**为什么这是 P2**：

- 不是核心情感陪伴功能（聊天 + 听 + 说才是核心）
- 但能显著增加 stickiness（"给 Rocky 看我的猫"是高情感场景）
- 引入新 vendor 集成 + 持久化资产（图片要存 R2），实施面比较大
- Persona drift 风险：vision 模型描述图片很容易丢 Rocky 角色味

## Goals

1. 用户在 chat 输入区可以选/拍一张图片，跟文字一起发送
2. Rocky 像"看到照片"那样回应——不是 OCR 式描述，是有情感的对话
3. 三语都能正确响应（用户语言 → Rocky 用相同语言回应）
4. 单图限制（每条消息最多 1 张），只接受图片格式（不接 PDF/视频）
5. NSFW / 暴力图被前置 moderation 拒绝

## Non-goals

- ❌ 多图同时上传（v1 严格 1 张）
- ❌ 视频 / GIF / 文档（仅静态图）
- ❌ 图片永久存储（24h 后自动清理；用户能再上传同样的图）
- ❌ 图片编辑 / 滤镜
- ❌ 自动 tag / 分类（让 Rocky 自然描述就够了）

## User stories

- **As a 想分享日常的用户**：拍一张猫的照片发给 Rocky → "Earth kid, this
  cat is doing important work. Resting." 这种感觉
- **As a 旅行中的用户**：拍一张街景 → Rocky 给一段沉浸式的描述（带情感，
  不是 OCR 式）
- **As a Lv2+ 用户**：分享照片可能触发 Grace 客串（Grace 看到地球景物会有
  自己的反应）

## Functional requirements

- **FR-1** 输入区加 📷 图片按钮（旁边可能有 🎤 #07 共存）
- **FR-2** 点击 📷 → 系统相册/相机选择器（HTML `<input type="file" accept="image/*">`）
- **FR-3** 选完图片 → 输入框上方显示缩略图预览 + ✕ 删除按钮
- **FR-4** 用户可同时输入文字 + 图片（文字框成为 caption）
- **FR-5** 客户端压缩：图片 > 2MB 时压缩到 max 1920px 长边 + JPEG quality 0.85
- **FR-6** 点 send → 图片上传 R2 → 后端调 Qwen-VL-Max → Rocky 风格回复
- **FR-7** Rocky 回复走现有 chat 流（包括 TTS）
- **FR-8** 上传中 UI：缩略图打码 + spinner
- **FR-9** 图片格式校验：仅 jpg/png/webp/heic（其他拒绝 + 友好提示）
- **FR-10** Cloudflare image moderation 检测 NSFW/暴力 → 拒绝 + 提示

## Non-functional requirements

- **延迟**：从 send 到 Rocky 第一个字的 chunk < 4 秒（含上传 + vision 调用）
- **成本**：每次识图调用 < ¥0.01（Qwen-VL-Max ~¥0.0035/请求 + R2 存储几乎零）
- **图片体积**：上传到 R2 的图 < 2MB（客户端压缩保证）
- **隐私**：R2 图片 24h 自动删（lifecycle policy）；签名 URL 短期有效
- **iOS HEIC 支持**：iPhone 默认 HEIC 格式，浏览器可读但 Qwen-VL-Max 可能
  不接受 → 客户端用 canvas 转 JPEG

## 技术方案

### 整体流水线

```
用户选图 → 客户端压缩 + 格式转换（HEIC→JPEG）
  ↓
POST /api/chat-with-image （multipart 或 base64 在 JSON）
  ↓
Worker:
  1. NSFW 检查（Cloudflare Images / Workers AI）
  2. 上传到 R2，签名 URL（10 分钟）
  3. 调 Qwen-VL-Max with Rocky persona
  4. Stream 回复 chunks 给前端
  5. waitUntil(R2 delete)（或留 24h TTL）
  ↓
前端：流式渲染 + TTS 播放
```

### Frontend

新增：
- `web/src/components/ImageUploadButton.tsx`：📷 按钮
- `web/src/utils/imageCompress.ts`：客户端压缩 + HEIC→JPEG
- `web/src/components/ImagePreview.tsx`：上传前 / 上传中的缩略图

修改：
- `web/src/components/ChatInput.tsx`：集成 ImageUploadButton
- `web/src/hooks/useChat.ts`：sendMessage 支持携带 imageBlob

客户端压缩 + HEIC 处理：

```ts
async function preprocessImage(file: File): Promise<Blob> {
  // 1. HEIC 检测（File.type 可能是 image/heic 或空字符串）
  const isHEIC = /\.(heic|heif)$/i.test(file.name) || file.type.includes('heic');
  
  // 2. 通过 canvas 重绘 → 自动转 JPEG（绕过 HEIC 直接 send）
  const img = await createImageBitmap(file);
  const maxLongSide = 1920;
  const scale = Math.min(1, maxLongSide / Math.max(img.width, img.height));
  
  const canvas = new OffscreenCanvas(img.width * scale, img.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}
```

### Server

新增端点：`POST /api/chat-with-image`

或者扩展现有 `/api/chat` schema，加 `imageBase64?: string` 字段。倾向**新端
点**，因为流程跟纯文本聊天差异较大（要先识图再喂 LLM）。

```ts
const chatWithImageSchema = z.object({
  imageBase64: z.string(),
  imageMime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  caption: z.string().max(500).optional(),
  sessionId: z.string(),
  // 其他跟 /api/chat 同样的字段
});

app.post('/api/chat-with-image', authMiddleware, async (c) => {
  const data = chatWithImageSchema.parse(await c.req.json());
  
  // 1. 解码 base64 → bytes
  const bytes = Uint8Array.from(atob(data.imageBase64), ch => ch.charCodeAt(0));
  if (bytes.length > 2 * 1024 * 1024) {
    return c.json({ error: 'image_too_large' }, 400);
  }
  
  // 2. NSFW 检查（Cloudflare Workers AI image classifier）
  const moderation = await c.env.AI.run('@cf/some/image-classifier', { image: [...bytes] });
  if (moderation.isNSFW || moderation.isViolent) {
    return c.json({ error: 'image_rejected' }, 400);
  }
  
  // 3. 上传 R2
  const r2Key = `images/${userId}/${crypto.randomUUID()}.jpg`;
  await c.env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: data.imageMime } });
  const signedUrl = await c.env.MEDIA.createSignedUrl(r2Key, { expiresIn: 600 });
  
  // 4. 构造给 Qwen-VL 的 messages
  const userMsg = {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: signedUrl } },
      { type: 'text', text: data.caption || '看看这个' },
    ],
  };
  
  // 5. 调 Qwen-VL-Max（OpenAI-compatible），加 Rocky persona
  const visionResp = await fetch(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-vl-max-latest',
        messages: [
          { role: 'system', content: ROCKY_SYSTEM_PROMPT + VISION_PERSONA_HINT },
          ...recentChatHistory,
          userMsg,
        ],
        stream: true,
        max_tokens: 800,
      }),
    }
  );
  
  // 6. 流式 chunk 透传到前端
  // 7. R2 cleanup（waitUntil）
  c.executionCtx.waitUntil(
    new Promise(r => setTimeout(r, 60_000)).then(() => c.env.MEDIA.delete(r2Key))
  );
  
  return new Response(visionResp.body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
});
```

### Persona prompt（最 critical 的设计）

Vision 模型默认输出是 OCR 式中性描述。要让它"像 Rocky 看到照片"，必须在
system prompt 里强化：

```ts
const VISION_PERSONA_HINT = `

IMAGE CONTEXT (this turn only):
The user just shared a photo with you. You are Rocky, an Eridian engineer
on a long-distance call with this Earth person. You can see what they see
(through whatever space-bridge tech this call uses).

DO NOT describe the photo like a photo description. Don't say "this image
shows..." or "I can see in the picture...". Look at it WITH them.

DO say things like:
- "Earth kid! Is this a..." [thing you see]
- "Wait, show Rocky again. The thing in the corner — what is that?"
- "Cat, yes? Cats are good. Question: why do they sleep on warm thing?"
- "This place — looks like home? Or new place?"

Keep it conversational, curious, warm. 1-3 short paragraphs (not the
teaching mode 2-4). Use [Translation] format as usual.

If the photo contains people, focus on what they're doing / feeling, not
their appearance. NEVER comment on weight / attractiveness / age.

If you genuinely don't understand what's in the image (low quality,
abstract, etc.), say so honestly: "Earth kid, Rocky cannot see clearly.
What is this?"
`;
```

### NSFW moderation

Cloudflare Workers AI 有内置 image classifier。需要确认具体 model name
（可能是 `@cf/microsoft/resnet-50` 或 `@cf/openai/clip` 等，要查 docs）。

如果 Workers AI 不够准，备选方案：用 Qwen-VL-Plus 先跑一个轻量 moderation
prompt（"This image contains NSFW or violent content. Answer yes/no
only."），然后再决定是否走主流程。但这又一次 vision call，成本翻倍。

**倾向 v1 用 Workers AI**，看实际假阳性/假阴性率再决定升级。

### Server changes — schema/types

修改 `server/src/defs/runtime.ts`：

```ts
export type SecretKey =
  | 'MINIMAX_CODING_PLAN_KEY'
  | 'MINIMAX_API_KEY'
  | 'DASHSCOPE_API_KEY';
```

修改 `edgespark.toml`：bind `MEDIA` R2 bucket（如果还没 bind）。

### R2 lifecycle policy

```toml
# edgespark.toml or R2 dashboard
[[r2_buckets.lifecycle]]
prefix = "images/"
expire_days = 1
```

24 小时后自动删，不用 server 主动 delete（save 一次 RPC）。

## Open questions

1. **NSFW moderation 用哪个具体模型？**
   - Cloudflare Workers AI docs 上能直接用的 image classifier 列表
   - 准确率如何 / 是否有中国语义偏差（比如 traditional 服饰被误判）
   - 需要做 PoC

2. **Persona drift 怎么测？**
   - 准备 20 张 sample 图（猫、风景、food、自拍、abstract 艺术、PHM
     fan art 等），跑一遍看 Rocky 回复的角色感
   - 如果 drift 严重，加强 persona prompt + 实验 few-shot example

3. **要不要 cache vision response？**
   - 同一张图发多次（reload chat 历史）应该读 cache 还是 re-call vision？
   - 倾向：每次 chat 调用都重新做（图 24h 后过期，缓存意义不大）；UI
     展示历史时只渲染过去的回复，不重新 call vision

4. **图像消息怎么持久化？**
   - 选项 A：图片删了之后聊天历史只剩文字回复（用户看不回去图）
   - 选项 B：图片永久存储（成本/隐私问题）
   - 选项 C：图片存 7 天（折中）
   - 倾向 v1 用 A（图 24h 删），如果用户抱怨再升级

5. **Lv2+ 是否触发 Grace 客串看图？**
   - 比如照片是地球花卉 → Grace（生物老师）会有反应
   - 倾向 v1 不做（增加复杂度），Lv2+ feedback 后再加

## Verification / 验证 & 测试方案

### Vendor 实验（最先做）

- [ ] curl 直接调 Qwen-VL-Max with 一张猫的照片 + Rocky persona prompt
- [ ] 看输出是不是有"Rocky 在看"的感觉，还是 OCR 式
- [ ] 实测 zh / en / ja prompt 下输出都是对应语言
- [ ] 实测延迟（首 token 时间）

### 本地手动

- [ ] Chrome 桌面：选图 → 缩略图预览 → 删除 → 重新选 → 发送 → Rocky 回复
- [ ] Safari 桌面：同上
- [ ] 上传 5MB 图：客户端压缩到 < 2MB
- [ ] HEIC 文件：自动转 JPEG
- [ ] 上传 PDF：拒绝 + 提示
- [ ] 上传一张色情图：moderation 拒绝
- [ ] 网络中断：UI 友好错误

### Persona 质量验证（人工）

跑 20 张 sample 图：
- 5 张日常物品（猫、咖啡、键盘）
- 5 张风景（街景、自然）
- 5 张人物（不同情感）
- 3 张 abstract / 艺术
- 2 张极端：模糊、空白

人工 review 每个回复：
- [ ] 没有 "this image shows..." 句式
- [ ] 没有 "As an AI..." 漏 persona
- [ ] 长度合规（1-3 段）
- [ ] 用了 [Translation] 格式

### iPhone 真机测试

- [ ] iPhone 相册选 HEIC 照片 → 正常上传
- [ ] iPhone 相机直接拍 → 正常上传
- [ ] 4G 网络下完整流程

### Production 烟测

```bash
# 端点存在 + 401
curl -i -X POST https://teaching-collie-6315.edgespark.app/api/chat-with-image
```

## Rollout

1. **Vendor 实验**：curl Qwen-VL-Max + 几张样本 → 评估 persona 输出
2. NSFW moderation PoC：选 Workers AI 模型 + 实测
3. R2 bucket 配置 + lifecycle policy
4. `/api/chat-with-image` endpoint
5. 客户端压缩 + HEIC 转换
6. ImageUploadButton + 预览 UI
7. Persona prompt 迭代
8. 真机测试
9. 独立 code review
10. 合并 → 部署 → 烟测

**回滚方案**：feature flag 控制 📷 按钮显示。新端点不影响现有 `/api/chat`。
R2 bucket 如果出问题，禁用 feature flag 即可。

## Effort breakdown

| 步骤 | 估时 |
| --- | --- |
| Vendor 实验 + persona 调参 | 0.75d |
| NSFW moderation PoC + 选型 | 0.5d |
| `/api/chat-with-image` + R2 集成 | 1d |
| 客户端压缩 + HEIC + 上传 UI | 0.75d |
| Persona prompt 迭代 + 20 张图人工 review | 0.5d |
| 真机测试 + i18n + polish | 0.5d |
| **合计** | **3-4d** |

## 相关 secret / 配置

| 项 | 状态 |
| --- | --- |
| `DASHSCOPE_API_KEY` | 🟡 与 #07 共享 |
| R2 bucket bind 到 `MEDIA` | 待确认 |
| `defs/runtime.ts` SecretKey 类型 | #07 已加，复用 |
| Workers AI binding（NSFW moderation）| 待确认 |
| R2 lifecycle policy | 待配置 |
