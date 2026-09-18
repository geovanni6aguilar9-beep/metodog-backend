/**
 * Letra de canciones vía LRCLIB (público, sin API key).
 * Para stickers Letra/Karaoke en historias.
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

/** Bloque de ~30–40s desde la primera línea con voz. */
function pickVocalBlock(syncedLines, windowSec = 38) {
  if (!syncedLines.length) return [];
  const startIdx = syncedLines.findIndex((l) => l.text);
  if (startIdx < 0) return [];
  const t0 = syncedLines[startIdx].t;
  const out = [];
  for (let i = startIdx; i < syncedLines.length && out.length < 18; i++) {
    if (syncedLines[i].t - t0 > windowSec) break;
    out.push(syncedLines[i]);
  }
  return out;
}

function remapBlockToClip(block, clipStart, clipEnd) {
  if (!block.length) return [];
  const t0 = block[0].t;
  const t1 = block[block.length - 1].t;
  const span = Math.max(1.2, t1 - t0);
  const dur = Math.max(1.2, (Number(clipEnd) || 30) - (Number(clipStart) || 0));
  const base = Number(clipStart) || 0;
  return block.map((l) => ({
    t: base + ((l.t - t0) / span) * dur,
    text: l.text
  }));
}

function evenlySpaced(texts, clipStart, clipEnd) {
  const list = (texts || []).filter(Boolean).slice(0, 14);
  if (!list.length) return [];
  const base = Number(clipStart) || 0;
  const dur = Math.max(1.2, (Number(clipEnd) || 30) - base);
  const step = dur / Math.max(1, list.length);
  return list.map((text, i) => ({ t: base + i * step, text }));
}

/**
 * Líneas listas para el sticker, ancladas al clip del preview (0–30s del audio).
 */
function buildLyricTimeline(payload, clipStart = 0, clipEnd = 30) {
  const synced = parseLrc(payload?.syncedLyrics);
  const plain = plainToLines(payload?.plainLyrics);

  const early = synced.filter((l) => l.t >= clipStart && l.t <= Math.max(clipEnd, 35));
  if (early.length >= 3) {
    return early.map((l) => ({ t: l.t, text: l.text }));
  }

  const block = pickVocalBlock(synced);
  if (block.length >= 2) {
    return remapBlockToClip(block, clipStart, clipEnd);
  }

  return evenlySpaced(plain, clipStart, clipEnd);
}

function lineAtTime(timeline, t) {
  if (!timeline?.length) return "";
  const sec = Number(t) || 0;
  let cur = timeline[0].text;
  for (const L of timeline) {
    if (L.t <= sec) cur = L.text;
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

    const timeline = buildLyricTimeline(data, 0, 30);
    if (!timeline.length) {
      return { ok: false, status: 404, error: "Sin letra para este tema." };
    }

    return {
      ok: true,
      track: data.trackName || trackClean,
      artist: data.artistName || artistClean,
      duration: data.duration || null,
      timeline,
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
