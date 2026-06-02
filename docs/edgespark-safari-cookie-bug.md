# Bug report: better-auth session cookie not accepted by iOS Safari / WebKit → users can't stay logged in

**Project:** hail-mary-chat (`858a0e42-ad2e-4070-b2bc-30a17bf05aa0`)
**Reporter:** project owner
**Severity:** High — affected users cannot use the app at all on the browser they have.
**Date:** 2026-05-31

---

## Summary

On EdgeSpark email/password auth, **sign-in succeeds but the session cookie is
not sent on the immediately-following `/api/*` request** for users on
**non-Chromium WebKit browsers** (iOS Safari, iOS DuckDuckGo, HarmonyOS Huawei
Browser/ArkWeb). The platform auth gate then returns `401 {"error":"UNAUTHENTICATED"}`
*before our handler runs*, so the user appears to log in but every authed call
fails. The same flow works perfectly in Chrome (desktop + Android), and in
`curl`. We have ruled out our own code, our domain/proxy setup, cross-origin,
and CNAME-cloaking. This looks like a **better-auth cookie ↔ Safari/WebKit ITP
incompatibility at the platform layer.**

---

## Environment

- **Auth:** EdgeSpark-managed `providerEmailPassword` (better-auth). Config:
  `requireEmailVerification: false`, email+password enabled.
