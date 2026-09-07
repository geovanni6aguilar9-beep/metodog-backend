/**
 * Solicitudes de vínculo coach↔cliente e inbox in-app.
 */

const { evaluarSuscripcionCoach } = require("./coachSuscripcion");

function toNum(v) {
  if (v == null) return null;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function ensureTablesNotificaciones(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS solicitudes_vinculo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL,
    coach_id INTEGER NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cliente_id) REFERENCES usuarios(id),
    FOREIGN KEY(coach_id) REFERENCES usuarios(id)
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    cuerpo TEXT,
    ref_tipo TEXT,
    ref_id INTEGER,
    leida INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  try {
    await db.execute("ALTER TABLE notificaciones ADD COLUMN meta TEXT");
  } catch (_) { /* ya existe */ }
}

async function crearNotificacion(db, { usuarioId, tipo, titulo, cuerpo, refTipo, refId, meta }) {
  await db.execute({
    sql: `INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, ref_tipo, ref_id, meta)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      usuarioId,
      tipo,
      titulo,
      cuerpo || null,
      refTipo || null,
      refId ?? null,
      meta != null ? (typeof meta === "string" ? meta : JSON.stringify(meta)) : null
    ]
  });
}

function parseMeta(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function formatearNotifSocial(tipo, actores, previewComentario) {
  const uniq = [...new Set((actores || []).filter(Boolean))];
  const a0 = uniq[0] || "alguien";
  if (tipo === "social_like") {
    if (uniq.length <= 1) {
      return {
        titulo: "Nuevo me gusta",
        cuerpo: `@${a0} le dio me gusta a tu publicación.`,
        meta: { actores: uniq }
      };
    }
    if (uniq.length === 2) {
      return {
        titulo: "Nuevos me gusta",
        cuerpo: `@${a0} y @${uniq[1]} le dieron me gusta.`,
        meta: { actores: uniq }
      };
    }
    return {
      titulo: "Nuevos me gusta",
      cuerpo: `@${a0} y ${uniq.length - 1} más le dieron me gusta.`,
      meta: { actores: uniq }
    };
  }
  // social_comentario
  const preview = previewComentario
    ? previewComentario.length > 72
      ? `${previewComentario.slice(0, 72)}…`
      : previewComentario
    : null;
  if (uniq.length <= 1) {
    return {
      titulo: "Nuevo comentario",
      cuerpo: preview ? `@${a0}: ${preview}` : `@${a0} comentó tu publicación.`,
      meta: { actores: uniq, preview: preview || null }
    };
  }
  if (uniq.length === 2) {
    return {
      titulo: "Nuevos comentarios",
      cuerpo: `@${a0} y @${uniq[1]} comentaron tu publicación.`,
      meta: { actores: uniq, preview: preview || null }
    };
  }
  return {
    titulo: "Nuevos comentarios",
    cuerpo: `@${a0} y ${uniq.length - 1} más comentaron tu publicación.`,
    meta: { actores: uniq, preview: preview || null }
  };
}

/**
 * Agrupa likes/comentarios del mismo post en una sola notif no leída (menos spam en campana).
 */
async function crearOAgruparNotifSocial(db, {
  usuarioId,
  tipo,
  actorAlias,
  refTipo = "social_post",
  refId,
  previewComentario
}) {
  if (!usuarioId || !tipo || !refId) return;
  const alias = String(actorAlias || "alguien").replace(/^@/, "").trim() || "alguien";

  const existing = await db.execute({
    sql: `SELECT id, meta, cuerpo FROM notificaciones
          WHERE usuario_id = ? AND tipo = ? AND ref_tipo = ? AND ref_id = ? AND leida = 0
          ORDER BY id DESC LIMIT 1`,
    args: [usuarioId, tipo, refTipo, refId]
  });

  if (existing.rows?.length) {
    const row = existing.rows[0];
    const metaPrev = parseMeta(row.meta) || {};
    let actores = Array.isArray(metaPrev.actores) ? [...metaPrev.actores] : [];
    if (!actores.length) {
      const m = String(row.cuerpo || "").match(/@([a-zA-Z0-9_]+)/);
      if (m) actores = [m[1]];
    }
    actores = [alias, ...actores.filter((a) => a !== alias)];
    const packed = formatearNotifSocial(tipo, actores, previewComentario || metaPrev.preview);
    await db.execute({
      sql: `UPDATE notificaciones
            SET titulo = ?, cuerpo = ?, meta = ?, created_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      args: [packed.titulo, packed.cuerpo, JSON.stringify(packed.meta), row.id]
    });
    return;
  }

  const packed = formatearNotifSocial(tipo, [alias], previewComentario);
  await crearNotificacion(db, {
    usuarioId,
    tipo,
    titulo: packed.titulo,
    cuerpo: packed.cuerpo,
    refTipo,
    refId,
    meta: packed.meta
  });
}

