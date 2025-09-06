// server.js
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

const app = express();

// 允许你的前端/桌面调用
app.use(cors());          // 现在先开放 * ，之后可按你的域名收敛
app.use(morgan('tiny'));

// 健康检查
app.get('/healthz', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// —— 工具：从 URL/ID 提取 YouTube 视频 ID —— //
function getYouTubeId(input) {
  try {
    const s = decodeURIComponent(String(input || '').trim());
    // 原始就是 ID 的情况
    if (/^[A-Za-z0-9_-]{6,}$/.test(s) && !/^https?:/i.test(s)) return s;

    // 解析 URL
    const u = new URL(s);

    // youtu.be/XXXX
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\/+/, '');
      if (id) return id;
    }

    // www.youtube.com/watch?v=XXXX
    const v = u.searchParams.get('v');
    if (v) return v;

    // shorts/XXXX
    const m = u.pathname.match(/shorts\/([A-Za-z0-9_-]{6,})/);
    if (m) return m[1];

    return null;
  } catch {
    return null;
  }
}

// —— 用 RapidAPI 获取下载信息 —— //
app.get('/fetch', async (req, res) => {
  const raw = req.query.url || '';
  const videoId = getYouTubeId(raw);

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid YouTube URL or ID' });
  }

  const RAPID_HOST = process.env.RAPIDAPI_HOST; // 例：youtube-mp36.p.rapidapi.com
  const RAPID_KEY  = process.env.RAPIDAPI_KEY;

  if (!RAPID_HOST || !RAPID_KEY) {
    return res.status(500).json({ error: 'Server missing RapidAPI credentials' });
  }

  try {
    const endpoint = `https://${RAPID_HOST}/dl?id=${encodeURIComponent(videoId)}`;
    const r = await fetch(endpoint, {
      headers: {
        'x-rapidapi-key': RAPID_KEY,
        'x-rapidapi-host': RAPID_HOST,
      },
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    // RapidAPI 非 2xx 也原样透传给前端，便于排错
    if (!r.ok) {
      return res.status(r.status).json({ error: 'RapidAPI error', details: data });
    }

    return res.json(data);
  } catch (e) {
    console.error('[fetch error]', e?.message || e);
    return res.status(502).json({ error: 'Failed to fetch from RapidAPI' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`yt-fetcher listening on :${port}`);
});
