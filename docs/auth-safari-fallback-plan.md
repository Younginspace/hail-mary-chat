# Plan: Safari-proof auth fallback (token-in-header) + adaptation if EdgeSpark fixes the cookie

**Status:** contingency plan — DO NOT implement yet. Build only if EdgeSpark
doesn't fix the iOS-Safari session-cookie regression (see
`docs/edgespark-safari-cookie-bug.md`).
**Author:** (Claude) 2026-05-31
**Owner decision needed before building:** yes (security tradeoff §6 + the §7
prototype gate).

---

## 0. Why this plan exists

iOS Safari (and other WebKit clients) stopped accepting EdgeSpark's better-auth
session cookie ~2026-05-15. Server + cookie are fine for Chrome/curl; it's a
WebKit cookie-acceptance regression. We can't change the cookie (platform-
managed) and the platform gates `/api/*` by that cookie before our code runs.
This plan removes our dependence on the cookie so login works on every browser.

### Hard constraints (all verified)

1. The better-auth session **token is never exposed to client JS** — sign-in /
   sign-up return an **empty body**; the token lives only in the `HttpOnly`
   `__Secure-better-auth.session_token` cookie. So the client cannot "just read
   the token." (Verified by curl: empty body + Set-Cookie only.)
2. The platform **gates `/api/*`** by that cookie (returns
   `401 {"error":"UNAUTHENTICATED"}` before our handler). It does **NOT** gate
   `/api/public/*` or `/api/webhooks/*`.
3. On `/api/public/*` the platform does **not** populate `auth.user` even when a
   valid cookie is present — so there we must do our **own** session validation.
4. We **can** read the system table `es_system__auth_session` via Drizzle
   (`token`, `userId`, `expiresAt`). The cookie value is `"<token>.<hmacsig>"`;
   the `<token>` part is exactly `es_system__auth_session.token`.
5. EdgeSpark workers can make **outbound `fetch()`** (we already call MiniMax /
   DashScope) and can **read `Set-Cookie` from a fetch response server-side**
   (HttpOnly only restricts browser JS, not server fetch).

## 1. Core idea

Stop relying on the browser to send the cookie. Instead:

- A **server-side login proxy** logs the user in via better-auth, reads the
  `Set-Cookie` **server-side**, and hands the session token to the client in
  the **response body**.
- The client stores the token in **`localStorage`** (Safari has no problem with
  localStorage) and sends it on every request as an **`X-Session-Token`** header.
- Authed endpoints move to **`/api/public/*`** (ungated) and run **our own auth
  helper**, which accepts the token from **either** the `X-Session-Token` header
  **or** the cookie, validates it against `es_system__auth_session`, and
  resolves our `users` row.

One credential carrier (header) that works everywhere; the cookie still works
as a second carrier for clients where it's fine. No platform change required.

```
┌── Login (Safari-proof) ───────────────────────────────────────────┐
│ client → POST /api/public/login {email,password}                   │
│ worker → fetch better-auth sign-in (server→server)                 │
│ worker ← reads Set-Cookie, extracts __Secure-...session_token=VALUE │
│ worker → { token: VALUE, me:{...} }   (in BODY)                    │
│ client → localStorage.setItem('sessTok', VALUE)                    │
└────────────────────────────────────────────────────────────────────┘
┌── Every authed call ──────────────────────────────────────────────┐
│ client → /api/public/<endpoint>  header X-Session-Token: <VALUE>   │
│ worker → getAuthedUserByToken(): token→es_system__auth_session     │
│          → userId → our users row → proceed                        │
└────────────────────────────────────────────────────────────────────┘
```

## 2. Server changes

### 2a. `getAuthedUserByToken(c)` — new auth helper (replaces cookie gate on the moved routes)
```ts
// Accepts the session token from the X-Session-Token header OR the
// __Secure-better-auth.session_token cookie. Validates against the
// better-auth session table directly. Returns our users row or null.
async function getAuthedUserByToken(c): Promise<{ user_id, callsign, auth_user_id } | null> {
  const raw =
    c.req.header("x-session-token") ||
    parseCookie(c.req.header("cookie"), "__Secure-better-auth.session_token") ||
    "";
  if (!raw) return null;
  const token = raw.split(".")[0];               // strip the ".<hmacsig>" suffix
  if (token.length < 20) return null;            // high-entropy guard
  const now = Date.now();
  const sess = await db.select({ userId: auth_session.userId, exp: auth_session.expiresAt })
    .from(auth_session).where(eq(auth_session.token, token)).limit(1);
  if (!sess.length || sess[0].exp < now) return null;
  // resolve OUR users row by auth_user_id (same AUTH-FIRST lookup adopt uses)
  const row = await db.select({...}).from(users)
    .where(eq(users.auth_user_id, sess[0].userId)).orderBy(asc(users.created_at)).limit(1);
  return row.length ? { user_id: row[0].id, callsign: row[0].callsign, auth_user_id: sess[0].userId } : null;
}
```
Notes:
- `auth_session` = the pulled `es_system__auth_session` table (import from the
  generated sys schema). Confirm it's queryable via `db` (it should be — it's in
  `__generated__/sys_schema.ts`).