- **Domains tested (both reproduce server-side as WORKING under curl/Chrome):**
  - `teaching-collie-6315.edgespark.app` (default)
  - `rocky.savemoss.com` (custom domain, Cloudflare-proxied; note: `edgespark
    domain add rocky.savemoss.com` returns *"hostname is reserved by EdgeSpark
    and cannot be claimed"*, yet it correctly routes to this project — test
    signups land in this project's DB).
- **Affected clients (real devices, reported by end users):**
  - iPhone Safari 17.5.1 (confirmed by user — NOT an in-app browser)
  - iPhone DuckDuckGo (WebKit)
  - HarmonyOS Huawei Browser (ArkWeb / WebKit-derived)
- **Working clients:** desktop Chrome, Android Chrome, `curl`.

## The cookies EdgeSpark sets (captured from a live sign-up response)

```
set-cookie: __Secure-better-auth.session_token=<...>; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax
set-cookie: __Secure-better-auth.session_data=<...>; Max-Age=300;    Path=/; HttpOnly; Secure; SameSite=Lax
```

Host-only (no `Domain`), `__Secure-` prefix, `Secure; HttpOnly; SameSite=Lax`.
Standard and correct for a first-party cookie — and accepted by Chrome/curl.

## Symptom (what the user experiences)

1. User submits email + password → better-auth `sign-in/email` returns `200`
   (server-side: `es_system__auth_user.last_login_at` updates, a new
   `es_system__auth_session` row is created — sign-in genuinely succeeds).
2. The SDK then issues the next `/api/*` call (in our app, `/api/adopt-device`).
3. On the affected WebKit browsers, that request arrives **without the session
   cookie** → the platform auth gate returns `401 {"error":"UNAUTHENTICATED"}`
   *before our route runs* (our handler's entry log never fires).
4. Because better-auth's client treats sign-in success from the **response
   body**, the UI briefly looks logged-in, then every authed call 401s.

DB fingerprint across affected users: `auth_session` rows keep being created
(many sign-in attempts), but the app never sees an authenticated follow-up —
the latest `auth_session.created_at` is days newer than any successful authed
action. Persistent for 2+ weeks for one user; **not** a timing race (survives a
400 ms client retry and repeated daily attempts).

## ⭐ It's a REGRESSION around 2026-05-15 (strongest evidence — points at the platform)

One affected user (account `czVqtvNK6e6Ugn6jZOK983IAlMBqexhG`, single users row,
single auth account) has a decisive timeline:

- Her account was **created and built ENTIRELY on iPhone Safari 17.5.1** — 45
  `es_system__auth_session` rows from that exact UA, from 2026-04-28 to today.
  She reached **affinity L4 with 336 messages / 81 memories / 18 sessions**
  (trust 0.85, warmth 0.97). So her iPhone Safari **worked fine for ~a month**.
- Her account **last advanced ~2026-05-15** (`users.last_seen_at`), then went
  silent — no successful authed action from the phone after that, despite
  continued sign-in attempts (auth_session rows keep being created).
- **Her iOS did not change**: the UA is `iPhone OS 17_5_1` across ALL 45
  sessions, including the latest. **She did not change Safari settings.**
- **Our app's cookie-relevant code changes POSTDATE the break** (our
  adopt-device error-surfacing landed 2026-05-22; the regression is ~05-15).
- Desktop (different UA) logs in fine TODAY and shows her full L4 data.

So a previously-working iOS Safari client stopped having its session cookie
accepted **~2026-05-15, with no change on the client side and no app-code
cause**. The most likely explanation is a **platform-side change to the
better-auth session cookie around that date** (e.g., a new `__Secure-` prefix,
a SameSite/attribute change, or a better-auth version bump) that iOS Safari
(stricter than Chrome) now rejects. **Please check whether EdgeSpark changed
auth/cookie behavior around 2026-05-15.** (Apple also pushes ITP tracker-
classification updates server-side, independent of iOS version — a secondary
possibility — but the timing + a cookie attribute change is the prime suspect.)

The user's *perceived* symptom during the regression — "progress stuck at L1
0%, no chat history" — is just the **unauthenticated default state** the client
falls back to when the cookie isn't accepted; her real L4 data is intact
server-side. **No data loss.**

## What we verified (rules out our side)

- **Server + cookie round-trip are fine.** `curl` against **both** domains:
  `sign-up/email` → `get-session` → `/api/adopt-device` all return `200`
  (`{"ok":true,...}`) when the cookie jar carries the cookie. So the server,
  the cookie, and the Cloudflare proxy all work for an ideal client.
- **Real-browser topology is clean.** In Chromium (Playwright) on
  `rocky.savemoss.com`: `sign-up → get-session → adopt-device` all `200`,
  **no redirects, all same-origin** (`type:"basic"`, `redirected:false`).
- **No cross-origin frontend.** The deployed JS bundle uses only relative API
  paths (`new URL(path, window.location.href)`), so auth calls are same-origin
  to the page host. No absolute `*.edgespark.app` API base is baked in.
- **Not CNAME cloaking.** `rocky.savemoss.com` resolves via an **A record** to
  Cloudflare anycast IPs (no third-party CNAME for Safari ITP to flag).
- **Not an in-app browser.** End user confirmed she opened it in **Safari
  directly** and still hit it.

Net: the cookie is a genuine, standard, first-party cookie set via a `fetch()`
response. Chrome/curl accept and resend it; Safari/WebKit (with default
"Prevent Cross-Site Tracking") does not send it on the follow-up request.

## Likely root cause (for EdgeSpark to investigate)

A **better-auth session-cookie ↔ Safari/WebKit ITP interaction**. Candidates:

1. **Cookie set via XHR/`fetch()` response is not persisted/sent by WebKit**
   under default privacy settings, whereas a cookie set during a **top-level
   navigation** would be. (Classic WebKit cookie-policy asymmetry.)
2. Missing **`Partitioned`** (CHIPS) / a SameSite or prefix nuance that newer
   WebKit penalizes.
3. The platform gate's `401 {"error":"UNAUTHENTICATED"}` is **uppercase and
   not in the app's error vocabulary**, which also makes client-side error
   mapping harder (separate, minor).

## Requested fixes / asks

1. **Test EdgeSpark email/password auth on iOS Safari 17/18 with "Prevent
   Cross-Site Tracking" ON (the default).** This should reproduce.
2. If confirmed, consider one of: adding **`Partitioned`** to the session
   cookie, adjusting SameSite handling, or providing a **redirect/top-level-
   navigation login path** (so the cookie is set during navigation, which
   WebKit accepts) — better-auth supports cookie config; please surface it.
3. Please **expose cookie configuration** (SameSite / Partitioned / Domain) or
   a **server-side session-mint API** usable from app routes, so app authors
   can build a recovery/magic-link fallback. Today `auth` in production routes
   only exposes `auth.user` / `auth.isAuthenticated()`, with no way to create a
   session — so we cannot build any cookie-independent login fallback.

## Workaround currently given to affected users

- Use a desktop browser (works), or
- iPhone: Settings → Safari → turn OFF "Prevent Cross-Site Tracking" (+ ensure
  "Block All Cookies" off; disable iCloud Private Relay), then retry, or
- Use Chrome on iOS (separate cookie store; often unaffected).

This is a stopgap — the platform-level fix is what prevents new users from
silently failing to log in.
