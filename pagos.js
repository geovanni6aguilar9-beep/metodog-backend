const Stripe = require("stripe");
const {
  TRIAL_DIAS,
  TRIAL_LIMITE_ALUMNOS,
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
} = require("./planesSuscripcion");
const { evaluarSuscripcionCoach } = require("./coachSuscripcion");
const { obtenerConcesionActiva, mapConcesionEntitlements } = require("./concesionesAdmin");

const MONTO_PAQUETE_MXN_DEFAULT = 149;
const PRODUCTO_PAQUETE_LEGACY_NOMBRE = "MétodoG — Rutina Full Week (6 días)";
const PRODUCTO_ATLETA_NOMBRE = "MétodoG PRO";
const PRODUCTO_COACH_NOMBRE = "MétodoG Coach PRO";

function getStripe() {
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return null;
  return new Stripe(key);
}

const { withMetodogAliases } = require("./corsConfig");

function getFrontendOrigins() {
  const raw = (process.env.FRONTEND_URL || process.env.CORS_ORIGINS || "http://localhost:5173").trim();
  const list = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (list.length === 0) return ["http://localhost:5173"];
  return withMetodogAliases(list);
}

function isAllowedReturnUrl(url) {
  try {
    const origin = new URL(url).origin;
    return getFrontendOrigins().some(base => new URL(base).origin === origin);
  } catch {
    return false;
  }
}

function montoCentavos(envKey, defaultMxn) {
  const monto = parseInt(process.env[envKey] || String(defaultMxn), 10);
  return Math.max(1000, monto * 100);
}

function montoCoachCentavos(plan) {
  const planKey = normalizarPlanCoach(plan).toUpperCase();
  const envKey = `STRIPE_COACH_${planKey}_MXN`;
  const fromEnv = parseInt(process.env[envKey] || "", 10);
  const monto = Number.isNaN(fromEnv) ? precioCoachMxn(plan) : fromEnv;
  return Math.max(1000, monto * 100);
}

/** Price ID de Stripe Dashboard (modo test/live). Si falta, checkout usa price_data inline. */
function stripePriceIdAtleta() {
  return (process.env.STRIPE_PRICE_FULL_WEEK || process.env.STRIPE_PRICE_ATLETA || "").trim();
}

function stripePriceIdCoach(plan) {
  const p = normalizarPlanCoach(plan).toUpperCase();
  return (process.env[`STRIPE_PRICE_COACH_${p}`] || "").trim();
}

function planDesdePriceId(priceId) {
  if (!priceId) return null;
  const tiers = ["starter", "growth", "pro", "studio", "elite"];
  for (const tier of tiers) {
    if (stripePriceIdCoach(tier) === priceId) return tier;
  }
  return null;
}

function productoDesdeMetadata(meta) {
  const producto = (meta?.producto || "").trim();
  if (producto === PRODUCTO_ATLETA || producto === PRODUCTO_COACH || producto === PRODUCTO_PAQUETE_LEGACY) {
    return producto;
  }
  return null;
}

function inferirProductoSuscripcion(subscription) {
  const fromMeta = productoDesdeMetadata(subscription.metadata);
  if (fromMeta) return fromMeta;

  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (priceId && priceId === stripePriceIdAtleta()) return PRODUCTO_ATLETA;
  if (planDesdePriceId(priceId)) return PRODUCTO_COACH;

  return null;
}

function inferirPlanSuscripcion(subscription, planHint) {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const fromPrice = planDesdePriceId(priceId);
  const status = subscription?.status || "canceled";

  if (status === "trialing") {
    return fromPrice || "starter";
  }

  if (fromPrice) return fromPrice;
  return normalizarPlanCoach(subscription.metadata?.plan || planHint);
}

async function coachSuscripcionPagada(stripe, subscription) {
  const status = subscription?.status;
  if (status === "trialing") return true;
  if (status === "past_due" || status === "incomplete" || status === "incomplete_expired") {
    return false;
  }
  if (status !== "active") return false;

  const invRef = subscription.latest_invoice;
  if (!invRef) return true;

  const invoice =
    typeof invRef === "string" ? await stripe.invoices.retrieve(invRef) : invRef;

  if (!invoice) return true;
  return invoice.status === "paid";
}

async function inferirPlanCoachDesdeStripe(stripe, subscription, planHint) {
  const status = subscription?.status || "canceled";
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const fromPrice = planDesdePriceId(priceId);

  if (status === "trialing") {
    return fromPrice || "starter";
  }

  const pagoOk = await coachSuscripcionPagada(stripe, subscription);
  if (!pagoOk) {
    return "starter";
  }

  if (fromPrice) return fromPrice;
  return normalizarPlanCoach(subscription.metadata?.plan || planHint);
}

function trialEndIsoFromStripeSub(sub) {
  if (!sub?.trial_end) return null;
  return new Date(sub.trial_end * 1000).toISOString();
}

async function stripeCustomerValido(stripe, customerId) {
  if (!customerId) return false;
  try {
    await stripe.customers.retrieve(customerId);
    return true;
  } catch (err) {
    if (/no such customer/i.test(err.message)) return false;
    throw err;
  }
}

