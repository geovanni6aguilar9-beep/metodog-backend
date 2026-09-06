/** Planes acordados §10 Biblia — MXN/mes, límites de alumnos coach. */

const TRIAL_DIAS = parseInt(process.env.STRIPE_COACH_TRIAL_DAYS || "14", 10) || 14;
const TRIAL_LIMITE_ALUMNOS = 2;

const COACH_TIERS = {
  starter: { nombre: "Starter", precioMxn: 499, alumnos: 5 },
  growth: { nombre: "Growth", precioMxn: 899, alumnos: 10 },
  pro: { nombre: "Pro", precioMxn: 1111, alumnos: 15 },
  studio: { nombre: "Studio", precioMxn: 2499, alumnos: 25 },
  elite: { nombre: "Elite", precioMxn: 4999, alumnos: 40 },
  trial: { nombre: "Trial", precioMxn: 0, alumnos: TRIAL_LIMITE_ALUMNOS }
};

const MONTO_ATLETA_MXN_DEFAULT = 149;
const PRODUCTO_ATLETA = "full_week_pro";
const PRODUCTO_COACH = "coach_suscripcion";
const PRODUCTO_PAQUETE_LEGACY = "paquete_rutina_6_dias";

function normalizarPlanCoach(plan) {
  const p = (plan || "starter").toLowerCase().trim();
  return COACH_TIERS[p] ? p : "starter";
}

function limiteAlumnosCoach(plan, status) {
  if (status === "trialing") return TRIAL_LIMITE_ALUMNOS;
  const tier = COACH_TIERS[normalizarPlanCoach(plan)];
  return tier ? tier.alumnos : COACH_TIERS.starter.alumnos;
}

function precioCoachMxn(plan) {
  const tier = COACH_TIERS[normalizarPlanCoach(plan)];
  return tier ? tier.precioMxn : COACH_TIERS.starter.precioMxn;
}

function suscripcionActiva(status) {
  return status === "active" || status === "trialing";
}

function trialEndIsoDesdeAhora() {
  const ms = TRIAL_DIAS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

function trialExpirado(trialEndIso) {
  if (!trialEndIso) return false;
  return new Date(trialEndIso).getTime() < Date.now();
}

module.exports = {
  TRIAL_DIAS,
  TRIAL_LIMITE_ALUMNOS,
  COACH_TIERS,
  MONTO_ATLETA_MXN_DEFAULT,
  PRODUCTO_ATLETA,
  PRODUCTO_COACH,
  PRODUCTO_PAQUETE_LEGACY,
  normalizarPlanCoach,
  limiteAlumnosCoach,
  precioCoachMxn,
  suscripcionActiva,
  trialEndIsoDesdeAhora,
  trialExpirado
};
