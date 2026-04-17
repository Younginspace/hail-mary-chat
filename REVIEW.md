# Ultrareview — hail-mary-chat @ feat/edgespark-migration

_Completed 2026-04-17. HEAD = b9d299c. Scope = main..HEAD (24 commits, 165 files, +21k/-5.8k lines)._

Method: 4 parallel reviewers (auth+security / reliability+data / frontend+UX / build+deploy) → one round of main-agent pushback with direct code verification → consensus. Only findings that survived cross-examination are kept below.

---

## 🔴 CRITICAL — 合并 / CNAME 翻转前必修

### C1. `edgespark.toml:13` 的 `migration_branch` override 带着合并到 main 会锁死迁移
`migration_branch = "feat/edgespark-migration"` 是 dev-only 开关。合并到 main 后，这个分支名不再是默认分支 → `edgespark db migrate` 在部署流程里将不再正确运行（参考 `server/CLAUDE.md`：migrate 必须跑在默认分支上）。

**修:** 合并到 main 时直接删掉 `[db]` 整段（或同步改成 `migration_branch = "main"`）。

### C2. `pending_level_up` 非原子 consume — 用户可能看到两次升级仪式
`server/src/index.ts:792–806` 是经典 read-then-write：两个 `/api/session/start` 并发（双 tab / 双击）会两边都读到 `pending_level_up=2`，两边都弹 Ceremony，两边都清零。

**修:** CAS + RETURNING：
```sql
UPDATE users SET pending_level_up = NULL
WHERE id = ? AND pending_level_up IS NOT NULL
RETURNING pending_level_up, image_credits, music_credits, video_credits;
```
返回为空就跳过仪式，两个 concurrent 调用幂等。

---

## 🟠 HIGH

### H1. Consolidation job 在 `status='running'` 时 worker 崩溃会永久孤儿化
`server/src/consolidate.ts:493–548` — `runConsolidationJob` 设置 `status='running'` → 调 `consolidateSession` → 成功写 `done` / 失败写 `pending|failed`。而 `retryStuckConsolidationJobs:562–567` 只扫 `status='pending'`。mid-extraction 崩溃留下的 `'running'` 行永远不会被重试 → 该 session 的 memory 静默丢失。

**修:** 扫描条件加入 `status IN ('pending','running') AND updated_at < cutoff`；或在 sweeper 开头把 stale 的 running 迁为 pending。

### H2. `isDisposableEmail` 只能匹配裸域名，subdomain / typosquat / punycode 全绕过
`server/src/index.ts:114–119` 拿 `slice(at+1).toLowerCase()` 在 Set 里精确查。仍然绕过：
- 子域：`foo@x.mailinator.com`
- 错拼域：`foo@mailinator.co`
- punycode / homograph：`xn--mlinator-*`

**修:** 归一化：punycode → ASCII；拆分 registrable-domain 逐级匹配（检查每个后缀如 `x.mailinator.com`, `mailinator.com`）。

### H3. `streamChat` 没有 AbortController
`web/src/utils/api.ts:39–160` — `useChat` 里的 `abortRef` 只门控 `onChunk` 回调，底层 fetch + reader 继续读直到 MiniMax 关流。用户中途离开页面 / 切 tab → 一个 10–30s 的 zombie stream（有界但真实）。

**修:** `streamChat` 接受 `AbortSignal`；`useChat` cleanup / 新一轮 send 时 abort 上一个。

### H4. `useAuthSession` 先 setSession 再 adoptDevice，首条消息有 race
`web/src/hooks/useAuthSession.ts:57–65` — 会话回调里 **同步** `setSession(next)` + `setLoading(false)`，然后 `adoptDevice()` fire-and-forget。消费方看到 `isAuthenticated=true` 就可能立即触发首条 chat send，server 端 memory/rapport 查询看不到新用户。

**修:** 加独立的 `adopted` 状态；仅当 `adoptDevice` resolve 后翻。UI 侧用 `adopted` 门控发送。

---

