/**
 * Letra vía LRCLIB — ventana densa ≈ preview Spotify/iTunes (gancho), no 0:00.
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

function buildLyricTimeline(payload, previewDur = 30) {
  const synced = parseLrc(payload?.syncedLyrics);
  const dur = Math.max(20, Number(previewDur) || 30);

  if (synced.length) {
    const trackEnd = synced[synced.length - 1].t || dur;
    const ideal = Math.max(0, trackEnd * 0.35 - dur * 0.15);
    const candidates = [0];
    for (const L of synced) {
      const t = L.t;
      if (candidates[candidates.length - 1] !== t) candidates.push(t);
    }

    let bestStart = 0;
    let bestCount = -1;
    let bestDist = Infinity;
    for (const start of candidates) {
      if (start > trackEnd) break;
      let count = 0;
      for (const L of synced) {
        if (L.t < start) continue;
        if (L.t >= start + dur) break;
        count += 1;
      }
      const dist = Math.abs(start - ideal);
      const better =
        count > bestCount ||
        (count === bestCount &&
          (dist < bestDist - 3 || (Math.abs(dist - bestDist) <= 3 && start < bestStart)));
      if (better) {
        bestCount = count;
        bestDist = dist;
        bestStart = start;
      }
    }

    return synced
      .filter((l) => l.t >= bestStart && l.t < bestStart + dur + 2)
      .slice(0, 24)
      .map((l) => ({ t: Math.max(0, l.t - bestStart), text: l.text }));
  }

  const plain = plainToLines(payload?.plainLyrics).slice(0, 12);
  if (!plain.length) return [];
  const step = Math.min(3, dur / Math.max(1, plain.length));
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
  if (res.status === 404) return null;
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
    const exact = await lrclibGet(artistClean, trackClean);
    const data = exact || (await lrclibSearch(`${trackClean} ${artistClean}`));

    if (!data) {
      return { ok: false, status: 404, error: "Sin letra para este tema." };
    }

    const timeline = buildLyricTimeline(data, previewDur);
    if (!timeline.length) {
      return { ok: false, status: 404, error: "Este fragmento no trae voz con letra." };
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