/** Recupera customer live si la BD tiene un cus_ de test u obsoleto. */
async function recuperarStripeCustomerCoach(db, stripe, userId) {
  const subRes = await db.execute({
    sql: `SELECT stripe_customer_id, stripe_subscription_id FROM suscripciones_coach WHERE usuario_id = ?`,
    args: [userId]
  });
  if (subRes.rows.length === 0) {
    return {
      customerId: null,
      error: "No hay suscripción Stripe vinculada. Si estás en trial, elige un plan pagado."
    };
  }

  const row = subRes.rows[0];
  let customerId = row.stripe_customer_id || null;
  const subId = row.stripe_subscription_id || null;

  if (await stripeCustomerValido(stripe, customerId)) {
    return { customerId };
  }

  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      const fixed = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      if (fixed && (await stripeCustomerValido(stripe, fixed))) {
        await db.execute({
          sql: `UPDATE suscripciones_coach SET stripe_customer_id = ?, updated_at = datetime('now') WHERE usuario_id = ?`,
          args: [fixed, userId]
        });
        console.log(`✓ Stripe customer sincronizado usuario ${userId}: ${fixed}`);
        return { customerId: fixed };
      }
    } catch (err) {
      if (!/no such subscription/i.test(err.message)) {
        console.error("recuperarStripeCustomerCoach sub:", err.message);
      }
    }
  }

  return {
    customerId: null,
    stale: true,
    error:
      "Tu suscripción en Stripe no coincide con el modo live. Vuelve a suscribirte desde «Elegir plan» o contacta soporte."
  };
}

/** Quita IDs Stripe obsoletos (test) para permitir checkout live limpio. */
async function resetSuscripcionCoachStripeObsoleto(db, userId) {
  const result = await db.execute({
    sql: `UPDATE suscripciones_coach SET
            stripe_customer_id = NULL,
            stripe_subscription_id = NULL,
            status = 'canceled',
            cancel_at_period_end = 0,
            current_period_end = NULL,
            trial_end = NULL,
            plan = 'starter',
            limite_clientes = 0,
            trial_usado = 1,
            updated_at = datetime('now')
          WHERE usuario_id = ?`,
    args: [userId]
  });
  return (result.rowsAffected ?? 0) > 0;
}

function mensajeErrorPagoStripe(err) {
  const code = err?.code || err?.raw?.code;
  const decline = err?.decline_code || err?.raw?.decline_code;
  if (
    code === "card_declined" ||
    decline === "insufficient_funds" ||
    decline === "generic_decline"
  ) {
    return "Tu tarjeta no tiene fondos suficientes o fue rechazada. No se activó el plan.";
  }
  if ((err?.statusCode || err?.raw?.statusCode) === 402) {
    return "No se pudo cobrar la suscripción. Verifica tu tarjeta e inténtalo de nuevo.";
  }
  return err?.message || "No se pudo procesar el pago.";
}

async function pagoUpgradeCoachConfirmado(stripe, subscription) {
  const subStatus = subscription?.status;
  if (
    subStatus === "past_due" ||
    subStatus === "incomplete" ||
    subStatus === "incomplete_expired" ||
    subStatus === "trialing"
  ) {
    return false;
  }

  const invRef = subscription?.latest_invoice;
  if (!invRef) {
    return subStatus === "active";
  }

  const invoice =
    typeof invRef === "string" ? await stripe.invoices.retrieve(invRef) : invRef;

  if (invoice?.status === "paid") return true;
  if (invoice?.status === "open" || invoice?.status === "uncollectible") return false;
  return subStatus === "active" && invoice?.status !== "void";
}

async function resetCoachStripeLive(req, res, db) {
  const userId = parseInt(req.user.id, 10);
  if (req.user?.rol === "SUPERADMIN") {
    return res.status(400).json({ error: "Las cuentas SUPERADMIN no usan suscripción Stripe." });
  }
  try {
    await resetSuscripcionCoachStripeObsoleto(db, userId);
    return res.json({
      ok: true,
      mensaje: "Datos de prueba eliminados. Elige un plan para suscribirte en Stripe Live."
    });
  } catch (err) {
    console.error("resetCoachStripeLive:", err.message);
    return res.status(500).json({ error: err.message || "No se pudo limpiar la suscripción." });
  }
}

const generarCodigo = () => Math.random().toString(36).substring(2, 8).toUpperCase();

async function upsertSuscripcionAtleta(db, {
  usuarioId,
  stripeCustomerId,
  stripeSubscriptionId,
  status,
  currentPeriodEnd,
  cancelAtPeriodEnd
}) {
  await db.execute({
    sql: `INSERT INTO suscripciones_atleta (
            usuario_id, stripe_customer_id, stripe_subscription_id, status,
            current_period_end, cancel_at_period_end, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(usuario_id) DO UPDATE SET
            stripe_customer_id = excluded.stripe_customer_id,
            stripe_subscription_id = excluded.stripe_subscription_id,
            status = excluded.status,
            current_period_end = excluded.current_period_end,
            cancel_at_period_end = excluded.cancel_at_period_end,
            updated_at = datetime('now')`,
    args: [
      usuarioId,
      stripeCustomerId || null,
      stripeSubscriptionId || null,
      status,
      currentPeriodEnd || null,
      cancelAtPeriodEnd ? 1 : 0
    ]
  });
}