## 🟡 MEDIUM

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| M1 | `server/src/index.ts:1617–1629` | Favorites 100-cap 非原子，并发可溢出到 101 | `INSERT ... WHERE (SELECT COUNT ...) < cap` 或预留 partial index |
| M2 | `server/src/index.ts:874–896` | `/api/session/message` 的 check 与 insert 非原子；与 `/api/session/end` race 可能把消息写进已结束 session | 把 `ended_at IS NULL` 一起查 |
| M3 | `server/src/consolidate.ts:295–316` | `forget`/`supersedes` 用 content 字符串匹配，空白/标点漂移会失配 | 让 extractor 返回 memory.id，按 id 更新 |
| M4 | `server/src/consolidate.ts:365–383` | rapport delta + credit grant 不在同一 batch | `db.batch([...])` |
| M5 | `server/src/index.ts:2272–2273` | Admin token 长度有 timing leak | 把 length 比较合并到同一个 diff 累加器 |
| M6 | `web/src/utils/exportChat.ts:99–134` | 长对话 html2canvas 可能 OOM 且无用户反馈 | 进度提示 + 分段或回退到 MD |
| M7 | `web/src/styles/terminal.css` 多处 | 断点 360/600/640/767/768 混用，与 JS `innerWidth>=768` 脱钩 | 统一常量（CSS 变量 + 同值 JS 常量）|
| M8 | `web/src/components/ChatInterface.tsx:461–487` | 信用额耗尽时按钮状态刷新滞后，用户会空点一次 | 402 后立即本地置 `voiceCredits=0` |
| M9 | `web/src/hooks/useChat.ts:202–225` | 服务端 strip 失败时 `[GIFT:...]` 会在正文短暂可见 | onChunk 阶段就跑 `extractGift` 清理 |
| M10 | `web/src/i18n/index.ts:487` | 缺 key 静默回落到原始字符串；语言不持久化 | 编译期强类型 + localStorage persist |
| M11 | `server-legacy/` | Express MVP 残留，无归档标记 | `git rm -rf server-legacy/` |

---

## 🟢 NITS（一行一条）

- `LevelUpCeremony` / `LoginModal` 没 `role="dialog"` / `aria-modal`；Esc 不响应
- `StartScreen` / `LevelUpCeremony` 没尊重 `prefers-reduced-motion`
- `LoginModal` 自动关闭的计时器在手动关闭时未清除
- `/api/chat` 的 memory-ownership 检查失败走 try/catch-swallow，无日志
- 根 `package.json` 无 scripts（EdgeSpark CLI 是约定入口，非问题）
- `web` 用 `~5.9.3` vs `server` 用 `^5.9.3`，今天同版，未来可能漂
- `.env` 被 tracked 成空文件
- `.gitignore` 写了 lockfile 忽略但实际 commit 了 lockfile —— 二选一
- `useChat.ts:64` `error` state 声明但未读

---

## ✅ 经受住审视的好决策

- `/api/adopt-device` 的 auth-first 分支（原 reviewer A 声称的 device-id 跨用户 takeover 在这里被挡住，架构是对的）
- 服务端 `buildGiftStrippingTransform`（SSE TransformStream）— 客户端不需信任正文里的 `[GIFT:...]`
- `runConsolidationJob` + `consolidation_jobs` 表的 retry / dead-letter 框架（除 H1 那一个边界 case 外）
- 全局 TTS 超限时即时退款到 `voice_credit_ledger`
- Favorites UNIQUE 约束做 belt-and-suspenders
- 所有 MiniMax / ADMIN_TOKEN 都只在 worker，没有 `VITE_` 前缀泄漏

---

## Round 2 里被撤回的一类（噪音，记录备考）

- A1 device-id 跨用户 takeover —— auth-first 分支已挡
- A5 rate-limit bypass —— auth-first 分支不创建新行，无需计数
- A4 跨用户 prompt injection —— existingMems 单用户 scope
- B1 idle-zero race —— "已开始使用过就不 zero" 是设计意图
- B3 重复抽取方向反了 —— 实际是 H1 的 running 孤儿化
- C2 blob URL leak —— 大部分路径都有 cleanup
- C3 TTS stale closure —— dep 链会把 skipTTS 传上来
- C5 favorites rollback —— 本来就没做乐观更新

## 执行顺序

1. **合并到 main 之前立即:** C1 + C2
2. **CNAME 翻转前:** H1–H4
3. **合并后 48h 内:** M1–M11
4. **有空再扫:** NITS