/** Colapsa filas legacy duplicadas (mismo tipo+post) al listar. */
function agruparNotifsSocialesEnLista(items) {
  const out = [];
  const indexByKey = new Map();
  for (const n of items) {
    if (n.tipo !== "social_like" && n.tipo !== "social_comentario") {
      out.push(n);
      continue;
    }
    const key = `${n.tipo}:${n.ref_id ?? ""}`;
    if (!indexByKey.has(key)) {
      const meta = parseMeta(n.meta) || {};
      const actores = Array.isArray(meta.actores) ? meta.actores : [];
      const packed = actores.length
        ? formatearNotifSocial(n.tipo, actores, meta.preview)
        : null;
      const item = {
        ...n,
        titulo: packed?.titulo || n.titulo,
        cuerpo: packed?.cuerpo || n.cuerpo,
        ids: [n.id],
        agrupada: false
      };
      indexByKey.set(key, out.length);
      out.push(item);
      continue;
    }
    const idx = indexByKey.get(key);
    const g = out[idx];
    g.ids.push(n.id);
    g.agrupada = true;
    if (!n.leida) g.leida = false;
    const metaG = parseMeta(g.meta) || {};
    const metaN = parseMeta(n.meta) || {};
    let actores = [
      ...(Array.isArray(metaN.actores) ? metaN.actores : []),
      ...(Array.isArray(metaG.actores) ? metaG.actores : [])
    ];
    if (!actores.length) {
      for (const body of [n.cuerpo, g.cuerpo]) {
        const m = String(body || "").match(/@([a-zA-Z0-9_]+)/);
        if (m) actores.push(m[1]);
      }
    }
    actores = [...new Set(actores.filter(Boolean))];
    const packed = formatearNotifSocial(n.tipo, actores, metaN.preview || metaG.preview);
    g.titulo = packed.titulo;
    g.cuerpo = packed.cuerpo;
    g.meta = packed.meta;
  }
  return out;
}

async function validarCoachRecibeCliente(db, coachId) {
  const coachRes = await db.execute({
    sql: "SELECT id, rol, nombre, email FROM usuarios WHERE id = ?",
    args: [coachId]
  });
  if (coachRes.rows.length === 0) {
    return { ok: false, error: "Coach no encontrado", status: 404 };
  }
  const coach = coachRes.rows[0];
  if (coach.rol !== "COACH" && coach.rol !== "SUPERADMIN") {
    return { ok: false, error: "El usuario no es coach", status: 400 };
  }
  if (coach.rol === "COACH") {
    const sub = await evaluarSuscripcionCoach(db, coachId);
    if (!sub) {
      return {
        ok: false,
        error: "Tu acceso de coach está en pausa. Reactiva tu plan para dar la bienvenida a nuevos alumnos.",
        status: 402,
        coach_solo_lectura: true
      };
    }
    const countRes = await db.execute({
      sql: "SELECT COUNT(*) as count FROM usuarios WHERE coach_id = ?",
      args: [coachId]
    });
    const count = Number(countRes.rows[0]?.count || 0);
    if (sub.limite_efectivo && count >= Number(sub.limite_efectivo)) {
      return {
        ok: false,
        error: "Has llegado al límite de alumnos de tu plan. Amplía tu suscripción para seguir incorporando atletas.",
        status: 400
      };
    }
  }
  return { ok: true, coach };
}

async function obtenerSolicitudPendienteCliente(db, clienteId) {
  const r = await db.execute({
    sql: `SELECT s.id, s.coach_id, s.created_at, u.nombre AS coach_nombre
          FROM solicitudes_vinculo s
          JOIN usuarios u ON u.id = s.coach_id
          WHERE s.cliente_id = ? AND s.estado = 'pendiente'
          ORDER BY s.created_at DESC LIMIT 1`,
    args: [clienteId]
  });
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: toNum(row.id),
    coach_id: toNum(row.coach_id),
    coach_nombre: row.coach_nombre,
    created_at: row.created_at
  };
}

