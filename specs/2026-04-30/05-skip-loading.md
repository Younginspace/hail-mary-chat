# Spec 05 — 跳过 loading（返回用户即点即用）

**Status**: Planned
**Priority**: P0
**Effort**: 1-1.5 days
**Window**: W1（跟 #01 并行做，零冲突）
**Dependencies**: 无

---

## 用户需求背景

来自 owner（基于真实用户体验抱怨）：

> "非第一次启动对话的用户，可以跳过 loading 等待环节，一点按钮就立刻进入
> 的聊天窗口（最多遵循丝滑的交互动画）。"

**为什么这是 P0**：返回用户每天可能开 app 多次，每次看 spinner 是 cumulative
annoyance；纯前端工作，零后端依赖，无 vendor 风险；可以跟 #01 并行做。

## Goals

1. 返回用户点 app 图标 → < 200ms 内进入聊天界面（直接看到 Rocky 开场白）
2. 不再有 splash + spinner 阻塞首屏
3. 进入动画"丝滑"：参考 Raycast 那种"瞬间打开"的反应感
4. 第一次启动用户的体验完全不变（首启走完整 onboarding）

## Non-goals

- ❌ 优化 JS bundle 加载时间（已经 minified + CDN'd）
- ❌ Service Worker / 离线支持（v1 不做）
- ❌ 改变 app 图标 / PWA install 流程
- ❌ 把首启 onboarding 也 skip（首启一定要走完整流程）

## User stories

- **As a 已经聊过的用户**: 我点 app 图标想立刻看到 Rocky，不要再看转圈
- **As a 网络一般的用户**: 即使 4G 有点慢，UI 也要先出来，让我感觉 app 已
  经响应了，不是死了

## Functional requirements

- **FR-1** 检测"返回用户"的判定：`localStorage` 含有 `callsign` + 已认证
  token → 视为返回用户
- **FR-2** 返回用户 → 跳过 splash → 直接渲染 ChatInterface 外壳 + Rocky
  greeting（用 cached lang/level/callsign）
- **FR-3** 后台并行触发 `/api/me`、`/api/session/start`、history fetch
- **FR-4** 后台请求成功 → silently 更新 UI 状态（lang/level 变化无可见跳动）
- **FR-5** 后台 `/api/me` 返回 401 → 弹回登录态（auth 失效场景兜底）
- **FR-6** 第一次启动用户检测：`localStorage` 没 `callsign` → 走原有 splash
  + onboarding 流程，体验不变
- **FR-7** 进入动画：opacity 0→1 + translateY(4px → 0)，**ease-out 200ms**

## Non-functional requirements

- **首屏渲染时间**：从点 app 到看到 ChatInterface < 200ms（用 React DevTools
  Profiler 验证，不靠肉眼）
- **乐观渲染的一致性**：cached level 跟 server level 不一致时，UI 静默更新，
  用户**不应**看到等级跳变（除非是真的升级了，那应该有 celebration UI）
- **可访问性**：尊重 `prefers-reduced-motion`，开启时跳过 fade animation 直接显示

## 技术方案

### 当前流程（推测）

```
点 app
  ↓
JS bundle parse
  ↓
React mount → splash screen
  ↓
GET /api/me (await)        ← blocking
  ↓
POST /api/session/start (await)  ← blocking
  ↓
GET /api/session/<id>/history (await)  ← blocking (after PR #34)
  ↓
渲染 ChatInterface
```

返回用户的可见时间：**~JS parse + 3 个 RTT**。在 4G 下可能 1-3 秒。

### 改完后

```
点 app
  ↓
JS bundle parse
  ↓
React mount
  ↓
检查 localStorage：有 callsign？
  ├─ 有 → 立即渲染 ChatInterface（用 cached state）
  │       └─ 同时并行触发 /api/me, /api/session/start, history （后台 Promise.all）
  │       └─ 后台请求完成后，setState 静默更新（差异部分）
  │
  └─ 无 → 走原 splash + onboarding 流程
```

返回用户可见时间：**~JS parse + 0 RTT**。预计 < 200ms。

### 状态合并策略

cached state 跟 server state 可能不一致。三种处理：

1. **完全一致** → 无操作
2. **server 更新了**（如 level 升了、新 history 条目）→ silently merge
3. **server 矛盾**（如 callsign 不同、token 失效）→ 走 reset 路径（清
   localStorage + 弹回 onboarding 或登录）

### Frontend changes

修改：
- `web/src/main.tsx` 或入口组件：判断"返回用户"分支
- 入口组件：把原本 sequential await 改成并行 Promise.all + 乐观渲染
- `web/src/hooks/useChat.ts`：允许 `initialHistory: undefined` 时先渲染，等 history
  到了再 splice（这部分 PR #34 + #35 已经接近了，要确认）

