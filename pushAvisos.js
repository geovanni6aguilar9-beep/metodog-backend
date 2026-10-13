/**
 * Avisos de la campanita fuera de la app (Web Push).
 * Si faltan las claves VAPID, no hace nada: la campanita interna sigue igual.
 */

const webpush = require("web-push");

const HOJA_POR_TIPO = {
  plan_rutina: "rutinas",
  plan_dieta: "nutricion",
  vinculo_aceptado: "rutinas",
  vinculo_rechazado: "directorio",
  solicitud_vinculo: "equipo",
  directorio_coach_publicado: "directorio",
  trial_por_vencer: "perfil-suscripcion",
  social_solicitud: "yo",
  social_aceptada: "yo",
  social_mensaje: "yo",
  social_like: "yo",
  social_comentario: "yo",
  social_moderacion: "comunidad"
};

let vapidListo = false;

function vapidConfigurado() {
  const pub = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const priv = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  if (!pub || !priv) return false;
  if (!vapidListo) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://metodog.lat", pub, priv);
    vapidListo = true;
  }
  return true;
}

function clavePublicaPush() {
  const clave = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  return clave || null;
}

async function ensureTablaPushSuscripciones(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS push_suscripciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_push_suscripciones_usuario ON push_suscripciones(usuario_id)`
  );
}

function suscripcionValida(body) {
  const endpoint = String(body?.endpoint || "").trim();
  const p256dh = String(body?.keys?.p256dh || body?.p256dh || "").trim();
  const auth = String(body?.keys?.auth || body?.auth || "").trim();
  if (!endpoint.startsWith("https://") || endpoint.length > 2000) return null;
  if (!p256dh || p256dh.length > 255 || !auth || auth.length > 255) return null;
  return { endpoint, p256dh, auth };
}

async function guardarSuscripcionPush(db, usuarioId, body) {
  const sub = suscripcionValida(body);
  if (!sub) return { ok: false, status: 400, error: "Suscripción inválida" };
  await db.execute({
    sql: `INSERT INTO push_suscripciones (usuario_id, endpoint, p256dh, auth)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET
            usuario_id = excluded.usuario_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth`,
    args: [usuarioId, sub.endpoint, sub.p256dh, sub.auth]
  });
  return { ok: true };
}

async function borrarSuscripcionPush(db, usuarioId, endpointRaw) {
  const endpoint = String(endpointRaw || "").trim();
  if (!endpoint.startsWith("https://")) return { ok: false, status: 400, error: "Endpoint inválido" };
  await db.execute({
    sql: "DELETE FROM push_suscripciones WHERE usuario_id = ? AND endpoint = ?",
    args: [usuarioId, endpoint]
  });
  return { ok: true };
}

function hojaDesdeTipo(tipo) {
  return HOJA_POR_TIPO[String(tipo || "")] || "inicio";
}

async function enviarPushUsuario(db, usuarioId, { titulo, cuerpo, tipo }) {
  if (!vapidConfigurado()) return;
  const id = Number(usuarioId);
  if (!id) return;
  const title = String(titulo || "MétodoG").slice(0, 80);
  const body = String(cuerpo || "").slice(0, 180);
  const hoja = hojaDesdeTipo(tipo);
  const payload = JSON.stringify({
    title,
    body,
    hoja,
    tag: `mg-${String(tipo || "aviso").slice(0, 40)}-${Date.now()}`
  });

  const r = await db.execute({
    sql: "SELECT endpoint, p256dh, auth FROM push_suscripciones WHERE usuario_id = ?",
    args: [id]
  });
  const filas = r.rows || [];
  await Promise.all(
    filas.map(async (fila) => {
      const endpoint = String(fila.endpoint || "");
      try {
        await webpush.sendNotification(
          {
            endpoint,
            keys: { p256dh: String(fila.p256dh || ""), auth: String(fila.auth || "") }
          },
          payload,
          { TTL: 60 * 60 * 12 }
        );
      } catch (err) {
        const code = Number(err?.statusCode || 0);
        if (code === 404 || code === 410) {
          await db.execute({
            sql: "DELETE FROM push_suscripciones WHERE endpoint = ?",
            args: [endpoint]
          });
          return;
        }
        console.error("push aviso:", code || err?.message || err);
      }
    })
  );
}

module.exports = {
  clavePublicaPush,
  ensureTablaPushSuscripciones,
  guardarSuscripcionPush,
  borrarSuscripcionPush,
  enviarPushUsuario
};
