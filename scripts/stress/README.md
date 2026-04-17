# Stress Harness — hail-mary-chat

零依赖 Node（>= 20）脚本，聚焦在 REVIEW.md 里修过的 race + 速率限制，不烧 MiniMax。
每个脚本自成一套，可单独跑。`run-all.mjs` 按顺序串起来并给最终 summary。

## 快速决策表

| 场景 | 要 COOKIE? | 要 ADMIN_TOKEN? | 烧 MiniMax? | 说明 |
|---|---|---|---|---|
| `01-rate-limit.mjs` | ✗ | ✗ | ✗ | 验证未授权 burst 走 401，不意外消耗 rate-limit 名额 |
| `02-disposable-email.mjs` | ✗ | ✗ | ✗ | 纯 offline 逻辑镜像，验证 subdomain / 大小写 / 尾点 / 合法域 |
| `03-session-start-cas.mjs` | ✓ | ✗ | ✗ | 验证 `pending_level_up` CAS（C2）|
| `04-favorites-cap.mjs` | ✓ | ✗ | ✗ | 验证 favorites 100 cap 原子（M1）|
| `05-message-end-race.mjs` | ✓ | ✗ | ✗ | 验证 session/message vs session/end race（M2）|
| `06-admin-token-timing.mjs` | ✗ | ✗ | ✗ | admin token 等时比较 sanity（M5）|

**没有 MiniMax / TTS / chat 压测。** 那些路径每个请求都烧 token + 占用 11k/day
全局配额，不适合 CI-style 反复跑。如果真要烧，单独写一轮。

## 准备

1. **目标 URL**：本机就 `edgespark dev`（默认 `http://localhost:3001`），远端就传 `TARGET=https://xxx.edgespark.app`。
2. **COOKIE**（03/04/05 需要）：浏览器登录一个账号，devtools → Application → Cookies →
   复制 `better-auth.session_token=...`（连键带值的整段）。把整行作为 `COOKIE` 环境变量传入。

## 跑法

```bash
# 全量（本地，无 cookie 跳过 03/04/05）
node scripts/stress/run-all.mjs

# 全量（远端 + cookie）
TARGET=https://teaching-collie-6315.edgespark.app \
  COOKIE='better-auth.session_token=eyJhbGc...; Path=/; ...' \
  node scripts/stress/run-all.mjs

# 单独跑一个
node scripts/stress/04-favorites-cap.mjs
```

## 退出码

- `0` = PASS
- `1` = WARN（非致命，值得看一眼）
- `2` = FAIL（有 regression，别 ship）

`run-all.mjs` 只在任一 scenario 返回 `>=2` 时退非零。

## 结果归档

每轮压测出问题就把输出贴进 `RESULTS.md`（同目录）附日期和 commit sha。

## 注意事项

- **写路径是 D1**。反复跑 04 会 seed 很多 favorites，记得手动清理或者换 cookie（不同用户）。
- **Cloudflare 会把同进程源 IP 视作单一 cf-connecting-ip**，所以 01 的 burst 是合规的
  "一个客户端发 N 次"，不是"N 个不同 IP"。
- **本机 `edgespark dev`** 通常不启 D1 的真正生产限制，race 窗口比远端窄；远端更能暴露
  问题。CI 用本机做烟雾，真正验证上远端。

## 后续可加的项

- `07-chat-smoke.mjs` ——   单次 `/api/chat` 冒烟（会烧 MiniMax，单请求可控）
- `08-tts-cache-hit.mjs` — 同 text 两次 `/api/tts`，第二次必须 R2 缓存命中（无 MiniMax 消耗）
- `09-load-curve.mjs`    — 10 分钟 mid-load 曲线（给正式上线前的容量验证）
