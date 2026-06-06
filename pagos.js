const Stripe = require("stripe");
const {
  TRIAL_DIAS,
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

const MONTO_PAQUETE_MXN_DEFAULT = 149;
const PRODUCTO_PAQUETE_LEGACY_NOMBRE = "MétodoG — Rutina Full Week (6 días)";
const PRODUCTO_ATLETA_NOMBRE = "MétodoG — Full Week PRO";
const PRODUCTO_COACH_NOMBRE = "MétodoG Coach PRO";

function getStripe() {
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return null;
  return new Stripe(key);
}

function getFrontendOrigins() {
  const raw = (process.env.FRONTEND_URL || "http://localhost:5173").trim();
  return raw.split(",").map(s => s.trim()).filter(Boolean);
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
  trialEnd
}) {
  const planNorm = normalizarPlanCoach(plan);
  const limite = limiteClientes ?? limiteAlumnosCoach(planNorm, status);
  await db.execute({
    sql: `INSERT INTO suscripciones_coach (
            usuario_id, plan, stripe_customer_id, stripe_subscription_id, status,
            limite_clientes, current_period_end, cancel_at_period_end, trial_end, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(usuario_id) DO UPDATE SET
            plan = excluded.plan,
            stripe_customer_id = excluded.stripe_customer_id,
            stripe_subscription_id = excluded.stripe_subscription_id,
            status = excluded.status,
            limite_clientes = excluded.limite_clientes,
            current_period_end = excluded.current_period_end,
            cancel_at_period_end = excluded.cancel_at_period_end,
            trial_end = excluded.trial_end,
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
      trialEnd || null
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

  if (subscriptionId) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    status = sub.status || "active";
    cancelAtPeriodEnd = !!sub.cancel_at_period_end;
    plan = normalizarPlanCoach(sub.metadata?.plan || plan);
    if (sub.current_period_end) {
      currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
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
    trialEnd: null
  });

  return true;
}

async function syncSuscripcionCoachPorStripeId(db, stripe, stripeSubscriptionId) {
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
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
  const plan = normalizarPlanCoach(sub.metadata?.plan);
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;
  const cancelAtPeriodEnd = !!sub.cancel_at_period_end;

  await upsertSuscripcionCoach(db, {
    usuarioId: uid,
    plan,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripeSubscriptionId: sub.id,
    status,
    limiteClientes: limiteAlumnosCoach(plan, status),
    currentPeriodEnd,
    cancelAtPeriodEnd,
    trialEnd: null
  });

  if (suscripcionActiva(status)) {
    await ascenderUsuarioACoach(db, uid);
  }

  return true;
}

async function iniciarTrialCoach(req, res, db) {
  const userId = parseInt(req.user.id, 10);

  const userRes = await db.execute({
    sql: "SELECT id, rol, coach_id FROM usuarios WHERE id = ?",
    args: [userId]
  });
  if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

  const user = userRes.rows[0];
  if (user.coach_id != null && user.coach_id !== "") {
    return res.status(400).json({
      error: "Tienes un coach asignado. Desvincúlate antes de probar como coach."
    });
  }
  if (user.rol === "SUPERADMIN") {
    return res.status(400).json({ error: "Tu cuenta ya tiene acceso total." });
  }

  const subRes = await db.execute({
    sql: "SELECT status, trial_end FROM suscripciones_coach WHERE usuario_id = ?",
    args: [userId]
  });

  if (subRes.rows.length > 0) {
    const prev = subRes.rows[0];
    if (suscripcionActiva(prev.status) && !(prev.status === "trialing" && trialExpirado(prev.trial_end))) {
      return res.status(400).json({ error: "Ya tienes una suscripción o trial activo." });
    }
    return res.status(400).json({
      error: "Ya usaste tu periodo de prueba. Elige un plan Coach PRO para continuar."
    });
  }

  const ok = await ascenderUsuarioACoach(db, userId);
  if (!ok) {
    return res.status(400).json({ error: "No se pudo activar el trial." });
  }

  const trialEnd = trialEndIsoDesdeAhora();
  await upsertSuscripcionCoach(db, {
    usuarioId: userId,
    plan: "trial",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    status: "trialing",
    limiteClientes: limiteAlumnosCoach("trial", "trialing"),
    currentPeriodEnd: trialEnd,
    cancelAtPeriodEnd: false,
    trialEnd
  });

  res.json({
    ok: true,
    trial_dias: TRIAL_DIAS,
    trial_end: trialEnd,
    limite_alumnos: limiteAlumnosCoach("trial", "trialing"),
    mensaje: `Trial activo ${TRIAL_DIAS} días · hasta 2 alumnos.`
  });
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
      error: "Full Week PRO es para atletas en modo libre. Si tienes coach, usa la rutina que te asigna."
    });
  }

  await syncPaqueteDesdeSuscripcion(db, userId);
  const refreshed = await db.execute({
    sql: "SELECT paquete_rutina_6_dias FROM usuarios WHERE id = ?",
    args: [userId]
  });
  if (refreshed.rows[0]?.paquete_rutina_6_dias) {
    return res.status(400).json({ error: "Ya tienes Full Week PRO activo." });
  }

  const { success_url, cancel_url } = req.body || {};
  const base = getFrontendOrigins()[0];
  const successUrl = success_url || `${base}/?success=true`;
  const cancelUrl = cancel_url || `${base}/?canceled=true`;

  if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
    return res.status(400).json({ error: "URL de retorno no permitida" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
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
      line_items: [
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
      ],
      success_url: successUrl,
      cancel_url: cancelUrl
    });
    res.json({ url: session.url, session_id: session.id, modo: "subscription" });
  } catch (err) {
    console.error("Stripe checkout atleta:", err.message);
    res.status(500).json({ error: err.message || "No se pudo crear la sesión de pago" });
  }
}

async function crearCheckoutCoach(req, res, db) {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: "Pagos no configurados (falta STRIPE_SECRET_KEY)" });
  }

  const userId = parseInt(req.user.id, 10);
  const userRes = await db.execute({
    sql: `SELECT u.id, u.email, u.nombre, u.rol, u.coach_id, s.status AS sub_status, s.trial_end
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
  if (user.sub_status === "active" || (user.sub_status === "trialing" && !trialExpirado(user.trial_end))) {
    return res.status(400).json({ error: "Ya tienes una suscripción Coach activa." });
  }

  const { success_url, cancel_url, plan: planBody } = req.body || {};
  const plan = normalizarPlanCoach(planBody || process.env.STRIPE_COACH_PLAN || "starter");
  const base = getFrontendOrigins()[0];
  const successUrl = success_url || `${base}/?coach_success=true`;
  const cancelUrl = cancel_url || `${base}/?coach_canceled=true`;

  if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
    return res.status(400).json({ error: "URL de retorno no permitida" });
  }

  const limite = limiteAlumnosCoach(plan, "active");
  const montoMxn = precioCoachMxn(plan);

  try {
    const session = await stripe.checkout.sessions.create({
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
      line_items: [
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
      ],
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    res.json({
      url: session.url,
      session_id: session.id,
      plan,
      precio_mxn: montoMxn,
      limite_alumnos: limite
    });
  } catch (err) {
    console.error("Stripe checkout coach:", err.message);
    res.status(500).json({ error: err.message || "No se pudo crear la suscripción" });
  }
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
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const usuarioId = session.metadata?.usuario_id || session.client_reference_id;
      const producto = session.metadata?.producto;

      if (!usuarioId) {
        console.error("Webhook sin usuario_id en sesión", session.id);
        return res.status(400).send("Sin usuario_id");
      }

      const uid = parseInt(usuarioId, 10);

      if (producto === PRODUCTO_ATLETA) {
        await activarAtletaDesdeStripe(db, stripe, uid, session.subscription, session.customer);
        console.log(`✅ Full Week PRO activado usuario ${usuarioId}`);
      } else if (producto === PRODUCTO_COACH) {
        const ok = await activarCoachDesdeStripe(
          db,
          stripe,
          uid,
          session.subscription,
          session.customer,
          session.metadata?.plan
        );
        if (!ok) {
          console.error("Webhook: coach no activado", usuarioId);
          return res.status(500).send("Usuario no encontrado");
        }
        console.log(`✅ Coach PRO (${session.metadata?.plan}) usuario ${usuarioId}`);
      } else if (producto === PRODUCTO_PAQUETE_LEGACY) {
        const ok = await activarPaqueteGrandfathered(db, uid);
        if (!ok) {
          console.error("Webhook: paquete legacy no actualizado", usuarioId);
          return res.status(500).send("Usuario no encontrado");
        }
        console.log(`✅ Paquete legacy grandfathered usuario ${usuarioId}`);
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      const producto = subscription.metadata?.producto;
      if (producto === PRODUCTO_ATLETA) {
        await syncSuscripcionAtletaPorStripeId(db, stripe, subscription.id);
      } else {
        await syncSuscripcionCoachPorStripeId(db, stripe, subscription.id);
      }
      console.log(`🔄 Suscripción ${subscription.id} (${subscription.status})`);
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        if (sub.metadata?.producto === PRODUCTO_ATLETA) {
          await syncSuscripcionAtletaPorStripeId(db, stripe, invoice.subscription);
        } else {
          await syncSuscripcionCoachPorStripeId(db, stripe, invoice.subscription);
        }
      }
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
  const subRes = await db.execute({
    sql: `SELECT stripe_customer_id FROM suscripciones_coach WHERE usuario_id = ?`,
    args: [userId]
  });

  if (subRes.rows.length === 0 || !subRes.rows[0]?.stripe_customer_id) {
    return res.status(400).json({
      error: "No hay suscripción Stripe vinculada. Si estás en trial, elige un plan pagado."
    });
  }

  const customerId = subRes.rows[0].stripe_customer_id;
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

  const subRes = await db.execute({
    sql: `SELECT plan, status, limite_clientes, current_period_end, cancel_at_period_end, trial_end
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

    usuario.coach_plan = s.plan;
    usuario.coach_suscripcion_status = s.status;
    usuario.coach_suscripcion_activa = suscripcionActiva(s.status);
    usuario.coach_limite_clientes = limiteAlumnosCoach(s.plan, s.status);
    usuario.coach_periodo_fin = s.current_period_end || s.trial_end;
    usuario.coach_cancel_at_period_end = !!s.cancel_at_period_end;
    usuario.coach_en_trial = s.status === "trialing";
    usuario.coach_trial_end = s.trial_end;
    usuario.coach_necesita_suscripcion = false;
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
  }

  return usuario;
}

module.exports = {
  crearCheckoutAtleta,
  crearCheckoutCoach,
  crearPortalCoach,
  iniciarTrialCoach,
  handleStripeWebhook,
  enrichUsuarioConSuscripcion,
  evaluarSuscripcionCoach,
  migrarPaquetesGrandfathered,
  syncPaqueteDesdeSuscripcion
};