async function upsertSuscripcionCoach(db, {
  usuarioId,
  plan,
  stripeCustomerId,
  stripeSubscriptionId,
  status,
  limiteClientes,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  trialEnd,
  trialUsado
}) {
  const planNorm = normalizarPlanCoach(plan);
  const limite = limiteClientes ?? limiteAlumnosCoach(planNorm, status);
  const marcarTrial = trialUsado ? 1 : status === "trialing" ? 1 : 0;
  await db.execute({
    sql: `INSERT INTO suscripciones_coach (
            usuario_id, plan, stripe_customer_id, stripe_subscription_id, status,
            limite_clientes, current_period_end, cancel_at_period_end, trial_end, trial_usado, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(usuario_id) DO UPDATE SET
            plan = excluded.plan,
            stripe_customer_id = excluded.stripe_customer_id,
            stripe_subscription_id = excluded.stripe_subscription_id,
            status = excluded.status,
            limite_clientes = excluded.limite_clientes,
            current_period_end = excluded.current_period_end,
            cancel_at_period_end = excluded.cancel_at_period_end,
            trial_end = excluded.trial_end,
            trial_usado = MAX(COALESCE(suscripciones_coach.trial_usado, 0), COALESCE(excluded.trial_usado, 0)),
            updated_at = datetime('now')`,
    args: [
      usuarioId,
      planNorm,
      stripeCustomerId || null,
      stripeSubscriptionId || null,
      status,
      limite,
      currentPeriodEnd || null,
      cancelAtPeriodEnd ? 1 : 0,
      trialEnd || null,
      marcarTrial
    ]
  });
}

async function activarPaqueteGrandfathered(db, usuarioId) {
  const result = await db.execute({
    sql: `UPDATE usuarios SET paquete_rutina_6_dias = 1, paquete_grandfathered = 1 WHERE id = ?`,
    args: [usuarioId]
  });
  return (result.rowsAffected ?? 0) > 0;
}

async function syncPaqueteDesdeSuscripcion(db, usuarioId) {
  const uRes = await db.execute({
    sql: "SELECT paquete_rutina_6_dias, paquete_grandfathered FROM usuarios WHERE id = ?",
    args: [usuarioId]
  });
  if (uRes.rows.length === 0) return false;

  const u = uRes.rows[0];
  if (u.paquete_grandfathered) {
    if (!u.paquete_rutina_6_dias) {
      await db.execute({
        sql: "UPDATE usuarios SET paquete_rutina_6_dias = 1 WHERE id = ?",
        args: [usuarioId]
      });
    }
    return true;
  }

  const subRes = await db.execute({
    sql: "SELECT status FROM suscripciones_atleta WHERE usuario_id = ?",
    args: [usuarioId]
  });
  const status = subRes.rows[0]?.status;
  const activo = suscripcionActiva(status);
  const flag = activo ? 1 : 0;

  if (Number(u.paquete_rutina_6_dias) !== flag) {
    await db.execute({
      sql: "UPDATE usuarios SET paquete_rutina_6_dias = ? WHERE id = ?",
      args: [flag, usuarioId]
    });
  }
  return activo;
}

async function migrarPaquetesGrandfathered(db) {
  try {
    await db.execute(`
      UPDATE usuarios SET paquete_grandfathered = 1
      WHERE paquete_rutina_6_dias = 1
        AND COALESCE(paquete_grandfathered, 0) = 0
    `);
  } catch (err) {
    console.warn("migrarPaquetesGrandfathered:", err.message);
  }
}

async function ascenderUsuarioACoach(db, usuarioId) {
  const userRes = await db.execute({
    sql: "SELECT id, rol, codigo_invitacion, coach_id FROM usuarios WHERE id = ?",
    args: [usuarioId]
  });
  if (userRes.rows.length === 0) return false;

  const user = userRes.rows[0];
  if (user.rol === "SUPERADMIN") return true;

  if (user.coach_id != null && user.coach_id !== "") {
    console.warn(`ascenderUsuarioACoach bloqueado: usuario ${usuarioId} tiene coach_id`);
    return false;
  }

  const codigo = user.codigo_invitacion || generarCodigo();
  const result = await db.execute({
    sql: "UPDATE usuarios SET rol = 'COACH', codigo_invitacion = ? WHERE id = ?",
    args: [codigo, usuarioId]
  });
  return (result.rowsAffected ?? 0) > 0;
}

async function activarAtletaDesdeStripe(db, stripe, usuarioId, subscriptionId, customerId) {
  let status = "active";
  let currentPeriodEnd = null;
  let cancelAtPeriodEnd = false;

  if (subscriptionId) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    status = sub.status || "active";
    cancelAtPeriodEnd = !!sub.cancel_at_period_end;
    if (sub.current_period_end) {
      currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
    }
  }

  await upsertSuscripcionAtleta(db, {
    usuarioId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd
  });
  await syncPaqueteDesdeSuscripcion(db, usuarioId);
  return true;
}

async function syncSuscripcionAtletaPorStripeId(db, stripe, stripeSubscriptionId) {
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const usuarioId =
    sub.metadata?.usuario_id ||
    (await db.execute({
      sql: "SELECT usuario_id FROM suscripciones_atleta WHERE stripe_subscription_id = ?",
      args: [stripeSubscriptionId]
    })).rows[0]?.usuario_id;

  if (!usuarioId) {
    console.error("Suscripción atleta sin usuario_id:", stripeSubscriptionId);
    return false;
  }

  const uid = parseInt(usuarioId, 10);
  const status = sub.status || "canceled";
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;
  const cancelAtPeriodEnd = !!sub.cancel_at_period_end;

  await upsertSuscripcionAtleta(db, {
    usuarioId: uid,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripeSubscriptionId: sub.id,
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd
  });
  await syncPaqueteDesdeSuscripcion(db, uid);
  return true;
}

async function activarCoachDesdeStripe(db, stripe, usuarioId, subscriptionId, customerId, planHint) {
  let status = "active";
  let currentPeriodEnd = null;
  let cancelAtPeriodEnd = false;
  let plan = normalizarPlanCoach(planHint);

  let trialEnd = null;
  if (subscriptionId) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["latest_invoice"]
    });
    status = sub.status || "active";
    cancelAtPeriodEnd = !!sub.cancel_at_period_end;
    plan = await inferirPlanCoachDesdeStripe(stripe, sub, planHint);
    if (sub.current_period_end) {
      currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
    }
    trialEnd = trialEndIsoFromStripeSub(sub);
    if (!customerId) {
      customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    }
  }

  const ok = await ascenderUsuarioACoach(db, usuarioId);
  if (!ok) return false;

  await upsertSuscripcionCoach(db, {
    usuarioId,
    plan,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status,
    limiteClientes: limiteAlumnosCoach(plan, status),
    currentPeriodEnd,
    cancelAtPeriodEnd,
    trialEnd
  });

  return true;
}