async function enrichUsuarioVinculo(db, usuario) {
  if (!usuario) return usuario;
  if (usuario.rol === "CLIENTE") {
    usuario.solicitud_vinculo_pendiente = await obtenerSolicitudPendienteCliente(db, usuario.id);
  }
  const c = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ? AND leida = 0",
    args: [usuario.id]
  });
  usuario.notificaciones_no_leidas = Number(c.rows[0]?.n || 0);
  return usuario;
}

/** Coach (o superadmin) guardó plan de un alumno → notificación in-app al cliente.
 *  @param {{ silencioso?: boolean }} [opts] — autosave: no notifica. Siempre dedupe si ya hay una no leída del mismo tipo.
 */
async function notificarClientePlanActualizado(db, req, clienteId, tipo, opts = {}) {
  if (opts.silencioso) return;

  const targetId = parseInt(clienteId, 10);
  const actorId = parseInt(req.user?.id, 10);
  if (!targetId || targetId === actorId) return;
  if (req.user?.rol !== "COACH" && req.user?.rol !== "SUPERADMIN") return;

  const clienteRes = await db.execute({
    sql: "SELECT id, coach_id FROM usuarios WHERE id = ?",
    args: [targetId]
  });
  if (clienteRes.rows.length === 0) return;
  const cliente = clienteRes.rows[0];

  if (req.user.rol === "COACH" && Number(cliente.coach_id) !== actorId) return;

  /** Ya hay aviso no leído del mismo tipo → no spamear (autosaves / varios Guardar). */
  const unread = await db.execute({
    sql: `SELECT id FROM notificaciones
          WHERE usuario_id = ? AND tipo = ? AND leida = 0
          LIMIT 1`,
    args: [targetId, tipo]
  });
  if (unread.rows.length > 0) return;

  const coachRes = await db.execute({
    sql: "SELECT nombre FROM usuarios WHERE id = ?",
    args: [actorId]
  });
  const coachNombre = coachRes.rows[0]?.nombre || "Tu coach";

  if (tipo === "plan_rutina") {
    await crearNotificacion(db, {
      usuarioId: targetId,
      tipo: "plan_rutina",
      titulo: "Nueva rutina disponible",
      cuerpo: `${coachNombre} actualizó tu rutina. Revísala en Rutinas.`,
      refTipo: "plan_rutina",
      refId: actorId
    });
  } else if (tipo === "plan_dieta") {
    await crearNotificacion(db, {
      usuarioId: targetId,
      tipo: "plan_dieta",
      titulo: "Nueva dieta disponible",
      cuerpo: `${coachNombre} actualizó tu plan nutricional. Revísala en Nutrición.`,
      refTipo: "plan_dieta",
      refId: actorId
    });
  }
}

async function cancelarSolicitudesPendientesCliente(db, clienteId, exceptId = null) {
  const args = [clienteId];
  let sql = `UPDATE solicitudes_vinculo SET estado = 'cancelada', updated_at = datetime('now')
             WHERE cliente_id = ? AND estado = 'pendiente'`;
  if (exceptId) {
    sql += " AND id != ?";
    args.push(exceptId);
  }
  await db.execute({ sql, args });
}

async function enviarEmailCoachSolicitud(resend, coach, clienteNombre, clienteEmail) {
  if (!resend || !coach?.email) return;
  try {
    const { remiteResend } = require("./emailFrom");
    await resend.emails.send({
      from: remiteResend(),
      to: coach.email,
      subject: "📩 Nueva solicitud de vinculación en MétodoG",
      html: `<p>Hola <b>${coach.nombre || "Coach"}</b>,</p>
             <p><b>${clienteNombre}</b> quiere vincularse contigo en MétodoG.</p>
             <p>Email del alumno: ${clienteEmail || "—"}</p>
             <p>Abre la campanita en la app para <b>aceptar o rechazar</b> la solicitud.</p>`
    });
  } catch (_) { /* best-effort */ }
}