新增：
- `web/src/utils/cachedIdentity.ts`：封装 localStorage cached state 读写
  + 跟 server 的 reconcile 逻辑

CSS：
- 进入动画用 CSS transition（不用 framer-motion 避免 main thread 抢资源）
- `transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), transform 200ms cubic-bezier(0.23, 1, 0.32, 1);`
- `@media (prefers-reduced-motion: reduce) { transition: none; }`

### Server changes

**零**。这是纯前端的状态机重排，所有 API 端点不变。

## Open questions

1. **localStorage 里的 cached state 包括哪些字段？**
   - 必须有：`callsign`, `lang`, `userKey`（auth token）
   - 可选有：`level`, `voiceCredits`, `lastSessionId`
   - 越多越能乐观渲染但 reconcile 越复杂；倾向**只缓存身份相关字段，
     业务字段（credits/level）等 server 回应**——如果发现某个字段后台回应
     太慢导致 UX 问题再 case-by-case 加缓存

2. **history 在乐观渲染里怎么处理？**
   - 方案 A：先只渲染 greeting，history 异步到了再 splice 进列表（已有 history-divider 机制，符合 PR #34 设计）
   - 方案 B：乐观渲染时不显示 history 区域，等 server 数据到了一次性显示
   - **倾向 A**，更符合 PR #34 设计意图

3. **token refresh 怎么办？**
   - 如果后台 `/api/me` 401，是否 silently refresh token 一次再决定弹回登录？
   - 这取决于现有 auth 流程是否有 refresh token 机制——需要 review `server/src/`
     找答案

## Verification / 验证 & 测试方案

### 本地手动

- [ ] 第一次启动用户（清 localStorage）：完整 splash + onboarding 流程不变
- [ ] 返回用户路径：清 service worker cache 但保留 localStorage → 点 reload
  → 应在 < 500ms 内看到 ChatInterface（含 cached greeting）
- [ ] 节流到 Slow 3G（Chrome DevTools） → 仍然立即看到 UI；history 慢慢出现
- [ ] localStorage 里的 token 篡改成无效 → 后台 `/api/me` 401 → UI 应该 graceful
  弹回登录态而不是 stuck

### Playwright 自动化

```ts
test('returning user skips loading', async ({ page }) => {
  // 第一次完整流程（建立 cached state）
  await page.goto('/');
  await completeOnboarding(page);

  // 模拟"返回用户"——刷新但保留 localStorage
  await page.reload();

  // 200ms 内 ChatInterface 应已渲染
  const start = Date.now();
  await page.waitForSelector('[data-testid="chat-interface"]');
  expect(Date.now() - start).toBeLessThan(500);  // 含 reload + parse 余量
});
```

### Production 烟测

```bash
# 抓 prod 的 main JS chunk，确认乐观渲染逻辑被打包进去
JS_URL=$(curl -s https://teaching-collie-6315.edgespark.app/ | grep -oE '/assets/index-[^"]+\.js' | head -1)
curl -s "https://teaching-collie-6315.edgespark.app$JS_URL" | grep -c 'cachedIdentity\|skipLoading'
```

### 真机测试

- [ ] iPhone Safari 上的"返回用户体验"——熟人测一下，问"是不是更快了"
- [ ] Android Chrome 同样测试

## Rollout

1. 写 cachedIdentity util + entry component 重排
2. 本地 + Playwright 验证不破坏首启流程
3. 独立 code review subagent
4. 合并 → 部署
5. 烟测：清 localStorage 走 onboarding；保留 localStorage 走快路径

**回滚方案**：纯前端改动，revert PR 即可恢复。乐观渲染的判断收窄成
`if (false)` 也能秒级 disable。

## Effort breakdown

| 步骤 | 估时 |
| --- | --- |
| 入口组件状态机重排 + cachedIdentity | 0.5d |
| 进入动画（CSS + reduce-motion）| 0.25d |
| Auth 失败兜底 + reconcile 逻辑 | 0.25d |
| Playwright + 真机测试 | 0.25-0.5d |
| **合计** | **1-1.5d** |

## 设计 eng 注意事项（emil 教条）

- ❌ 绝不用 `ease-in`（首屏感觉迟钝）
- ❌ 绝不用 `scale(0)` 起手（凭空冒出来不自然）
- ✅ 用 `ease-out cubic-bezier(0.23, 1, 0.32, 1)` 200ms
- ✅ opacity + translateY(4px → 0) 组合，比纯 fade 更"丝滑"
- ✅ 尊重 `prefers-reduced-motion`
