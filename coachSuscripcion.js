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

  return {
    plan: s.plan,
    status: s.status,
    limite_efectivo: limiteAlumnosCoach(s.plan, s.status),
    trial_end: s.trial_end
  };
}

module.exports = { evaluarSuscripcionCoach };
