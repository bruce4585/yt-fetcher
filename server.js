import express from "express";
import cors from "cors";
import morgan from "morgan";

// ----- 简单内存缓存（Map + TTL）-----
const cache = new Map(); // key: videoId, value: { data, expireAt }
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟

const app = express();
app.use(cors());
app.use(morgan("tiny"));

const PORT = process.env.PORT || 3000;
const RAPID_HOST = process.env.RAPIDAPI_HOST;      // 例如 youtube-mp36.p.rapidapi.com
const RAPID_KEY  = process.env.RAPIDAPI_KEY;

// 健康检查
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// --- 解析 YouTube 链接/ID ---
function normalizeYouTubeUrl(input) {
  try {
    const u = new URL(input);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      return u.toString();
    }
  } catch {
    if (/^[A-Za-z0-9_-]{6,}$/.test(input)) {
      return `https://www.youtube.com/watch?v=${input}`;
    }
  }
  return null;
}

// 从 URL/ID 提取 videoId（支持 watch?v= / youtu.be / shorts）
function getVideoId(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname;
    if (host.includes("youtube.com")) {
      // watch?v=xxx
      const v = u.searchParams.get("v");
      if (v) return v;
      // shorts/xxx
      const m = u.pathname.match(/shorts\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[1];
    }
    if (host.includes("youtu.be")) {
      const seg = u.pathname.split("/").filter(Boolean);
      if (seg[0]) return seg[0];
    }
  } catch {
    // 忽略
  }
  return null;
}

/**
 * /fetch?url=<YouTube链接或ID>
 * 调 RapidAPI 的 youtube-mp36：/dl?id=<videoId>
 * 返回 RapidAPI 的 JSON 结果（里面一般含有 mp3 下载地址）
 */
app.get("/fetch", async (req, res) => {
  try {
    if (!RAPID_HOST || !RAPID_KEY) {
      return res.status(500).json({ error: "Server missing RapidAPI credentials" });
    }

    const raw = String(req.query.url || "").trim();
    const norm = normalizeYouTubeUrl(raw);
    if (!norm) return res.status(400).json({ error: "Invalid YouTube URL or ID" });

    const videoId = getVideoId(norm);
    if (!videoId) return res.status(400).json({ error: "Cannot parse videoId" });

    // 命中缓存
    const now = Date.now();
    const hit = cache.get(videoId);
    if (hit && hit.expireAt > now) {
      return res.json(hit.data);
    }

    // 组 RapidAPI endpoint（注意 host 不带 https://）
    const endpoint = `https://${RAPID_HOST}/dl?id=${encodeURIComponent(videoId)}`;

    const r = await fetch(endpoint, {
      headers: {
        "x-rapidapi-key": RAPID_KEY,
        "x-rapidapi-host": RAPID_HOST,
      },
    });

    // RapidAPI 层面错误
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res
        .status(502)
        .json({ error: "RapidAPI request failed", status: r.status, body: text });
    }

    // JSON 解析
    let data;
    try {
      data = await r.json();
    } catch (e) {
      const text = await r.text().catch(() => "");
      return res.status(502).json({ error: "Invalid JSON from RapidAPI", body: text });
    }

    // 简单兜底校验（不同 API 返回结构不同，这里不强校验）
    if (!data) {
      return res.status(502).json({ error: "Empty response from RapidAPI" });
    }

    // 写缓存
    cache.set(videoId, { data, expireAt: now + CACHE_TTL_MS });

    res.json(data);
  } catch (err) {
    console.error("[/fetch error]", err?.message || err);
    res.status(500).json({ error: "Server error", message: err?.message || String(err) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`yt-fetcher listening on :${PORT}`);
});
