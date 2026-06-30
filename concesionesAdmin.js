/**
 * Concesiones manuales SUPERADMIN — carril ops (sin ensuciar Stripe).
 * Precedencia: concesión admin activa > Stripe > legacy > freemium.
 */
const {
  normalizarPlanCoach,
  limiteAlumnosCoach,
  COACH_TIERS,
  PRODUCTO_ATLETA
} = require("./planesSuscripcion");

const PLANES_ATLETA = new Set(["full_week", "full_week_pro"]);
const PLANES_COACH = new Set(Object.keys(COACH_TIERS).filter((p) => p !== "trial"));
const DURACIONES_VALIDAS = new Set(["1m", "3m", "6m", "lifetime"]);

function isoAhora() {
  return new Date().toISOString();
}

function finDesdeDuracion(duracion) {
  if (duracion === "lifetime") return null;
  const meses = { "1m": 1, "3m": 3, "6m": 6 }[duracion];
  if (!meses) return null;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString();
}

function concesionEstaActiva(row) {
  if (!row || row.status !== "active") return false;
  if (!row.fin) return true;
  return new Date(row.fin).getTime() > Date.now();
}

async function ensureTableConcesiones(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS concesiones_admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    inicio TEXT NOT NULL,
    fin TEXT,
    descuento_pct INTEGER,
    motivo TEXT NOT NULL,
    concedido_por INTEGER NOT NULL,
    stripe_coupon_id TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    revoked_por INTEGER,
    motivo_revocacion TEXT,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_concesiones_usuario ON concesiones_admin(usuario_id, status)"
  );
}

async function obtenerConcesionActiva(db, usuarioId) {
  const uid = parseInt(usuarioId, 10);
  if (!uid || Number.isNaN(uid)) return null;

  const res = await db.execute({
    sql: `SELECT * FROM concesiones_admin
          WHERE usuario_id = ? AND status = 'active'
          ORDER BY datetime(created_at) DESC, id DESC`,
    args: [uid]
  });

  for (const row of res.rows || []) {
    if (concesionEstaActiva(row)) return row;
    if (row.fin && new Date(row.fin).getTime() <= Date.now()) {
      await db.execute({
        sql: `UPDATE concesiones_admin SET status = 'expired' WHERE id = ? AND status = 'active'`,
        args: [row.id]
      });
    }
  }
  return null;
}

function mapConcesionEntitlements(concesion) {
  if (!concesion || !concesionEstaActiva(concesion)) return null;

  if (concesion.tipo === "atleta") {
    return {
      origen: "admin",
      tipo: "atleta",
      plan: "full_week_pro",
      fin: concesion.fin || null,
      concesion_id: concesion.id
    };
  }

  if (concesion.tipo === "coach") {
    const plan = normalizarPlanCoach(concesion.plan);
    return {
      origen: "admin",
      tipo: "coach",
      plan,
      status: "active",
      limite_efectivo: limiteAlumnosCoach(plan, "active"),
      fin: concesion.fin || null,
      concesion_id: concesion.id
    };
  }

  return null;
}