async function syncSuscripcionCoachPorStripeId(db, stripe, stripeSubscriptionId) {
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["latest_invoice"]
  });
  const usuarioId =
    sub.metadata?.usuario_id ||
    (await db.execute({
      sql: "SELECT usuario_id FROM suscripciones_coach WHERE stripe_subscription_id = ?",
      args: [stripeSubscriptionId]
    })).rows[0]?.usuario_id;

  if (!usuarioId) {
    console.error("Suscripción coach sin usuario_id:", stripeSubscriptionId);
    return false;
  }

  const uid = parseInt(usuarioId, 10);
  const status = sub.status || "canceled";
  let plan = await inferirPlanCoachDesdeStripe(stripe, sub, null);
  const pagoOk = await coachSuscripcionPagada(stripe, sub);
  if (!pagoOk && status !== "trialing") {
    plan = "starter";
  }
  let limiteClientes = limiteAlumnosCoach(plan, status);
  if (!pagoOk && status !== "trialing") {
    limiteClientes = TRIAL_LIMITE_ALUMNOS;
  }
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;
  const cancelAtPeriodEnd = !!sub.cancel_at_period_end;
  const trialEnd = trialEndIsoFromStripeSub(sub);

  await upsertSuscripcionCoach(db, {
    usuarioId: uid,
    plan,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripeSubscriptionId: sub.id,
    status,
    limiteClientes,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    trialEnd
  });

  if (suscripcionActiva(status)) {
    await ascenderUsuarioACoach(db, uid);
  }

  return true;
}

async function iniciarTrialCoach(req, res, db) {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Pagos no configurados (falta STRIPE_SECRET_KEY)" });
    }

    const userId = parseInt(req.user.id, 10);

    const userRes = await db.execute({
      sql: "SELECT id, rol, coach_id, email, nombre FROM usuarios WHERE id = ?",
      args: [userId]
    });
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const user = userRes.rows[0];
    if (user.coach_id != null && user.coach_id !== "") {
      return res.status(400).json({
        error: "Tienes un coach asignado. Desvincúlate en Ajustes → Mi Coach antes de probar como coach."
      });
    }
    if (user.rol === "SUPERADMIN") {
      return res.status(400).json({ error: "Tu cuenta ya tiene acceso total." });
    }

    const subRes = await db.execute({
      sql: `SELECT status, trial_end, stripe_subscription_id, trial_usado FROM suscripciones_coach WHERE usuario_id = ?`,
      args: [userId]
    });

    if (subRes.rows.length > 0) {
      const prev = subRes.rows[0];
      if (Number(prev.trial_usado) === 1 || prev.trial_end || prev.stripe_subscription_id) {
        return res.status(400).json({
          error: "Ya usaste tu periodo de prueba. Elige un plan Coach PRO para continuar."
        });
      }
      if (prev.status === "trialing" && !trialExpirado(prev.trial_end)) {
        return res.status(400).json({ error: "Ya tienes un trial activo." });
      }
      if (prev.status === "active") {
        return res.status(400).json({ error: "Ya tienes una suscripción Coach activa." });
      }
    }

    const { success_url, cancel_url } = req.body || {};
    const base = getFrontendOrigins()[0];
    const successUrl = success_url || `${base}/?coach_success=true`;
    const cancelUrl = cancel_url || `${base}/?coach_canceled=true`;

    if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
      return res.status(400).json({ error: "URL de retorno no permitida" });
    }

    const plan = "starter";
    const priceId = stripePriceIdCoach(plan);
    const montoMxn = precioCoachMxn(plan);

    const buildLineItems = (usePriceId) =>
      usePriceId
        ? [{ price: usePriceId, quantity: 1 }]
        : [
            {
              quantity: 1,
              price_data: {
                currency: "mxn",
                unit_amount: montoCoachCentavos(plan),
                recurring: { interval: "month" },
                product_data: {
                  name: `${PRODUCTO_COACH_NOMBRE} — Starter`,
                  description: `Trial ${TRIAL_DIAS} días · luego $${montoMxn} MXN/mes. Tarjeta requerida.`
                }
              }
            }
          ];

    const sessionPayload = {
      mode: "subscription",
      payment_method_types: ["card"],
      payment_method_collection: "always",
      customer_email: user.email || undefined,
      client_reference_id: String(userId),
      metadata: {
        usuario_id: String(userId),
        producto: PRODUCTO_COACH,
        plan,
        es_trial: "1"
      },
      subscription_data: {
        trial_period_days: TRIAL_DIAS,
        metadata: {
          usuario_id: String(userId),
          producto: PRODUCTO_COACH,
          plan
        }
      },
      success_url: successUrl,
      cancel_url: cancelUrl
    };

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        ...sessionPayload,
        line_items: buildLineItems(priceId)
      });
    } catch (err) {
      if (priceId && /no such price/i.test(err.message)) {
        console.error(
          `Stripe trial coach: Price ID inválido (${priceId}). Usando precio inline.`
        );
        session = await stripe.checkout.sessions.create({
          ...sessionPayload,
          line_items: buildLineItems(null)
        });
      } else {
        throw err;
      }
    }

    return res.json({
      url: session.url,
      session_id: session.id,
      trial_dias: TRIAL_DIAS,
      limite_alumnos: limiteAlumnosCoach("trial", "trialing"),
      mensaje: `Confirma tu tarjeta en Stripe para activar ${TRIAL_DIAS} días de prueba (sin cargo hoy).`
    });
  } catch (err) {
    console.error("iniciarTrialCoach:", err.message);
    return res.status(500).json({
      error: err.message || "Error interno al iniciar trial. Revisa logs del servidor."
    });
  }
}

