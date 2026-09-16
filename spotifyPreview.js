/**
 * Spotify Web API — solo Client Credentials + search/preview.
 * No hosteamos MP3: el cliente reproduce preview_url de Spotify (≈30s).
 */

let tokenCache = { accessToken: null, expiresAt: 0 };

function spotifyConfigured() {
  return !!(
    (process.env.SPOTIFY_CLIENT_ID || "").trim() &&
    (process.env.SPOTIFY_CLIENT_SECRET || "").trim()
  );
}

async function obtenerTokenSpotify() {
  if (!spotifyConfigured()) {
    return { ok: false, status: 503, error: "Spotify no configurado (SPOTIFY_CLIENT_ID/SECRET)." };
  }
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 30_000) {
    return { ok: true, accessToken: tokenCache.accessToken };
  }
  const id = (process.env.SPOTIFY_CLIENT_ID || "").trim();
  const secret = (process.env.SPOTIFY_CLIENT_SECRET || "").trim();
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    return {
      ok: false,
      status: 502,
      error: data.error_description || data.error || "No se pudo autenticar con Spotify."
    };
  }
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000
  };
  return { ok: true, accessToken: tokenCache.accessToken };
}

function packTrack(t) {
  if (!t?.id) return null;
  const artists = (t.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const images = t.album?.images || [];
  const cover = images[images.length - 1]?.url || images[0]?.url || null;
  return {
    id: t.id,
    name: t.name || "Sin título",
    artist: artists || "Artista",
    preview_url: t.preview_url || null,
    cover,
    external_url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
    has_preview: !!t.preview_url
  };
}

async function buscarTracksSpotify(q, { limit = 12 } = {}) {
  const query = String(q || "").trim();
  if (query.length < 2) {
    return { ok: false, status: 400, error: "Escribe al menos 2 letras." };
  }
  const tok = await obtenerTokenSpotify();
  if (!tok.ok) return tok;

  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", String(Math.min(20, Math.max(1, limit))));
  url.searchParams.set("market", "MX");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tok.accessToken}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status === 429 ? 429 : 502,
      error: data.error?.message || "Spotify search falló."
    };
  }
  const items = (data.tracks?.items || []).map(packTrack).filter(Boolean);
  // Preferir con preview, pero no ocultar el resto (sticker + link igual sirve)
  items.sort((a, b) => Number(b.has_preview) - Number(a.has_preview));
  return { ok: true, tracks: items, configurado: true };
}

function statusSpotify() {
  return { ok: true, configurado: spotifyConfigured() };
}

module.exports = {
  spotifyConfigured,
  buscarTracksSpotify,
  statusSpotify
};