async function asegurarRolCoach(db, usuarioId) {
  const userRes = await db.execute({
    sql: "SELECT id, rol, codigo_invitacion FROM usuarios WHERE id = ?",
    args: [usuarioId]
  });
  if (userRes.rows.length === 0) return { ok: false, error: "Usuario no encontrado" };
  const u = userRes.rows[0];
  if (u.rol === "SUPERADMIN") return { ok: true, usuario: u };
  if (u.rol === "COACH") return { ok: true, usuario: u };

  let codigo = u.codigo_invitacion;
  if (!codigo) {
    codigo = `MG${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  await db.execute({
    sql: "UPDATE usuarios SET rol = 'COACH', codigo_invitacion = COALESCE(codigo_invitacion, ?) WHERE id = ?",
    args: [codigo, usuarioId]
  });
  return { ok: true, promoted: true };
}

async function listarConcesiones(db, { usuarioId, soloActivas = false } = {}) {
  let sql = `SELECT c.*, u.nombre AS usuario_nombre, u.email AS usuario_email,
             a.nombre AS admin_nombre
             FROM concesiones_admin c
             JOIN usuarios u ON u.id = c.usuario_id
             LEFT JOIN usuarios a ON a.id = c.concedido_por
             WHERE 1=1`;
  const args = [];

  if (usuarioId) {
    sql += " AND c.usuario_id = ?";
    args.push(parseInt(usuarioId, 10));
  }
  if (soloActivas) {
    sql += " AND c.status = 'active' AND (c.fin IS NULL OR datetime(c.fin) > datetime('now'))";
  }
  sql += " ORDER BY datetime(c.created_at) DESC, c.id DESC LIMIT 200";

  const res = await db.execute({ sql, args });
  return (res.rows || []).map((r) => ({
    id: Number(r.id),
    usuario_id: Number(r.usuario_id),
    usuario_nombre: r.usuario_nombre,
    usuario_email: r.usuario_email,
    tipo: r.tipo,
    plan: r.plan,
    status: r.status,
    inicio: r.inicio,
    fin: r.fin,
    descuento_pct: r.descuento_pct != null ? Number(r.descuento_pct) : null,
    motivo: r.motivo,
    concedido_por: Number(r.concedido_por),
    admin_nombre: r.admin_nombre || null,
    created_at: r.created_at,
    revoked_at: r.revoked_at || null,
    motivo_revocacion: r.motivo_revocacion || null,
    activa: concesionEstaActiva(r)
  }));
}

async function otorgarConcesion(db, payload) {
  const usuarioId = parseInt(payload.usuario_id, 10);
  const adminId = parseInt(payload.concedido_por, 10);
  const tipo = String(payload.tipo || "").toLowerCase().trim();
  const planRaw = String(payload.plan || "").toLowerCase().trim();
  const duracion = String(payload.duracion || "").toLowerCase().trim();
  const motivo = String(payload.motivo || "").trim();

  if (!usuarioId || Number.isNaN(usuarioId)) {
    return { ok: false, status: 400, error: "usuario_id inválido" };
  }
  if (!adminId || Number.isNaN(adminId)) {
    return { ok: false, status: 400, error: "admin inválido" };
  }
  if (!["atleta", "coach"].includes(tipo)) {
    return { ok: false, status: 400, error: "tipo debe ser atleta o coach" };
  }
  if (!DURACIONES_VALIDAS.has(duracion)) {
    return { ok: false, status: 400, error: "duracion inválida (1m, 3m, 6m, lifetime)" };
  }
  if (motivo.length < 10) {
    return { ok: false, status: 400, error: "motivo obligatorio (mín. 10 caracteres)" };
  }

  let plan = planRaw;
  if (tipo === "atleta") {
    if (!PLANES_ATLETA.has(plan) && plan !== "full_week_pro") {
      plan = "full_week_pro";
    }
  } else if (!PLANES_COACH.has(plan)) {
    return { ok: false, status: 400, error: "plan coach inválido" };
  }

  const userRes = await db.execute({
    sql: "SELECT id, rol, email, nombre FROM usuarios WHERE id = ?",
    args: [usuarioId]
  });
  if (userRes.rows.length === 0) {
    return { ok: false, status: 404, error: "Usuario no encontrado" };
  }
  const user = userRes.rows[0];
  if (user.rol === "SUPERADMIN") {
    return { ok: false, status: 400, error: "No se aplican concesiones a SUPERADMIN" };
  }

  if (tipo === "coach") {
    const promo = await asegurarRolCoach(db, usuarioId);
    if (!promo.ok) return { ok: false, status: 404, error: promo.error };
  }

  const inicio = isoAhora();
  const fin = finDesdeDuracion(duracion);
  const now = isoAhora();

  await db.execute({
    sql: `UPDATE concesiones_admin SET status = 'revoked', revoked_at = ?, revoked_por = ?, motivo_revocacion = ?
          WHERE usuario_id = ? AND status = 'active' AND tipo = ?`,
    args: [now, adminId, "Reemplazada por nueva concesión admin", usuarioId, tipo]
  });

  const ins = await db.execute({
    sql: `INSERT INTO concesiones_admin
          (usuario_id, tipo, plan, status, inicio, fin, descuento_pct, motivo, concedido_por, created_at)
          VALUES (?, ?, ?, 'active', ?, ?, 100, ?, ?, ?)
          RETURNING id`,
    args: [usuarioId, tipo, plan, inicio, fin, motivo, adminId, now]
  });

  if (!ins.rows?.length) {
    return { ok: false, status: 500, error: "No se pudo crear la concesión" };
  }

  const concesionId = ins.rows[0].id;

  if (tipo === "atleta") {
    await db.execute({
      sql: "UPDATE usuarios SET paquete_rutina_6_dias = 1 WHERE id = ?",
      args: [usuarioId]
    });
  }

  if (tipo === "coach") {
    const planNorm = normalizarPlanCoach(plan);
    const limite = limiteAlumnosCoach(planNorm, "active");
    await db.execute({
      sql: `INSERT INTO suscripciones_coach (usuario_id, plan, status, limite_clientes, current_period_end, updated_at)
            VALUES (?, ?, 'active', ?, ?, datetime('now'))
            ON CONFLICT(usuario_id) DO UPDATE SET
              plan = excluded.plan,
              status = 'active',
              limite_clientes = excluded.limite_clientes,
              current_period_end = excluded.current_period_end,
              updated_at = datetime('now')`,
      args: [usuarioId, planNorm, limite, fin]
    });
  }

  return {
    ok: true,
    concesion_id: concesionId ? Number(concesionId) : null,
    mensaje: `Concesión ${tipo} otorgada a ${user.nombre || user.email}.`
  };
}

async function revocarConcesion(db, concesionId, adminId, motivoRevocacion) {
  const id = parseInt(concesionId, 10);
  const aid = parseInt(adminId, 10);
  const motivo = String(motivoRevocacion || "").trim();

  if (!id || Number.isNaN(id)) return { ok: false, status: 400, error: "ID inválido" };
  if (motivo.length < 10) {
    return { ok: false, status: 400, error: "motivo_revocacion obligatorio (mín. 10 caracteres)" };
  }

  const rowRes = await db.execute({
    sql: "SELECT * FROM concesiones_admin WHERE id = ?",
    args: [id]
  });
  if (rowRes.rows.length === 0) {
    return { ok: false, status: 404, error: "Concesión no encontrada" };
  }
  const row = rowRes.rows[0];
  if (row.status !== "active") {
    return { ok: false, status: 400, error: "La concesión ya no está activa" };
  }

  const now = isoAhora();
  const upd = await db.execute({
    sql: `UPDATE concesiones_admin SET status = 'revoked', revoked_at = ?, revoked_por = ?, motivo_revocacion = ?
          WHERE id = ? AND status = 'active'`,
    args: [now, aid, motivo, id]
  });
  if ((upd.rowsAffected ?? 0) === 0) {
    return { ok: false, status: 500, error: "No se pudo revocar" };
  }

  const uid = Number(row.usuario_id);

  if (row.tipo === "atleta") {
    const stripeRes = await db.execute({
      sql: `SELECT status FROM suscripciones_atleta WHERE usuario_id = ?`,
      args: [uid]
    });
    const stripeActiva =
      stripeRes.rows[0] && ["active", "trialing"].includes(stripeRes.rows[0].status);
    const userRes = await db.execute({
      sql: "SELECT paquete_grandfathered FROM usuarios WHERE id = ?",
      args: [uid]
    });
    const grandfather = !!userRes.rows[0]?.paquete_grandfathered;
    if (!stripeActiva && !grandfather) {
      await db.execute({
        sql: "UPDATE usuarios SET paquete_rutina_6_dias = 0 WHERE id = ?",
        args: [uid]
      });
    }
  }

  if (row.tipo === "coach") {
    const subRes = await db.execute({
      sql: `SELECT stripe_subscription_id, status FROM suscripciones_coach WHERE usuario_id = ?`,
      args: [uid]
    });
    const sub = subRes.rows[0];
    if (!sub?.stripe_subscription_id) {
      await db.execute({
        sql: `UPDATE suscripciones_coach SET status = 'canceled', updated_at = datetime('now') WHERE usuario_id = ?`,
        args: [uid]
      });
    }
  }

  return { ok: true, mensaje: "Concesión revocada." };
}

function badgeSuscripcionUsuario(row, concesionActiva) {
  if (concesionActiva) return "admin";
  if (
    ["active", "trialing"].includes(row.coach_sub_status) ||
    ["active", "trialing"].includes(row.atleta_sub_status)
  ) {
    return "stripe";
  }
  if (row.paquete_grandfathered || row.paquete_rutina_6_dias) return "grandfathered";
  return "freemium";
}

module.exports = {
  PLANES_ATLETA,
  PLANES_COACH,
  DURACIONES_VALIDAS,
  PRODUCTO_ATLETA,
  ensureTableConcesiones,
  obtenerConcesionActiva,
  mapConcesionEntitlements,
  listarConcesiones,
  otorgarConcesion,
  revocarConcesion,
  concesionEstaActiva,
  badgeSuscripcionUsuario
};