async function crearCheckoutAtleta(req, res, db) {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: "Pagos no configurados (falta STRIPE_SECRET_KEY)" });
  }

  const userId = parseInt(req.user.id, 10);
  const userRes = await db.execute({
    sql: "SELECT id, email, nombre, coach_id, paquete_rutina_6_dias, paquete_grandfathered, rol FROM usuarios WHERE id = ?",
    args: [userId]
  });
  if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

  const user = userRes.rows[0];
  if (user.coach_id) {
    return res.status(400).json({
      error: "MétodoG PRO es para atletas en modo libre. Si tienes coach, usa la rutina que te asigna."
    });
  }

  await syncPaqueteDesdeSuscripcion(db, userId);
  const refreshed = await db.execute({
    sql: "SELECT paquete_rutina_6_dias FROM usuarios WHERE id = ?",
    args: [userId]
  });
  if (refreshed.rows[0]?.paquete_rutina_6_dias) {
    return res.status(400).json({ error: "Ya tienes MétodoG PRO activo." });
  }

  const { success_url, cancel_url } = req.body || {};
  const base = getFrontendOrigins()[0];
  const successUrl = success_url || `${base}/?success=true`;
  const cancelUrl = cancel_url || `${base}/?canceled=true`;

  if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
    return res.status(400).json({ error: "URL de retorno no permitida" });
  }

  try {
    const priceId = stripePriceIdAtleta();
    const buildLineItems = (usePriceId) =>
      usePriceId
        ? [{ price: usePriceId, quantity: 1 }]
        : [
            {
              quantity: 1,
              price_data: {
                currency: "mxn",
                unit_amount: montoCentavos("STRIPE_ATLETA_PRECIO_MXN", MONTO_ATLETA_MXN_DEFAULT),
                recurring: { interval: "month" },
                product_data: {
                  name: PRODUCTO_ATLETA_NOMBRE,
                  description: "Diseño 6 días + calculadora clínica Katch. Suscripción mensual."
                }
              }
            }
          ];

    const sessionPayload = {
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      client_reference_id: String(userId),
      metadata: {
        usuario_id: String(userId),
        producto: PRODUCTO_ATLETA
      },
      subscription_data: {
        metadata: {
          usuario_id: String(userId),
          producto: PRODUCTO_ATLETA
        }
      },
      success_url: successUrl,
      cancel_url: cancelUrl
    };

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        ...sessionPayload,
        line_items: buildLineItems(priceId)
      });
    } catch (err) {
      if (priceId && /no such price/i.test(err.message)) {
        console.error(
          `Stripe checkout atleta: Price ID inválido (${priceId}). Usando precio inline. Actualiza STRIPE_PRICE_FULL_WEEK en Render con un price_ live.`
        );
        session = await stripe.checkout.sessions.create({
          ...sessionPayload,
          line_items: buildLineItems(null)
        });
      } else {
        throw err;
      }
    }

    res.json({ url: session.url, session_id: session.id, modo: "subscription", price_id: priceId || null });
  } catch (err) {
    console.error("Stripe checkout atleta:", err.message);
    res.status(500).json({ error: err.message || "No se pudo crear la sesión de pago" });
  }
}

async function upgradeCoachPlanStripe(req, res, db, stripe, userId, plan) {
  const subRes = await db.execute({
    sql: `SELECT stripe_subscription_id, status FROM suscripciones_coach WHERE usuario_id = ?`,
    args: [userId]
  });
  const row = subRes.rows[0];
  if (!row?.stripe_subscription_id) {
    return res.status(400).json({ error: "No hay suscripción Stripe para actualizar." });
  }
  if (row.status !== "trialing") {
    return res.status(400).json({ error: "Solo puedes hacer upgrade automático durante el trial activo." });
  }

  const planNorm = normalizarPlanCoach(plan);
  const priceId = stripePriceIdCoach(planNorm);
  if (!priceId) {
    return res.status(503).json({
      error: `Falta STRIPE_PRICE_COACH_${planNorm.toUpperCase()} en el servidor para upgrade.`
    });
  }

  try {
    const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const itemId = sub.items?.data?.[0]?.id;
    if (!itemId) {
      return res.status(500).json({ error: "Suscripción Stripe sin ítems de precio." });
    }

    const updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
      items: [{ id: itemId, price: priceId }],
      trial_end: "now",
      cancel_at_period_end: false,
      payment_behavior: "error_if_incomplete",
      metadata: {
        ...(sub.metadata || {}),
        usuario_id: String(userId),
        producto: PRODUCTO_COACH,
        plan: planNorm
      },
      proration_behavior: "none",
      expand: ["latest_invoice"]
    });

    const pagoOk = await pagoUpgradeCoachConfirmado(stripe, updated);
    if (!pagoOk) {
      await syncSuscripcionCoachPorStripeId(db, stripe, row.stripe_subscription_id);
      return res.status(402).json({
        error: "Tu tarjeta no tiene fondos suficientes o fue rechazada. No se activó el plan."
      });
    }

    await syncSuscripcionCoachPorStripeId(db, stripe, updated.id);

    return res.json({
      ok: true,
      upgraded: true,
      plan: planNorm,
      limite_alumnos: limiteAlumnosCoach(planNorm, updated.status),
      mensaje: `Plan ${planNorm.charAt(0).toUpperCase() + planNorm.slice(1)} activado. Ya puedes vincular más alumnos.`
    });
  } catch (err) {
    console.error("upgradeCoachPlanStripe:", err.message);
    try {
      await syncSuscripcionCoachPorStripeId(db, stripe, row.stripe_subscription_id);
    } catch (syncErr) {
      console.warn("Re-sync tras fallo upgrade:", syncErr.message);
    }
    const http = err?.statusCode || err?.raw?.statusCode;
    const esPago =
      http === 402 ||
      err?.code === "card_declined" ||
      err?.decline_code === "insufficient_funds" ||
      /payment|card|fund|declin/i.test(String(err?.message || ""));
    return res.status(esPago ? 402 : 500).json({ error: mensajeErrorPagoStripe(err) });
  }
}

