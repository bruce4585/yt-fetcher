import express from "express";
import cors from "cors";
import morgan from "morgan";

const app = express();
app.use(cors());
app.use(morgan("dev"));

const PORT = process.env.PORT || 3000;

// 健康检查
app.get("/healthz", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// 提取 YouTube 视频 ID
function getYouTubeId(input) {
  try {
    const u = new URL(input);

    // https://www.youtube.com/watch?v=xxxx
    if (u.searchParams.has("v")) {
      return u.searchParams.get("v");
    }

    // https://youtu.be/xxxx
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1);
    }

    // shorts/XXXX
    const m = u.pathname.match(/shorts\/([A-Za-z0-9_-]{6,})/);
    if (m) return m[1];

    return null;
  } catch {
    return null;
  }
}

// 用 RapidAPI 获取下载信息
app.get("/fetch", async (req, res) => {
  const raw = req.query.url || "";
  const videoId = getYouTubeId(raw);

  if (!videoId) {
    return res.status(400).json({ error: "Invalid YouTube URL or ID" });
  }

  const RAPID_HOST = process.env.RAPIDAPI_HOST;
  const RAPID_KEY = process.env.RAPIDAPI_KEY;

  if (!RAPID_HOST || !RAPID_KEY) {
    return res
      .status(500)
      .json({ error: "Server missing RapidAPI credentials" });
  }

  try {
    const endpoint = `https://${RAPID_HOST}/dl?id=${encodeURIComponent(
      videoId
    )}`;

    const r = await fetch(endpoint, {
      headers: {
        "x-rapidapi-key": RAPID_KEY,
        "x-rapidapi-host": RAPID_HOST,
      },
    });

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 启动服务（必须监听 0.0.0.0）
app.listen(PORT, "0.0.0.0", () => {
  console.log(`yt-fetcher listening on :${PORT}`);
});
