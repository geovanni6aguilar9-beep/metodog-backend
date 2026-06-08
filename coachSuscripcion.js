/**
 * Lógica de suscripción coach (sin Stripe) — evita dependencia circular pagos ↔ notificaciones.
 */
const { limiteAlumnosCoach, suscripcionActiva, trialExpirado } = require("./planesSuscripcion");

async function evaluarSuscripcionCoach(db, coachId) {
  const subRes = await db.execute({
    sql: `SELECT plan, status, limite_clientes, trial_end
          FROM suscripciones_coach WHERE usuario_id = ?`,
    args: [coachId]
  });
  if (subRes.rows.length === 0) return null;

  const s = subRes.rows[0];
  if (s.status === "trialing" && trialExpirado(s.trial_end)) {
    await db.execute({
      sql: `UPDATE suscripciones_coach SET status = 'canceled', updated_at = datetime('now') WHERE usuario_id = ?`,
      args: [coachId]
    });
    return null;
  }

  if (!suscripcionActiva(s.status)) return null;

  const limiteDb = Number(s.limite_clientes);
  const limiteEfectivo =
    Number.isFinite(limiteDb) && limiteDb > 0
      ? limiteDb
      : limiteAlumnosCoach(s.plan, s.status);

  return {
    plan: s.plan,
    status: s.status,
    limite_efectivo: limiteEfectivo,
    trial_end: s.trial_end
  };
}

/** Gracia solo lectura: coach sin suscripción activa no edita perfiles ajenos (sí el propio). */
async function coachPuedeEditarPerfilAjeno(db, authUser, targetUserId) {
  const tid = parseInt(targetUserId, 10);
  const aid = parseInt(authUser?.id, 10);
  if (!tid || Number.isNaN(tid) || !aid || Number.isNaN(aid)) return false;
  if (tid === aid) return true;
  if (authUser.rol === "SUPERADMIN") return true;
  if (authUser.rol !== "COACH") return tid === aid;
  const sub = await evaluarSuscripcionCoach(db, aid);
  return !!sub;
}

module.exports = { evaluarSuscripcionCoach, coachPuedeEditarPerfilAjeno };
