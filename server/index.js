import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

const app = express();
app.use(cors());
app.use(express.json());

const {
  MINIMAX_API_KEY,
  MINIMAX_API_URL = 'https://api.minimax.chat',
  MINIMAX_MODEL = 'MiniMax-M2.7',
  MINIMAX_TTS_API_URL = 'https://api.minimaxi.com',
  MINIMAX_TTS_MODEL = 'speech-2.8-hd',
  MINIMAX_TTS_VOICE_ID = 'rocky_hailmary',
} = process.env;

// ── Mock 超限模式 ──
const MOCK_QUOTA_CHAT = process.env.MOCK_QUOTA_CHAT === '1';
const MOCK_QUOTA_TTS = process.env.MOCK_QUOTA_TTS === '1';
if (MOCK_QUOTA_CHAT) console.log('⚠️  MOCK: Chat requests will return 429');
if (MOCK_QUOTA_TTS) console.log('⚠️  MOCK: TTS requests will return 429');

// ── Chat completions (streaming proxy) ──
app.post('/api/chat', async (req, res) => {
  if (MOCK_QUOTA_CHAT) {
    res.status(429).json({ error: 'quota_exceeded', detail: 'mock' });
    return;
  }
  try {
    const { messages, temperature, top_p, max_tokens } = req.body;

    const upstream = await fetch(`${MINIMAX_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        messages,
        stream: true,
        temperature: temperature ?? 0.55,
        top_p: top_p ?? 0.9,
        max_tokens: max_tokens ?? 1024,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      // 429 = rate limit from MiniMax
      if (upstream.status === 429) {
        res.status(429).json({ error: 'quota_exceeded', detail: text });
      } else {
        res.status(upstream.status).json({ error: text });
      }
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    console.error('Chat proxy error:', err);
    res.status(500).json({ error: 'proxy error' });
  }
});

// ── TTS GET endpoint（浏览器 Audio 元素原生加载） ──
app.get('/api/tts', async (req, res) => {
  if (MOCK_QUOTA_TTS) {
    res.status(429).json({ error: 'quota_exceeded', detail: 'mock' });
    return;
  }
  try {
    const text = req.query.text;
    const speed = req.query.speed ? parseFloat(req.query.speed) : undefined;
    const vol = req.query.vol ? parseFloat(req.query.vol) : undefined;
    const pitch = req.query.pitch ? parseInt(req.query.pitch) : undefined;
    if (!text?.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const upstream = await fetch(`${MINIMAX_TTS_API_URL}/v1/t2a_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: MINIMAX_TTS_MODEL,
        text,
        voice_setting: {
          voice_id: MINIMAX_TTS_VOICE_ID,
          speed: speed ?? 1.0,
          vol: vol ?? 1.0,
          pitch: pitch ?? 0,
        },
        audio_setting: {
          format: 'mp3',
          sample_rate: 44100,
          bitrate: 128000,
          channel: 1,
        },
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({ error: text });
      return;
    }

    const json = await upstream.json();

    if (json.base_resp?.status_code !== 0) {
      const code = json.base_resp?.status_code;
      // 1002 = rate limit, 1008 = insufficient balance/quota exhausted
      if (code === 1002 || code === 1008) {
        res.status(429).json({ error: 'quota_exceeded', detail: json.base_resp });
      } else {
        res.status(500).json({ error: json.base_resp });
      }
      return;
    }

    const hexAudio = json.data?.audio;
    if (!hexAudio) {
      res.status(500).json({ error: 'no audio data' });
      return;
    }

    // hex → binary mp3
    const buf = Buffer.from(hexAudio, 'hex');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (err) {
    console.error('TTS proxy error:', err);
    res.status(500).json({ error: 'proxy error' });
  }
});

// ── Production: serve static files ──
if (process.env.NODE_ENV === 'production') {
  const staticPath = resolve(__dirname, '..', 'dist');
  app.use(express.static(staticPath));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(resolve(staticPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