async function solicitarVinculoCoach(db, { clienteId, coachId, resend }) {
  const coachCheck = await validarCoachRecibeCliente(db, coachId);
  if (!coachCheck.ok) {
    return { ok: false, error: coachCheck.error, status: coachCheck.status };
  }

  const clienteRes = await db.execute({
    sql: "SELECT id, nombre, email, coach_id FROM usuarios WHERE id = ?",
    args: [clienteId]
  });
  if (clienteRes.rows.length === 0) {
    return { ok: false, error: "Cliente no encontrado", status: 404 };
  }
  const cliente = clienteRes.rows[0];

  if (Number(cliente.coach_id) === Number(coachId)) {
    return { ok: false, error: "Ya estás vinculado con este coach", status: 400 };
  }

  if (cliente.coach_id != null && cliente.coach_id !== "") {
    return {
      ok: false,
      error: "Ya tienes un coach asignado. Desvincúlate en Mi Coach o Ajustes antes de solicitar otro.",
      status: 400
    };
  }

  const pendienteRes = await db.execute({
    sql: `SELECT id FROM solicitudes_vinculo
          WHERE cliente_id = ? AND coach_id = ? AND estado = 'pendiente'`,
    args: [clienteId, coachId]
  });
  if (pendienteRes.rows.length > 0) {
    return {
      ok: true,
      pendiente: true,
      mensaje: "Ya enviaste una solicitud a este coach. Espera su respuesta.",
      solicitud_id: toNum(pendienteRes.rows[0].id)
    };
  }

  await cancelarSolicitudesPendientesCliente(db, clienteId);

  const ins = await db.execute({
    sql: `INSERT INTO solicitudes_vinculo (cliente_id, coach_id, estado)
          VALUES (?, ?, 'pendiente')`,
    args: [clienteId, coachId]
  });
  const solicitudId = toNum(ins.lastInsertRowid);

  await crearNotificacion(db, {
    usuarioId: coachId,
    tipo: "solicitud_vinculo",
    titulo: "Nueva solicitud de alumno",
    cuerpo: `${cliente.nombre || "Un cliente"} quiere vincularse contigo.`,
    refTipo: "solicitud_vinculo",
    refId: solicitudId
  });

  await enviarEmailCoachSolicitud(resend, coachCheck.coach, cliente.nombre, cliente.email);

  return {
    ok: true,
    pendiente: true,
    mensaje: "Solicitud enviada. El coach debe aceptarte en la app.",
    solicitud_id: solicitudId
  };
}

async function responderSolicitudVinculo(db, { solicitudId, coachUserId, accion, resend }) {
  const solRes = await db.execute({
    sql: `SELECT s.*, c.nombre AS cliente_nombre, c.email AS cliente_email
          FROM solicitudes_vinculo s
          JOIN usuarios c ON c.id = s.cliente_id
          WHERE s.id = ?`,
    args: [solicitudId]
  });
  if (solRes.rows.length === 0) {
    return { ok: false, error: "Solicitud no encontrada", status: 404 };
  }
  const sol = solRes.rows[0];

  if (Number(sol.coach_id) !== Number(coachUserId)) {
    return { ok: false, error: "No puedes responder esta solicitud", status: 403 };
  }
  if (sol.estado !== "pendiente") {
    return { ok: false, error: "Esta solicitud ya fue procesada", status: 400 };
  }

  const aceptar = accion === "aceptar";

  if (aceptar) {
    const coachCheck = await validarCoachRecibeCliente(db, coachUserId);
    if (!coachCheck.ok) {
      return { ok: false, error: coachCheck.error, status: coachCheck.status };
    }

    const upd = await db.execute({
      sql: "UPDATE usuarios SET coach_id = ? WHERE id = ?",
      args: [coachUserId, sol.cliente_id]
    });
    if ((upd.rowsAffected ?? 0) === 0) {
      return { ok: false, error: "No se pudo vincular al alumno", status: 500 };
    }

    await db.execute({
      sql: `UPDATE solicitudes_vinculo SET estado = 'aceptada', updated_at = datetime('now') WHERE id = ?`,
      args: [solicitudId]
    });
    await cancelarSolicitudesPendientesCliente(db, sol.cliente_id, solicitudId);

    await crearNotificacion(db, {
      usuarioId: sol.cliente_id,
      tipo: "vinculo_aceptado",
      titulo: "¡Vinculación aceptada!",
      cuerpo: `Tu coach ${coachCheck.coach?.nombre || ""} aceptó tu solicitud. Ya puedes ver tus planes.`,
      refTipo: "solicitud_vinculo",
      refId: solicitudId
    });

    await db.execute({
      sql: `UPDATE notificaciones SET leida = 1
            WHERE usuario_id = ? AND ref_tipo = 'solicitud_vinculo' AND ref_id = ?`,
      args: [coachUserId, solicitudId]
    });

    return { ok: true, mensaje: "Alumno vinculado correctamente", cliente_id: toNum(sol.cliente_id) };
  }

  await db.execute({
    sql: `UPDATE solicitudes_vinculo SET estado = 'rechazada', updated_at = datetime('now') WHERE id = ?`,
    args: [solicitudId]
  });

  await crearNotificacion(db, {
    usuarioId: sol.cliente_id,
    tipo: "vinculo_rechazado",
    titulo: "Solicitud no aceptada",
    cuerpo: "El coach no aceptó tu solicitud de vinculación. Puedes probar con otro en el directorio.",
    refTipo: "solicitud_vinculo",
    refId: solicitudId
  });

  await db.execute({
    sql: `UPDATE notificaciones SET leida = 1
          WHERE usuario_id = ? AND ref_tipo = 'solicitud_vinculo' AND ref_id = ?`,
      args: [coachUserId, solicitudId]
  });

  return { ok: true, mensaje: "Solicitud rechazada" };
}