async function crearCheckoutCoach(req, res, db) {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: "Pagos no configurados (falta STRIPE_SECRET_KEY)" });
  }

  const userId = parseInt(req.user.id, 10);
  const userRes = await db.execute({
    sql: `SELECT u.id, u.email, u.nombre, u.rol, u.coach_id,
          s.status AS sub_status, s.trial_end, s.stripe_subscription_id, s.trial_usado
          FROM usuarios u
          LEFT JOIN suscripciones_coach s ON s.usuario_id = u.id
          WHERE u.id = ?`,
    args: [userId]
  });
  if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

  const user = userRes.rows[0];
  if (user.coach_id != null && user.coach_id !== "") {
    return res.status(400).json({
      error: "Tienes un coach asignado. Desvincúlate en Ajustes → Mi Coach antes de suscribirte como coach."
    });
  }
  if (user.rol === "SUPERADMIN") {
    return res.status(400).json({ error: "Tu cuenta ya tiene acceso total de administrador." });
  }

  const { success_url, cancel_url, plan: planBody } = req.body || {};
  const plan = normalizarPlanCoach(planBody || process.env.STRIPE_COACH_PLAN || "starter");

  if (user.sub_status === "trialing" && user.stripe_subscription_id) {
    return upgradeCoachPlanStripe(req, res, db, stripe, userId, plan);
  }

  if (user.sub_status === "active") {
    return res.status(400).json({ error: "Ya tienes una suscripción Coach activa." });
  }
  const base = getFrontendOrigins()[0];
  const successUrl = success_url || `${base}/?coach_success=true`;
  const cancelUrl = cancel_url || `${base}/?coach_canceled=true`;

  if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
    return res.status(400).json({ error: "URL de retorno no permitida" });
  }

  const limite = limiteAlumnosCoach(plan, "active");
  const montoMxn = precioCoachMxn(plan);

  try {
    const priceId = stripePriceIdCoach(plan);
    const buildLineItems = (usePriceId) =>
      usePriceId
        ? [{ price: usePriceId, quantity: 1 }]
        : [
            {
              quantity: 1,
              price_data: {
                currency: "mxn",
                unit_amount: montoCoachCentavos(plan),
                recurring: { interval: "month" },
                product_data: {
                  name: `${PRODUCTO_COACH_NOMBRE} — ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
                  description: `Suscripción mensual · hasta ${limite} alumnos`
                }
              }
            }
          ];

    const sessionPayload = {
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      client_reference_id: String(userId),
      metadata: {
        usuario_id: String(userId),
        producto: PRODUCTO_COACH,
        plan
      },
      subscription_data: {
        metadata: {
          usuario_id: String(userId),
          producto: PRODUCTO_COACH,
          plan
        }
      },
      success_url: successUrl,
      cancel_url: cancelUrl
    };

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        ...sessionPayload,
        line_items: buildLineItems(priceId)
      });
    } catch (err) {
      if (priceId && /no such price/i.test(err.message)) {
        console.error(
          `Stripe checkout coach: Price ID inválido (${priceId}). Usando precio inline. Actualiza STRIPE_PRICE_COACH_${plan.toUpperCase()} en Render.`
        );
        session = await stripe.checkout.sessions.create({
          ...sessionPayload,
          line_items: buildLineItems(null)
        });
      } else {
        throw err;
      }
    }

    res.json({
      url: session.url,
      session_id: session.id,
      plan,
      precio_mxn: montoMxn,
      limite_alumnos: limite,
      price_id: priceId || null
    });
  } catch (err) {
    console.error("Stripe checkout coach:", err.message);
    res.status(500).json({ error: err.message || "No se pudo crear la suscripción" });
  }
}

async function procesarCheckoutCompletado(db, stripe, session) {
  const usuarioId = session.metadata?.usuario_id || session.client_reference_id;
  if (!usuarioId) {
    throw new Error(`checkout.session.completed sin usuario_id (${session.id})`);
  }

  const uid = parseInt(usuarioId, 10);
  let producto = productoDesdeMetadata(session.metadata);

  if (!producto && session.subscription) {
    const sub = await stripe.subscriptions.retrieve(String(session.subscription));
    producto = inferirProductoSuscripcion(sub);
  }

  if (!producto) {
    throw new Error(`checkout.session.completed sin producto reconocido (${session.id})`);
  }

  if (producto === PRODUCTO_ATLETA) {
    await activarAtletaDesdeStripe(db, stripe, uid, session.subscription, session.customer);
    console.log(`✅ Webhook: MétodoG PRO activado usuario ${usuarioId}`);
    return;
  }

  if (producto === PRODUCTO_COACH) {
    const ok = await activarCoachDesdeStripe(
      db,
      stripe,
      uid,
      session.subscription,
      session.customer,
      session.metadata?.plan
    );
    if (!ok) throw new Error(`coach no activado usuario ${usuarioId}`);
    console.log(`✅ Webhook: Coach PRO (${session.metadata?.plan || "?"}) usuario ${usuarioId}`);
    return;
  }

  if (producto === PRODUCTO_PAQUETE_LEGACY) {
    const ok = await activarPaqueteGrandfathered(db, uid);
    if (!ok) throw new Error(`paquete legacy no actualizado usuario ${usuarioId}`);
    console.log(`✅ Webhook: paquete legacy grandfathered usuario ${usuarioId}`);
  }
}

async function procesarSuscripcionStripe(db, stripe, subscription, eventType) {
  const producto = inferirProductoSuscripcion(subscription);

  if (producto === PRODUCTO_ATLETA) {
    await syncSuscripcionAtletaPorStripeId(db, stripe, subscription.id);
    console.log(`🔄 Webhook ${eventType}: atleta sub ${subscription.id} → ${subscription.status}`);
    return;
  }

  if (producto === PRODUCTO_COACH || !producto) {
    await syncSuscripcionCoachPorStripeId(db, stripe, subscription.id);
    console.log(
      `🔄 Webhook ${eventType}: coach sub ${subscription.id} → ${subscription.status}` +
        (producto ? "" : " (producto inferido por fila DB)")
    );
    return;
  }

  console.warn(`Webhook ${eventType}: suscripción ${subscription.id} sin producto reconocido`);
}

async function handleStripeWebhook(req, res, db) {
  const stripe = getStripe();
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();

  if (!stripe || !webhookSecret) {
    return res.status(503).send("Webhook no configurado");
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) return res.status(400).send("Falta firma Stripe");

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook firma inválida:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await procesarCheckoutCompletado(db, stripe, event.data.object);
        break;

      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await procesarSuscripcionStripe(db, stripe, event.data.object, event.type);
        break;

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(String(invoice.subscription));
          await procesarSuscripcionStripe(db, stripe, sub, event.type);
        }
        break;
      }

      default:
        console.log(`Webhook ignorado: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler:", err.message);
    res.status(500).send("Error interno");
  }
}

async function crearPortalCoach(req, res, db) {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: "Pagos no configurados (falta STRIPE_SECRET_KEY)" });
  }

  const userId = parseInt(req.user.id, 10);
  const { customerId, error: recoverError, stale } = await recuperarStripeCustomerCoach(db, stripe, userId);

  if (!customerId) {
    if (stale) {
      await resetSuscripcionCoachStripeObsoleto(db, userId);
      return res.status(409).json({
        error: recoverError,
        needs_resubscribe: true,
        mensaje:
          "Limpiamos datos de prueba en tu cuenta. Elige un plan para suscribirte de nuevo en Stripe Live."
      });
    }
    return res.status(400).json({
      error: recoverError || "No hay suscripción Stripe vinculada. Si estás en trial, elige un plan pagado."
    });
  }

  const { return_url } = req.body || {};
  const base = getFrontendOrigins()[0];
  const returnUrl = return_url || `${base}/?coach_portal=1`;

  if (!isAllowedReturnUrl(returnUrl)) {
    return res.status(400).json({ error: "URL de retorno no permitida" });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe portal coach:", err.message);
    res.status(500).json({ error: err.message || "No se pudo abrir el portal." });
  }
}

