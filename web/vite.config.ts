import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Dev: every /api/* request (both better-auth's same-origin calls and our
// own sessionApi fetches — with VITE_API_URL empty in .env.development)
// lands on the Vite dev server, which proxies to VITE_DEV_PROXY_TARGET.
// cookieDomainRewrite rewrites Set-Cookie domain=backend-host → localhost
// so the browser keeps the session cookie on localhost for every follow-up.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_DEV_PROXY_TARGET || env.VITE_API_URL || 'http://localhost:3001'
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          cookieDomainRewrite: 'localhost',
        },
      },
    },
  }
})
