/**
 * Letra vía LRCLIB — auto-sync al preview ~30s (sin slider).
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
 * 1) Letra al inicio del tema → tiempos absolutos.
 * 2) Si no → ventana más densa (coro/hook del preview), intervalos LRC reales.
 */
function buildLyricTimeline(payload, previewDur = 30) {
  const synced = parseLrc(payload?.syncedLyrics);
  const dur = Math.max(20, Number(previewDur) || 30);

  if (synced.length) {
    const early = synced.filter((l) => l.t <= dur + 1);
    if (early.length >= 3) {
      return early.map((l) => ({ t: l.t, text: l.text }));
    }

    let bestStart = synced[0].t;
    let bestCount = 0;
    for (let i = 0; i < synced.length; i++) {
      const start = synced[i].t;
      const end = start + dur;
      let count = 0;
      for (let j = i; j < synced.length && synced[j].t < end; j++) count += 1;
      if (count > bestCount) {
        bestCount = count;
        bestStart = start;
      }
    }

    return synced
      .filter((l) => l.t >= bestStart && l.t < bestStart + dur + 4)
      .slice(0, 24)
      .map((l) => ({ t: Math.max(0, l.t - bestStart), text: l.text }));
  }

  const plain = plainToLines(payload?.plainLyrics).slice(0, 16);
  if (!plain.length) return [];
  const step = dur / Math.max(1, plain.length);
  return plain.map((text, i) => ({ t: i * step, text }));
}

function lineAtTime(timeline, t) {
  if (!timeline?.length) return "";
  const sec = Number(t) || 0;
  if (sec + 0.08 < (Number(timeline[0].t) || 0)) return "";
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

async function fetchLrclib(artist, track, previewDur = 30) {
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

    const timeline = buildLyricTimeline(data, previewDur);
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
