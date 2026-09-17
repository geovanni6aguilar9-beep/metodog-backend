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
  let res;
  let data = {};
  try {
    res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    console.error("Spotify token network:", err.message);
    return { ok: false, status: 502, error: "Sin conexión a Spotify (token)." };
  }
  if (!res.ok || !data.access_token) {
    const msg = data.error_description || data.error || `Auth Spotify ${res.status}`;
    console.error("Spotify token fail:", res.status, msg);
    tokenCache = { accessToken: null, expiresAt: 0 };
    return { ok: false, status: 502, error: msg };
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

async function searchOnce(accessToken, query, limit, market) {
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", String(Math.min(20, Math.max(1, limit))));
  if (market) url.searchParams.set("market", market);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function buscarTracksSpotify(q, { limit = 12 } = {}) {
  const query = String(q || "").trim();
  if (query.length < 2) {
    return { ok: false, status: 400, error: "Escribe al menos 2 letras." };
  }
  const tok = await obtenerTokenSpotify();
  if (!tok.ok) return tok;

  let res;
  let data;
  try {
    ({ res, data } = await searchOnce(tok.accessToken, query, limit, "MX"));
    // Algunos apps/cuentas fallan con market fijo → reintento sin market
    if (!res.ok && (res.status === 403 || res.status === 400)) {
      ({ res, data } = await searchOnce(tok.accessToken, query, limit, null));
    }
  } catch (err) {
    console.error("Spotify search network:", err.message);
    return { ok: false, status: 502, error: "Sin conexión a Spotify (search)." };
  }

  if (!res.ok) {
    // Token vencido / inválido: limpiar caché y un reintento
    if (res.status === 401) {
      tokenCache = { accessToken: null, expiresAt: 0 };
      const tok2 = await obtenerTokenSpotify();
      if (tok2.ok) {
        try {
          ({ res, data } = await searchOnce(tok2.accessToken, query, limit, null));
        } catch (err) {
          console.error("Spotify search retry network:", err.message);
          return { ok: false, status: 502, error: "Sin conexión a Spotify (search)." };
        }
      }
    }
  }

  if (!res.ok) {
    const msg = data.error?.message || data.error_description || `Spotify search ${res.status}`;
    console.error("Spotify search fail:", res.status, msg);
    return {
      ok: false,
      status: res.status === 429 ? 429 : 502,
      error: msg
    };
  }

  const items = (data.tracks?.items || []).map(packTrack).filter(Boolean);
  items.sort((a, b) => Number(b.has_preview) - Number(a.has_preview));
  return { ok: true, tracks: items, configurado: true };
}

async function statusSpotify() {
  const configurado = spotifyConfigured();
  if (!configurado) {
    return { ok: true, configurado: false, auth_ok: false };
  }
  const tok = await obtenerTokenSpotify();
  return {
    ok: true,
    configurado: true,
    auth_ok: !!tok.ok,
    error: tok.ok ? undefined : tok.error
  };
}

module.exports = {
  spotifyConfigured,
  buscarTracksSpotify,
  statusSpotify
};