/** Etiqueta legible de meta desde dieta sembrada en onboarding (modo libre). */
function metaLabelFromDieta(datosDietaRaw) {
  if (!datosDietaRaw) return null;
  try {
    const d = typeof datosDietaRaw === "string" ? JSON.parse(datosDietaRaw) : datosDietaRaw;
    const etiqueta = d?.calculadora?.calcResultado?.etiqueta;
    if (etiqueta && String(etiqueta).trim()) return String(etiqueta).trim();
    const tipo = d?.calculadora?.calcForm?.tipoAjuste;
    if (tipo === "restar") return "Perder grasa";
    if (tipo === "sumar") return "Ganar músculo";
    if (tipo === "mantener") return "Mantener peso";
    return null;
  } catch {
    return null;
  }
}

function buildPreviewSolicitud(sol, metaLabel) {
  if (!sol) return null;
  return {
    edad: sol.edad != null ? Number(sol.edad) : null,
    estatura: sol.estatura != null ? Number(sol.estatura) : null,
    peso_kg: sol.peso_kg != null ? Number(sol.peso_kg) : null,
    genero: sol.genero || null,
    enfermedades: sol.enfermedades || "",
    intencion_atleta: sol.intencion_atleta || null,
    meta_label: metaLabel || null
  };
}

