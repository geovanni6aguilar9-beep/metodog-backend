/**
 * Letra de canciones vía LRCLIB (público, sin API key).
 * Tiempos ABSOLUTOS del LRC — el cliente suma lyricOffset al currentTime del preview.
 */

function sanitizeMusicQuery(s) {
  return String(s || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(feat\.?|ft\.?|with|prod\.?|remix|version|edit)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLrc(synced) {
  const lines = [];
  const re = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)/g;
  const raw = String(synced || "");
  let m;
  while ((m = re.exec(raw))) {
    const min = Number(m[1]) || 0;
    const sec = Number(m[2]) || 0;
    const frac = m[3] ? Number(`0.${m[3]}`) : 0;
    const text = String(m[4] || "").trim();
    if (!text) continue;
    lines.push({ t: min * 60 + sec + frac, text });
  }
  lines.sort((a, b) => a.t - b.t);
  return lines;
}

function plainToLines(plain) {
  return String(plain || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !/^\[/.test(s));
}

/**
 * Timeline absoluta del tema + offset sugerido si la voz empieza tarde
 * (el preview de 30s suele saltar el intro).
 */
function buildLyricTimeline(payload) {
  const synced = parseLrc(payload?.syncedLyrics);
  if (synced.length) {
    const timeline = synced.slice(0, 48);
    const early = timeline.filter((l) => l.t <= 28).length;
    const firstT = timeline[0]?.t || 0;
    const suggestedOffset = early >= 2 ? 0 : Math.round(firstT * 10) / 10;
    return { timeline, suggestedOffset };
  }
  const plain = plainToLines(payload?.plainLyrics).slice(0, 24);
  if (!plain.length) return { timeline: [], suggestedOffset: 0 };
  const timeline = plain.map((text, i) => ({ t: i * 2.8, text }));
  return { timeline, suggestedOffset: 0 };
}

function lineAtTime(timeline, t) {
  if (!timeline?.length) return "";
  const sec = Number(t) || 0;
  if (sec + 0.05 < (Number(timeline[0].t) || 0)) return "";
  let cur = "";
  for (const L of timeline) {
    if ((Number(L.t) || 0) <= sec) cur = L.text;
    else break;
  }
  return cur || "";
}

async function lrclibGet(artist, track) {
  const getUrl = new URL("https://lrclib.net/api/get");
  getUrl.searchParams.set("artist_name", artist);
  getUrl.searchParams.set("track_name", track);
  const res = await fetch(getUrl.toString(), {
    headers: { "User-Agent": "MetodoG-Historias/1.0 (lyrics sticker)" }
  });
  const data = await res.json().catch(() => null);
  if (res.ok && data && (data.syncedLyrics || data.plainLyrics)) return data;
  return null;
}

async function lrclibSearch(q) {
  const searchUrl = new URL("https://lrclib.net/api/search");
  searchUrl.searchParams.set("q", q);
  const res = await fetch(searchUrl.toString(), {
    headers: { "User-Agent": "MetodoG-Historias/1.0 (lyrics sticker)" }
  });
  const arr = await res.json().catch(() => []);
  return (Array.isArray(arr) ? arr : []).find((x) => x?.syncedLyrics || x?.plainLyrics) || null;
}

async function fetchLrclib(artist, track) {
  const rawA = String(artist || "").trim();
  const rawT = String(track || "").trim();
  if (rawA.length < 1 || rawT.length < 1) {
    return { ok: false, status: 400, error: "Falta artista o tema." };
  }

  const artistClean = sanitizeMusicQuery(rawA.split(",")[0] || rawA);
  const trackClean = sanitizeMusicQuery(rawT);

  try {
    let data =
      (await lrclibGet(artistClean, trackClean)) ||
      (await lrclibGet(artistClean, rawT)) ||
      (await lrclibSearch(`${trackClean} ${artistClean}`)) ||
      (await lrclibSearch(`${rawT} ${artistClean}`));

    if (!data) {
      return { ok: false, status: 404, error: "Sin letra para este tema." };
    }

    const { timeline, suggestedOffset } = buildLyricTimeline(data);
    if (!timeline.length) {
      return { ok: false, status: 404, error: "Sin letra para este tema." };
    }

    return {
      ok: true,
      track: data.trackName || trackClean,
      artist: data.artistName || artistClean,
      duration: data.duration || null,
      timeline,
      suggestedOffset,
      lines: timeline.map((x) => x.text)
    };
  } catch (err) {
    console.error("LRCLIB:", err.message);
    return { ok: false, status: 502, error: "No se pudo cargar la letra." };
  }
}

module.exports = {
  fetchLrclib,
  buildLyricTimeline,
  lineAtTime,
  parseLrc,
  sanitizeMusicQuery
};