- Security boundary = guessing a ≥32-char random token in the DB. We deliberately
  do NOT re-verify the HMAC signature (would need the better-auth signing secret,
  which we don't have). DB-existence + expiry is sufficient.

### 2b. `/api/public/login` + `/api/public/register` — server-side proxy
```ts
app.post("/api/public/login", async (c) => {
  // rate-limit (reuse register_rate_limit / a per-IP cap)
  const { email, password } = await c.req.json();
  // server→server call to better-auth (try same-origin first; fall back to the
  // canonical edgespark.app host if the worker can't call its own hostname)
  const r = await fetch(`${AUTH_ORIGIN}/api/_es/auth/sign-in/email`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return c.json({ error: "invalid_credentials" }, 401);
  const setCookie = r.headers.get("set-cookie") || "";
  const token = matchCookie(setCookie, "__Secure-better-auth.session_token");
  if (!token) return c.json({ error: "login_no_token" }, 502);
  return c.json({ token /* full value */ });
});
```
- `AUTH_ORIGIN`: prototype with the request origin; if the worker can't fetch
  its own public hostname (loop), use the canonical `*.edgespark.app` origin
  (add as a Var). **This is the #1 thing to verify — see §7.**
- `register` mirrors this (sign-up then sign-in, or sign-up returns a cookie too).
- Never log `email`/`password`/`token`.

### 2c. Re-home authed endpoints to `/api/public/*`
Move (or alias) every route that currently calls `getAuthedUser()`:
`me, adopt-device, session/start, session/end, session/message, chat, tts,
voice-credits, favorites (+add/remove), generate-media, gifts, asr (PR#40),
chat-image (PR#41)`.
- Mechanical: change the path prefix `/api/...` → `/api/public/...` and swap
  `getAuthedUser()` → `getAuthedUserByToken(c)`.
- Keep `app.onError` + all the rate-limit/quota CAS logic unchanged.
- `/api/public/health` already exists; keep `/api/webhooks/*` as is.

### 2d. Logout
`/api/public/logout` → optionally delete the `es_system__auth_session` row for
the token; client clears `localStorage`.

## 3. Client changes (`web/`)

- **`lib/edgespark.ts` / a new `authClient.ts`**: replace `esClient.auth.signIn`
  /`signUp` usage in `useAuthSession` with calls to `/api/public/login`
  /`register`; on success store `token` in `localStorage('rocky_sess')`.
- **One fetch wrapper** `apiFetch(path, init)` that injects
  `X-Session-Token: localStorage.rocky_sess` and points at `/api/public/*`.
  Replace the direct `fetch(`${API_BASE}/api/...`)` calls in `sessionApi.ts`,
  `api.ts`, `asr.ts`, image upload, `useAuthSession` with `apiFetch`.
- **`useAuthSession`**: `me`/adopt now go through `apiFetch`; `signOut` clears
  localStorage + calls logout. The single-AuthProvider + dedupe work we already
  did stays.
- **deviceId** header (`X-Device-Id`) unchanged.

## 4. What does NOT change
- The whole rapport/affinity/consolidation/credits server logic.
- better-auth still does the actual credential check + creates the session row
  (we just relay its token). We are NOT reimplementing password hashing.
- The DB schema (no migration — we only READ `es_system__auth_session`).

## 5. Testing
1. **Prototype gate first (§7).**
2. curl: `/api/public/login` returns a token; `/api/public/me` with
   `X-Session-Token` returns the right user.
3. **Real WebKit** (the whole point): borrow an iPhone / use BrowserStack iOS
   Safari → confirm login + chat now work with the cookie disabled / ITP on.
4. Regression: desktop Chrome still works (cookie OR header path).
5. Token expiry → 401 → client re-login.
6. Wrong password / no token / expired token → clean 401s.

## 6. Security tradeoffs (owner must accept)
- **localStorage token is readable by JS → XSS would leak the session.** The
  HttpOnly cookie is not. Mitigations: (a) keep XSS surface near-zero — audit
  for `dangerouslySetInnerHTML` / unescaped user content (chat renders via React
  text + a markdown component → audit that component); (b) short session TTL;
  (c) `/api/public/logout` invalidates server-side. Net: a modest downgrade vs
  HttpOnly, standard for token-based SPAs.
- **CSRF**: token-in-header is actually *safer* than cookies (no ambient
  credential; attacker can't read localStorage cross-origin).
- **Rate-limit `/api/public/login`** (per-IP) to keep it from being a
  password-guessing oracle — reuse the register CAS.
- Token is a bearer credential → never log it; always HTTPS (it is).

## 7. Prototype gate (do this in ~1h BEFORE committing to the full migration)
The whole plan hinges on TWO unknowns — verify cheaply first:
1. **Can the worker fetch the better-auth sign-in endpoint and read its
   `Set-Cookie`?** Add a temporary `/api/webhooks/probe-login` that does the
   server→server sign-in for a test account and returns whether it got a token.
   If same-origin self-fetch loops/blocks, try the canonical `edgespark.app`
   origin. If neither works → this plan is dead; escalate harder to EdgeSpark.
2. ~~**Can `db` SELECT `es_system__auth_session` by `token`?**~~ ✅ **CONFIRMED
   2026-05-31.** `esSystemAuthSession` is exported in
   `src/__generated__/sys_schema.ts` with `token` (notNull, **UNIQUE-indexed**
   → O(1) lookup), `userId`, `expiresAt`. So `getAuthedUserByToken` is viable.
If #1 passes too → green-light the migration (§2–§3). If #1 fails, the only path
is the platform fix.

## 8. Effort & rollback
- **Effort:** ~1 day (½ day server: helper + login proxy + re-home ~12 routes;
  ½ day client: authClient + apiFetch wrapper + wire 6 files; + testing).
- **Rollback:** keep it on a branch; the change is additive (new
  `/api/public/*` routes + new client auth path). The old `/api/*` cookie routes
  can stay during rollout. Revert = point the client back at `/api/*` + the
  cookie SDK.

---

## 9. Adaptation — if EdgeSpark FIXES the cookie

Depending on how this plan was rolled out:

### Case A — EdgeSpark fixes it BEFORE we build this
Do nothing. Keep cookie-based auth. This plan stays on the shelf. (Best case.)

### Case B — We shipped the token fallback, then EdgeSpark fixes the cookie
The token path is browser-agnostic and keeps working, so there's **no urgent
action** — but localStorage tokens are a security downgrade, so we want to
return to the HttpOnly cookie once it's reliable. Two options:

- **B1 — Self-healing dual-carrier (recommended if we build §2a as written).**
  `getAuthedUserByToken` already accepts the token from the **cookie OR** the
  header. Once Safari accepts the cookie again, those clients send it and we
  read it the same way — **no code change, it just works**. We then
  *optionally* clean up later: stop issuing/storing the localStorage token
  (drop the login proxy, go back to the SDK cookie login), keep endpoints on
  `/api/public/*` reading the cookie, OR fully revert to `/api/*` (Case C).

- **B2 — Hard revert to platform cookie auth.** Point the client back at the
  `/api/*` (cookie-gated) endpoints and the `esClient.auth` SDK login; remove
  the `/api/public/*` aliases, the login proxy, `getAuthedUserByToken`, and the
  localStorage token. This restores HttpOnly-cookie security and the platform's
  built-in gate. Because the fallback was built additively (§8), this is a clean
  revert of the fallback commits.

### Case C — EdgeSpark changes the cookie ATTRIBUTES (e.g., adds `Partitioned`, changes SameSite/prefix)
Cookie-based auth resumes working on Safari with **no change on our side** (we
don't hardcode cookie attributes anywhere). If we'd shipped the token fallback,
do B1/B2 to retire it. Just re-test iOS Safari to confirm.

### Recommended posture
Build §2a so the auth helper reads **cookie OR header** from day one (B1). That
makes the rollout self-healing: Safari-broken users use the header token;
everyone else (and all users once EdgeSpark fixes it) use the cookie; and we can
retire the token path on our own schedule without an emergency. The only thing
to actively decide later is whether to fully revert to `/api/*` for the
platform's built-in protections (Case C/B2) or stay on the dual-carrier
`/api/public/*` (simpler, one auth path, slightly less "platform-native").

## 10. Decision checklist before building
- [ ] EdgeSpark has had a fair chance to fix it (give them the bug report + ~a few days).
- [ ] Owner accepts the localStorage-token security tradeoff (§6).
- [ ] §7 prototype passes (worker→auth fetch reads Set-Cookie; db reads auth_session).
- [ ] Confirm the markdown/chat renderer has no XSS sink (§6).
