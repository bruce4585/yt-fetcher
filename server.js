import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import ytdl from 'ytdl-core';

const app = express();

// 允许你的前端/桌面调用（先放开 * ，后面你可以改成你自己的域名）
app.use(cors());
app.use(morgan('tiny'));

app.get('/healthz', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// 简单校验 YouTube 链接/ID
function normalizeYouTubeUrl(input) {
  try {
    // 先当 URL 解析
    const u = new URL(input);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      return u.toString();
    }
  } catch {
    // 不是 URL，当作视频 ID
    if (/^[A-Za-z0-9_-]{6,}$/.test(input)) {
      return `https://www.youtube.com/watch?v=${input}`;
    }
  }
  return null;
}

/**
 * /fetch?url=<YouTube链接或ID>
 * 返回：把 YouTube 音频（audio-only） 直接以流的方式输出（通常是 webm/opus）
 * 说明：我们不转码、不存储，只做“中转”，AssemblyAI 可接受 webm/opus 等常见音频容器。
 */
app.get('/fetch', async (req, res) => {
  try {
    const raw = req.query.url || '';
    const ytUrl = normalizeYouTubeUrl(raw);
    if (!ytUrl) {
      return res.status(400).json({ error: 'Invalid YouTube URL or ID' });
    }

    // 检查视频是否有效
    const info = await ytdl.getInfo(ytUrl).catch(() => null);
    if (!info) {
      return res.status(404).json({ error: 'Video not found or not accessible' });
    }

    // 选择音频流（不含视频）
    // ytdl 默认给 webm/opus，AssemblyAI 可以识别；若你强制需要 mp3，才需要引入 ffmpeg 转码（成本高/易超时）
    const audio = ytdl(ytUrl, {
      quality: 'highestaudio',
      filter: 'audioonly',
      highWaterMark: 1 << 24 // 提高水位，避免在免费机型上卡顿
    });

    // 给一些有用的头
    res.setHeader('Content-Type', 'audio/webm'); // 多数情况下是 webm/opus
    res.setHeader('Cache-Control', 'no-store');
    // Content-Disposition 让浏览器别强制下载
    res.setHeader('Content-Disposition', 'inline; filename="audio.webm"');

    audio.on('error', (e) => {
      console.error('[ytdl error]', e?.message);
      if (!res.headersSent) res.status(502).json({ error: 'Fetch audio failed' });
      try { audio.destroy(); } catch {}
    });

    // 管道输出
    audio.pipe(res);
  } catch (e) {
    console.error('[fetch error]', e?.message);
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`yt-fetcher listening on :${port}`);
});