async function enrichUsuarioConSuscripcion(db, usuario) {
  if (!usuario) return usuario;

  await syncPaqueteDesdeSuscripcion(db, usuario.id);

  const userRefresh = await db.execute({
    sql: "SELECT paquete_rutina_6_dias, paquete_grandfathered FROM usuarios WHERE id = ?",
    args: [usuario.id]
  });
  if (userRefresh.rows[0]) {
    usuario.paquete_rutina_6_dias = !!userRefresh.rows[0].paquete_rutina_6_dias;
    usuario.paquete_grandfathered = !!userRefresh.rows[0].paquete_grandfathered;
  }

  const atletaRes = await db.execute({
    sql: `SELECT status, current_period_end, cancel_at_period_end
          FROM suscripciones_atleta WHERE usuario_id = ?`,
    args: [usuario.id]
  });
  if (atletaRes.rows.length > 0) {
    const a = atletaRes.rows[0];
    usuario.atleta_suscripcion_status = a.status;
    usuario.atleta_suscripcion_activa = suscripcionActiva(a.status);
    usuario.atleta_periodo_fin = a.current_period_end;
    usuario.atleta_cancel_at_period_end = !!a.cancel_at_period_end;
  } else {
    usuario.atleta_suscripcion_status = null;
    usuario.atleta_suscripcion_activa = !!usuario.paquete_grandfathered;
    usuario.atleta_periodo_fin = null;
    usuario.atleta_cancel_at_period_end = false;
  }

  const stripe = getStripe();
  if (stripe) {
    const stripeSubRow = await db.execute({
      sql: `SELECT stripe_subscription_id FROM suscripciones_coach
            WHERE usuario_id = ? AND stripe_subscription_id IS NOT NULL`,
      args: [usuario.id]
    });
    const stripeSubId = stripeSubRow.rows[0]?.stripe_subscription_id;
    if (stripeSubId) {
      try {
        await syncSuscripcionCoachPorStripeId(db, stripe, stripeSubId);
      } catch (err) {
        console.warn("Sync coach Stripe al login:", err.message);
      }
    }
  }

  const subRes = await db.execute({
    sql: `SELECT plan, status, limite_clientes, current_period_end, cancel_at_period_end, trial_end,
          stripe_customer_id, stripe_subscription_id, trial_usado
          FROM suscripciones_coach WHERE usuario_id = ?`,
    args: [usuario.id]
  });

  if (subRes.rows.length > 0) {
    let s = subRes.rows[0];
    if (s.status === "trialing" && trialExpirado(s.trial_end)) {
      await db.execute({
        sql: `UPDATE suscripciones_coach SET status = 'canceled' WHERE usuario_id = ?`,
        args: [usuario.id]
      });
      s = { ...s, status: "canceled" };
    }

    const activa = suscripcionActiva(s.status);
    if (!activa) {
      usuario.coach_plan = null;
      usuario.coach_suscripcion_status = s.status;
      usuario.coach_suscripcion_activa = false;
      usuario.coach_limite_clientes = null;
      usuario.coach_periodo_fin = null;
      usuario.coach_cancel_at_period_end = false;
      usuario.coach_en_trial = false;
      usuario.coach_trial_end = null;
      usuario.coach_necesita_suscripcion = usuario.rol === "COACH";
      usuario.coach_stripe_vinculado = !!(s.stripe_subscription_id && s.stripe_customer_id);
      usuario.coach_trial_usado = !!s.trial_usado;
    } else {
      const planEfectivo = s.status === "trialing" ? "starter" : normalizarPlanCoach(s.plan);
      const limiteCalc = limiteAlumnosCoach(planEfectivo, s.status);
      const limiteDb = Number(s.limite_clientes);
      const limiteEfectivo =
        Number.isFinite(limiteDb) && limiteDb > 0 ? limiteDb : limiteCalc;

      usuario.coach_plan = planEfectivo;
      usuario.coach_suscripcion_status = s.status;
      usuario.coach_suscripcion_activa = true;
      usuario.coach_limite_clientes = limiteEfectivo;
      usuario.coach_periodo_fin = s.current_period_end || s.trial_end;
      usuario.coach_cancel_at_period_end = !!s.cancel_at_period_end;
      usuario.coach_en_trial = s.status === "trialing";
      usuario.coach_trial_end = s.trial_end;
      usuario.coach_necesita_suscripcion = false;
      usuario.coach_stripe_vinculado = !!(s.stripe_subscription_id && s.stripe_customer_id);
      usuario.coach_trial_usado = !!s.trial_usado;
    }
  } else {
    usuario.coach_plan = null;
    usuario.coach_suscripcion_status = null;
    usuario.coach_suscripcion_activa = usuario.rol === "SUPERADMIN";
    usuario.coach_limite_clientes = null;
    usuario.coach_periodo_fin = null;
    usuario.coach_cancel_at_period_end = false;
    usuario.coach_en_trial = false;
    usuario.coach_trial_end = null;
    usuario.coach_necesita_suscripcion = usuario.rol === "COACH";
    usuario.coach_stripe_vinculado = false;
    usuario.coach_trial_usado = false;
  }

  if (usuario.rol === "SUPERADMIN") {
    usuario.coach_suscripcion_activa = true;
    usuario.coach_necesita_suscripcion = false;
    usuario.coach_stripe_vinculado = false;
    usuario.coach_en_trial = false;
    usuario.coach_trial_usado = false;
  }

  const concesion = await obtenerConcesionActiva(db, usuario.id);
  const ent = mapConcesionEntitlements(concesion);

  if (ent?.tipo === "atleta") {
    usuario.paquete_rutina_6_dias = true;
    usuario.atleta_suscripcion_activa = true;
    usuario.suscripcion_origen = "admin";
    usuario.concesion_admin_id = ent.concesion_id || null;
    usuario.concesion_admin_fin = ent.fin || null;
    usuario.concesion_admin_tipo = "atleta";
    usuario.concesion_admin_plan = ent.plan;
  } else if (ent?.tipo === "coach") {
    usuario.coach_plan = ent.plan;
    usuario.coach_suscripcion_status = "active";
    usuario.coach_suscripcion_activa = true;
    usuario.coach_limite_clientes = ent.limite_efectivo;
    usuario.coach_periodo_fin = ent.fin || null;
    usuario.coach_cancel_at_period_end = false;
    usuario.coach_en_trial = false;
    usuario.coach_necesita_suscripcion = false;
    usuario.suscripcion_origen = "admin";
    usuario.concesion_admin_id = ent.concesion_id || null;
    usuario.concesion_admin_fin = ent.fin || null;
    usuario.concesion_admin_tipo = "coach";
    usuario.concesion_admin_plan = ent.plan;
  } else if (
    ["active", "trialing"].includes(usuario.coach_suscripcion_status) ||
    ["active", "trialing"].includes(usuario.atleta_suscripcion_status)
  ) {
    usuario.suscripcion_origen = "stripe";
    usuario.concesion_admin_fin = null;
  } else if (usuario.paquete_grandfathered || usuario.paquete_rutina_6_dias) {
    usuario.suscripcion_origen = "grandfathered";
    usuario.concesion_admin_fin = null;
  } else {
    usuario.suscripcion_origen = null;
    usuario.concesion_admin_fin = null;
  }

  return usuario;
}

module.exports = {
  crearCheckoutAtleta,
  crearCheckoutCoach,
  crearPortalCoach,
  iniciarTrialCoach,
  resetCoachStripeLive,
  handleStripeWebhook,
  enrichUsuarioConSuscripcion,
  evaluarSuscripcionCoach,
  migrarPaquetesGrandfathered,
  syncPaqueteDesdeSuscripcion
};