async function listarNotificaciones(db, userId, { filtro, limite = 50 }) {
  const args = [userId];
  let sql = `SELECT id, tipo, titulo, cuerpo, ref_tipo, ref_id, leida, created_at, meta
             FROM notificaciones WHERE usuario_id = ?`;
  if (filtro === "planes") {
    sql += " AND tipo IN ('plan_rutina', 'plan_dieta')";
  } else if (filtro === "vinculo") {
    sql += " AND tipo IN ('vinculo_aceptado', 'vinculo_rechazado')";
  } else if (filtro === "social_solicitud") {
    sql += " AND tipo IN ('social_solicitud', 'social_aceptada', 'social_mensaje', 'social_like', 'social_comentario')";
  } else if (filtro && filtro !== "all" && filtro !== "todas") {
    sql += " AND tipo = ?";
    args.push(filtro);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(Math.min(Math.max(parseInt(limite, 10) || 50, 1), 100));

  const r = await db.execute({ sql, args });
  const items = (r.rows || []).map((row) => ({
    ...row,
    leida: !!row.leida
  }));

  const solicitudIds = items
    .filter((n) => n.tipo === "solicitud_vinculo" && n.ref_id != null)
    .map((n) => toNum(n.ref_id))
    .filter((id) => id != null);

  let solicitudesMap = {};
  if (solicitudIds.length > 0) {
    const placeholders = solicitudIds.map(() => "?").join(",");
    const sRes = await db.execute({
      sql: `SELECT s.id, s.estado, s.cliente_id, u.nombre AS cliente_nombre, u.email AS cliente_email,
                   p.edad, p.estatura, p.peso_kg, p.genero, p.enfermedades, p.intencion_atleta
            FROM solicitudes_vinculo s
            JOIN usuarios u ON u.id = s.cliente_id
            LEFT JOIN perfiles_clientes p ON p.usuario_id = s.cliente_id
            WHERE s.id IN (${placeholders})`,
      args: solicitudIds
    });
    for (const s of sRes.rows || []) {
      solicitudesMap[toNum(s.id)] = s;
    }
  }

  const clienteIds = [
    ...new Set(
      Object.values(solicitudesMap)
        .map((s) => toNum(s.cliente_id))
        .filter((id) => id != null)
    )
  ];
  const metaPorCliente = {};
  if (clienteIds.length > 0) {
    const ph = clienteIds.map(() => "?").join(",");
    const dRes = await db.execute({
      sql: `SELECT usuario_id, datos_dieta FROM dietas WHERE usuario_id IN (${ph})`,
      args: clienteIds
    });
    for (const row of dRes.rows || []) {
      const cid = toNum(row.usuario_id);
      if (cid != null) metaPorCliente[cid] = metaLabelFromDieta(row.datos_dieta);
    }
  }

  const mapped = items.map((n) => {
    const refId = toNum(n.ref_id);
    const sol = refId != null ? solicitudesMap[refId] : null;
    const clienteId = sol ? toNum(sol.cliente_id) : null;
    return {
      ...n,
      id: toNum(n.id),
      ref_id: refId,
      leida: !!n.leida,
      meta: parseMeta(n.meta),
      solicitud: sol
        ? {
            id: toNum(sol.id),
            estado: sol.estado,
            cliente_id: clienteId,
            cliente_nombre: sol.cliente_nombre,
            cliente_email: sol.cliente_email,
            preview: buildPreviewSolicitud(sol, metaPorCliente[clienteId])
          }
        : null
    };
  });

  return agruparNotifsSocialesEnLista(mapped);
}

async function contarNotificacionesNoLeidas(db, userId) {
  const r = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ? AND leida = 0",
    args: [userId]
  });
  return Number(r.rows[0]?.n || 0);
}

async function marcarNotificacionLeida(db, userId, notifId) {
  const id = toNum(notifId);
  if (!id) return false;
  const row = await db.execute({
    sql: `SELECT tipo, ref_tipo, ref_id FROM notificaciones WHERE id = ? AND usuario_id = ?`,
    args: [id, userId]
  });
  const n = row.rows?.[0];
  if (!n) return false;

  if (
    (n.tipo === "social_like" || n.tipo === "social_comentario") &&
    n.ref_tipo === "social_post" &&
    n.ref_id != null
  ) {
    const r = await db.execute({
      sql: `UPDATE notificaciones SET leida = 1
            WHERE usuario_id = ? AND tipo = ? AND ref_tipo = ? AND ref_id = ? AND leida = 0`,
      args: [userId, n.tipo, n.ref_tipo, n.ref_id]
    });
    return (r.rowsAffected ?? 0) > 0;
  }

  const r = await db.execute({
    sql: "UPDATE notificaciones SET leida = 1 WHERE id = ? AND usuario_id = ?",
    args: [id, userId]
  });
  return (r.rowsAffected ?? 0) > 0;
}

async function marcarTodasNotificacionesLeidas(db, userId) {
  const r = await db.execute({
    sql: "UPDATE notificaciones SET leida = 1 WHERE usuario_id = ? AND leida = 0",
    args: [userId]
  });
  return r.rowsAffected ?? 0;
}

async function borrarNotificacion(db, userId, notifId) {
  const r = await db.execute({
    sql: "DELETE FROM notificaciones WHERE id = ? AND usuario_id = ?",
    args: [notifId, userId]
  });
  return (r.rowsAffected ?? 0) > 0;
}

async function borrarTodasNotificaciones(db, userId) {
  const r = await db.execute({
    sql: "DELETE FROM notificaciones WHERE usuario_id = ?",
    args: [userId]
  });
  return r.rowsAffected ?? 0;
}

module.exports = {
  ensureTablesNotificaciones,
  crearNotificacion,
  crearOAgruparNotifSocial,
  enrichUsuarioVinculo,
  solicitarVinculoCoach,
  responderSolicitudVinculo,
  listarNotificaciones,
  contarNotificacionesNoLeidas,
  marcarNotificacionLeida,
  marcarTodasNotificacionesLeidas,
  borrarNotificacion,
  borrarTodasNotificaciones,
  cancelarSolicitudesPendientesCliente,
  notificarClientePlanActualizado
};
