/**
 * Búsqueda de música para historias (preview ~30s, sin hostear MP3).
 * 1) Spotify Client Credentials (si keys OK y no 403)
 * 2) Fallback iTunes Search API (gratis, preview comercial)
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

function packSpotifyTrack(t) {
  if (!t?.id) return null;
  const artists = (t.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const images = t.album?.images || [];
  const cover = images[images.length - 1]?.url || images[0]?.url || null;
  return {
    id: String(t.id),
    name: t.name || "Sin título",
    artist: artists || "Artista",
    preview_url: t.preview_url || null,
    cover,
    external_url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
    has_preview: !!t.preview_url,
    source: "spotify"
  };
}

async function searchSpotifyOnce(accessToken, query, limit, market) {
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

async function intentarSpotify(query, limit) {
  const tok = await obtenerTokenSpotify();
  if (!tok.ok) return { ok: false, status: tok.status, error: tok.error };

  let res;
  let data;
  try {
    ({ res, data } = await searchSpotifyOnce(tok.accessToken, query, limit, "MX"));
    if (!res.ok && (res.status === 403 || res.status === 400)) {
      ({ res, data } = await searchSpotifyOnce(tok.accessToken, query, limit, null));
    }
    if (res.status === 401) {
      tokenCache = { accessToken: null, expiresAt: 0 };
      const tok2 = await obtenerTokenSpotify();
      if (tok2.ok) {
        ({ res, data } = await searchSpotifyOnce(tok2.accessToken, query, limit, null));
      }
    }
  } catch (err) {
    console.error("Spotify search network:", err.message);
    return { ok: false, status: 502, error: "Sin conexión a Spotify (search)." };
  }

  if (!res.ok) {
    const msg = data.error?.message || data.error_description || `Spotify search ${res.status}`;
    console.warn("Spotify search fail → fallback iTunes:", res.status, msg);
    return { ok: false, status: res.status, error: msg };
  }

  const items = (data.tracks?.items || []).map(packSpotifyTrack).filter(Boolean);
  items.sort((a, b) => Number(b.has_preview) - Number(a.has_preview));
  return { ok: true, tracks: items, fuente: "spotify" };
}

async function buscarTracksItunes(query, limit) {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", String(Math.min(25, Math.max(1, limit))));
  url.searchParams.set("country", "mx");
  let res;
  let data = {};
  try {
    res = await fetch(url.toString());
    data = await res.json().catch(() => ({}));
  } catch (err) {
    console.error("iTunes search network:", err.message);
    return { ok: false, status: 502, error: "Sin conexión a catálogo de previews." };
  }
  if (!res.ok) {
    return { ok: false, status: 502, error: `Catálogo preview ${res.status}` };
  }
  const items = (data.results || [])
    .map((r) => {
      if (!r?.trackId) return null;
      const cover = String(r.artworkUrl100 || r.artworkUrl60 || "")
        .replace("100x100bb", "200x200bb")
        .replace("60x60bb", "200x200bb");
      return {
        id: `it:${r.trackId}`,
        name: r.trackName || "Sin título",
        artist: r.artistName || "Artista",
        preview_url: r.previewUrl || null,
        cover: cover || null,
        external_url: r.trackViewUrl || null,
        has_preview: !!r.previewUrl,
        source: "itunes"
      };
    })
    .filter(Boolean);
  items.sort((a, b) => Number(b.has_preview) - Number(a.has_preview));
  return { ok: true, tracks: items, fuente: "itunes" };
}

/** API pública usada por server.js */
async function buscarTracksSpotify(q, { limit = 12 } = {}) {
  const query = String(q || "").trim();
  if (query.length < 2) {
    return { ok: false, status: 400, error: "Escribe al menos 2 letras." };
  }

  if (spotifyConfigured()) {
    const sp = await intentarSpotify(query, limit);
    if (sp.ok && (sp.tracks || []).length) {
      return { ok: true, tracks: sp.tracks, configurado: true, fuente: "spotify" };
    }
  }

  const it = await buscarTracksItunes(query, limit);
  if (!it.ok) return it;
  return {
    ok: true,
    tracks: it.tracks || [],
    configurado: true,
    fuente: "itunes",
    spotify_bloqueado: spotifyConfigured()
  };
}

async function statusSpotify() {
  // Búsqueda siempre disponible vía iTunes; Spotify es bonus si no da 403
  const configuradoSpotify = spotifyConfigured();
  let auth_ok = false;
  let spotify_error;
  if (configuradoSpotify) {
    const tok = await obtenerTokenSpotify();
    auth_ok = !!tok.ok;
    if (!tok.ok) spotify_error = tok.error;
  }
  return {
    ok: true,
    /** FE: se puede buscar canciones (iTunes y/o Spotify) */
    configurado: true,
    busqueda_ok: true,
    spotify_keys: configuradoSpotify,
    spotify_auth_ok: auth_ok,
    auth_ok: true,
    error: spotify_error
  };
}

module.exports = {
  spotifyConfigured,
  buscarTracksSpotify,
  statusSpotify
};
