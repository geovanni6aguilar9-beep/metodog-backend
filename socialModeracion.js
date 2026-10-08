/**
 * Moderación del muro (Guideline 1.2).
 * Reportes, aviso al fundador, borrar publicación y sacar al usuario del muro.
 */

const { crearNotificacion } = require("./notificaciones");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function esSuperAdmin(user) {
  return String(user?.rol || "").toUpperCase() === "SUPERADMIN";
}

async function ensureColumnasModeracion(db) {
  try {
    await db.execute("ALTER TABLE usuarios ADD COLUMN social_expulsado INTEGER NOT NULL DEFAULT 0");
  } catch (_) { /* ya existe */ }
  try {
    await db.execute("ALTER TABLE usuarios ADD COLUMN terminos_aceptados_at TEXT");
  } catch (_) { /* ya existe */ }
  try {
    await db.execute("ALTER TABLE social_posts ADD COLUMN archivado INTEGER NOT NULL DEFAULT 0");
  } catch (_) { /* ya existe */ }
  try {
    await db.execute("ALTER TABLE social_reportes ADD COLUMN estado TEXT NOT NULL DEFAULT 'pendiente'");
  } catch (_) { /* ya existe */ }
}

async function usuarioExpulsado(db, userId) {
  const uid = toNum(userId);
  if (!uid) return false;
  await ensureColumnasModeracion(db);
  const r = await db.execute({
    sql: "SELECT COALESCE(social_expulsado, 0) AS e FROM usuarios WHERE id = ?",
    args: [uid]
  });
  return Number(r.rows?.[0]?.e) === 1;
}

async function marcarTerminos(db, userId) {
  const uid = toNum(userId);
  if (!uid) return;
  await ensureColumnasModeracion(db);
  await db.execute({
    sql: "UPDATE usuarios SET terminos_aceptados_at = datetime('now') WHERE id = ?",
    args: [uid]
  });
}

async function marcarTerminosPorEmail(db, email) {
  const limpio = String(email || "").toLowerCase().trim();
  if (!limpio) return;
  await ensureColumnasModeracion(db);
  await db.execute({
    sql: "UPDATE usuarios SET terminos_aceptados_at = datetime('now') WHERE email = ?",
    args: [limpio]
  });
}

async function notificarFundador(db, { titulo, cuerpo, refTipo, refId }) {
  const admins = await db.execute({
    sql: "SELECT id FROM usuarios WHERE UPPER(rol) = 'SUPERADMIN'"
  });
  for (const row of admins.rows || []) {
    const id = toNum(row.id);
    if (!id) continue;
    try {
      await crearNotificacion(db, {
        usuarioId: id,
        tipo: "social_moderacion",
        titulo,
        cuerpo,
        refTipo: refTipo || "social_moderacion",
        refId: refId ?? null
      });
    } catch (err) {
      console.warn("notif moderacion:", err.message);
    }
  }
}

async function listarReportes(db, user) {
  if (!esSuperAdmin(user)) return { ok: false, status: 403, error: "Solo el fundador." };
  await ensureColumnasModeracion(db);
  const r = await db.execute(`
    SELECT r.id, r.post_id, r.motivo, r.detalle, r.created_at,
           COALESCE(r.estado, 'pendiente') AS estado,
           p.texto,
           p.usuario_id AS autor_id,
           COALESCE(p.archivado, 0) AS archivado,
           s.alias AS autor_alias,
           u.nombre AS autor_nombre,
           COALESCE(u.social_expulsado, 0) AS autor_expulsado,
           rep.nombre AS reporter_nombre
    FROM social_reportes r
    LEFT JOIN social_posts p ON p.id = r.post_id
    LEFT JOIN usuarios u ON u.id = p.usuario_id
    LEFT JOIN perfiles_sociales s ON s.usuario_id = p.usuario_id
    LEFT JOIN usuarios rep ON rep.id = r.reporter_id
    ORDER BY r.id DESC
    LIMIT 80
  `);
  const reportes = (r.rows || []).map((row) => ({
    id: toNum(row.id),
    post_id: toNum(row.post_id),
    motivo: row.motivo || "otro",
    detalle: row.detalle || null,
    created_at: row.created_at,
    estado: row.estado || "pendiente",
    texto: String(row.texto || "").slice(0, 180),
    autor_id: toNum(row.autor_id),
    autor_alias: row.autor_alias || null,
    autor_nombre: row.autor_nombre || null,
    autor_expulsado: Number(row.autor_expulsado) === 1,
    archivado: Number(row.archivado) === 1,
    reporter_nombre: row.reporter_nombre || null
  }));
  return { ok: true, reportes };
}

async function borrarPostModeracion(db, user, postIdRaw) {
  if (!esSuperAdmin(user)) return { ok: false, status: 403, error: "Solo el fundador." };
  const postId = toNum(postIdRaw);
  if (!postId) return { ok: false, status: 400, error: "Publicación inválida." };
  await ensureColumnasModeracion(db);
  const upd = await db.execute({
    sql: "UPDATE social_posts SET archivado = 1 WHERE id = ?",
    args: [postId]
  });
  if (!(upd.rowsAffected > 0)) {
    return { ok: false, status: 404, error: "Publicación no encontrada." };
  }
  await db.execute({
    sql: "UPDATE social_reportes SET estado = 'resuelto' WHERE post_id = ?",
    args: [postId]
  });
  return { ok: true };
}

async function expulsarUsuario(db, user, targetIdRaw) {
  if (!esSuperAdmin(user)) return { ok: false, status: 403, error: "Solo el fundador." };
  const tid = toNum(targetIdRaw);
  if (!tid || tid === toNum(user.id)) return { ok: false, status: 400, error: "Usuario inválido." };
  await ensureColumnasModeracion(db);
  const rol = await db.execute({
    sql: "SELECT rol FROM usuarios WHERE id = ?",
    args: [tid]
  });
  if (!rol.rows?.length) return { ok: false, status: 404, error: "No existe." };
  if (String(rol.rows[0].rol || "").toUpperCase() === "SUPERADMIN") {
    return { ok: false, status: 400, error: "No se puede sacar al fundador." };
  }
  await db.execute({
    sql: "UPDATE usuarios SET social_expulsado = 1 WHERE id = ?",
    args: [tid]
  });
  await db.execute({
    sql: "UPDATE social_posts SET archivado = 1 WHERE usuario_id = ?",
    args: [tid]
  });
  try {
    await db.execute({
      sql: "DELETE FROM social_historias WHERE usuario_id = ?",
      args: [tid]
    });
  } catch (err) {
    console.warn("expulsar historias:", err.message);
  }
  await db.execute({
    sql: `UPDATE social_reportes SET estado = 'resuelto'
          WHERE post_id IN (SELECT id FROM social_posts WHERE usuario_id = ?)`,
    args: [tid]
  });
  return { ok: true };
}

module.exports = {
  usuarioExpulsado,
  marcarTerminos,
  marcarTerminosPorEmail,
  notificarFundador,
  listarReportes,
  borrarPostModeracion,
  expulsarUsuario
};
