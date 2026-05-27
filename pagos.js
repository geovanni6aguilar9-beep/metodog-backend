const Stripe = require("stripe");

const MONTO_PAQUETE_MXN_DEFAULT = 149;
const MONTO_COACH_MXN_DEFAULT = 499;
const PRODUCTO_PAQUETE = "MétodoG — Rutina Full Week (6 días)";
const PRODUCTO_COACH = "MétodoG PRO — Plan Coach";

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

function coachLimiteClientes() {
  const n = parseInt(process.env.STRIPE_COACH_LIMITE_CLIENTES || "25", 10);
  return Number.isNaN(n) ? 25 : n;
}

function coachPlanId() {
  return (process.env.STRIPE_COACH_PLAN || "pro").trim() || "pro";
}

const generarCodigo = () => Math.random().toString(36).substring(2, 8).toUpperCase();

async function activarPaqueteUsuario(db, usuarioId) {
  const result = await db.execute({
    sql: "UPDATE usuarios SET paquete_rutina_6_dias = 1 WHERE id = ?",
    args: [usuarioId]
  });
  return (result.rowsAffected ?? 0) > 0;
}

async function upsertSuscripcionCoach(db, {
  usuarioId,
  plan,
  stripeCustomerId,
  stripeSubscriptionId,
  status,
  limiteClientes,
  currentPeriodEnd,
  cancelAtPeriodEnd
}) {
  await db.execute({
    sql: `INSERT INTO suscripciones_coach (
            usuario_id, plan, stripe_customer_id, stripe_subscription_id, status,
            limite_clientes, current_period_end, cancel_at_period_end, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(usuario_id) DO UPDATE SET
            plan = excluded.plan,
            stripe_customer_id = excluded.stripe_customer_id,
            stripe_subscription_id = excluded.stripe_subscription_id,
            status = excluded.status,
            limite_clientes = excluded.limite_clientes,
            current_period_end = excluded.current_period_end,
            cancel_at_period_end = excluded.cancel_at_period_end,
            updated_at = datetime('now')`,
    args: [
      usuarioId,
      plan,
      stripeCustomerId || null,
      stripeSubscriptionId || null,
      status,
      limiteClientes,
      currentPeriodEnd || null,
      cancelAtPeriodEnd ? 1 : 0
    ]
  });
}

function suscripcionCoachActiva(status) {
  return status === "active" || status === "trialing";
}

async function ascenderUsuarioACoach(db, usuarioId) {
  const userRes = await db.execute({
    sql: "SELECT id, rol, codigo_invitacion FROM usuarios WHERE id = ?",
    args: [usuarioId]
  });
  if (userRes.rows.length === 0) return false;

  const user = userRes.rows[0];
  if (user.rol === "SUPERADMIN") return true;

  const codigo = user.codigo_invitacion || generarCodigo();
  const result = await db.execute({
    sql: "UPDATE usuarios SET rol = 'COACH', codigo_invitacion = ? WHERE id = ?",
    args: [codigo, usuarioId]
  });
  return (result.rowsAffected ?? 0) > 0;
}

async function activarCoachDesdeStripe(db, stripe, usuarioId, subscriptionId, customerId) {
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

  const ok = await ascenderUsuarioACoach(db, usuarioId);
  if (!ok) return false;

  await upsertSuscripcionCoach(db, {
    usuarioId,
    plan: coachPlanId(),
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status,
    limiteClientes: coachLimiteClientes(),
    currentPeriodEnd,
    cancelAtPeriodEnd
  });

  return true;
}

async function syncSuscripcionPorStripeId(db, stripe, stripeSubscriptionId) {
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const usuarioId =
    sub.metadata?.usuario_id ||
    (await db.execute({
      sql: "SELECT usuario_id FROM suscripciones_coach WHERE stripe_subscription_id = ?",
      args: [stripeSubscriptionId]
    })).rows[0]?.usuario_id;

  if (!usuarioId) {
    console.error("Suscripción sin usuario_id:", stripeSubscriptionId);
    return false;
  }

  const uid = parseInt(usuarioId, 10);
  const status = sub.status || "canceled";
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;
  const cancelAtPeriodEnd = !!sub.cancel_at_period_end;

  await upsertSuscripcionCoach(db, {
    usuarioId: uid,
    plan: sub.metadata?.plan || coachPlanId(),
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripeSubscriptionId: sub.id,
    status,
    limiteClientes: coachLimiteClientes(),
    currentPeriodEnd,
    cancelAtPeriodEnd
  });

  if (suscripcionCoachActiva(status)) {
    await ascenderUsuarioACoach(db, uid);
    await db.execute({
      sql: `UPDATE perfiles_coach_publicos SET visible_en_directorio = 1 WHERE usuario_id = ?`,
      args: [uid]
    });
  } else {
    await db.execute({
      sql: `UPDATE perfiles_coach_publicos SET visible_en_directorio = 0 WHERE usuario_id = ?`,
      args: [uid]
    });
  }

  return true;
}

async function crearCheckoutAtleta(req, res, db) {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: "Pagos no configurados (falta STRIPE_SECRET_KEY)" });
  }

  const userId = parseInt(req.user.id, 10);
  const userRes = await db.execute({
    sql: "SELECT id, email, nombre, coach_id, paquete_rutina_6_dias, rol FROM usuarios WHERE id = ?",
    args: [userId]
  });
  if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

  const user = userRes.rows[0];
  if (user.coach_id) {
    return res.status(400).json({
      error: "Este paquete es para atletas en modo libre. Si tienes coach, usa la rutina que te asigna."
    });
  }
  if (user.paquete_rutina_6_dias) {
    return res.status(400).json({ error: "Ya tienes el paquete Rutina Full Week activo." });
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
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      client_reference_id: String(userId),
      metadata: {
        usuario_id: String(userId),
        producto: "paquete_rutina_6_dias"
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "mxn",
            unit_amount: montoCentavos("STRIPE_PAQUETE_MONTO_MXN", MONTO_PAQUETE_MXN_DEFAULT),
            product_data: {
              name: PRODUCTO_PAQUETE,
              description: "Diseño de rutina Lun–Sáb. Pago único. Entrenar sigue siendo gratis."
            }
          }
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    res.json({ url: session.url, session_id: session.id });
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
    sql: `SELECT u.id, u.email, u.nombre, u.rol, s.status AS sub_status
          FROM usuarios u
          LEFT JOIN suscripciones_coach s ON s.usuario_id = u.id
          WHERE u.id = ?`,
    args: [userId]
  });
  if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

  const user = userRes.rows[0];
  if (user.rol === "SUPERADMIN") {
    return res.status(400).json({ error: "Tu cuenta ya tiene acceso total de administrador." });
  }
  if (user.sub_status === "active" || user.sub_status === "trialing") {
    return res.status(400).json({ error: "Ya tienes una suscripción Coach activa." });
  }

  const { success_url, cancel_url } = req.body || {};
  const base = getFrontendOrigins()[0];
  const successUrl = success_url || `${base}/?coach_success=true`;
  const cancelUrl = cancel_url || `${base}/?coach_canceled=true`;

  if (!isAllowedReturnUrl(successUrl) || !isAllowedReturnUrl(cancelUrl)) {
    return res.status(400).json({ error: "URL de retorno no permitida" });
  }

  const plan = coachPlanId();
  const montoMxn = parseInt(process.env.STRIPE_COACH_PRECIO_MXN || String(MONTO_COACH_MXN_DEFAULT), 10);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      client_reference_id: String(userId),
      metadata: {
        usuario_id: String(userId),
        producto: "coach_suscripcion",
        plan
      },
      subscription_data: {
        metadata: {
          usuario_id: String(userId),
          producto: "coach_suscripcion",
          plan
        }
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "mxn",
            unit_amount: montoCentavos("STRIPE_COACH_PRECIO_MXN", MONTO_COACH_MXN_DEFAULT),
            recurring: { interval: "month" },
            product_data: {
              name: PRODUCTO_COACH,
              description: `Suscripción mensual · hasta ${coachLimiteClientes()} clientes · directorio PRO`
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
      precio_mxn: montoMxn
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

      if (producto === "coach_suscripcion" || session.mode === "subscription") {
        const ok = await activarCoachDesdeStripe(
          db,
          stripe,
          uid,
          session.subscription,
          session.customer
        );
        if (!ok) {
          console.error("Webhook: coach no activado", usuarioId);
          return res.status(500).send("Usuario no encontrado");
        }
        console.log(`✅ Suscripción Coach activada para usuario ${usuarioId}`);
      } else if (producto === "paquete_rutina_6_dias") {
        const ok = await activarPaqueteUsuario(db, uid);
        if (!ok) {
          console.error("Webhook: paquete no actualizado", usuarioId);
          return res.status(500).send("Usuario no encontrado");
        }
        console.log(`✅ Paquete 6 días activado para usuario ${usuarioId}`);
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      await syncSuscripcionPorStripeId(db, stripe, subscription.id);
      console.log(`🔄 Suscripción Coach sincronizada: ${subscription.id} (${subscription.status})`);
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      if (invoice.subscription) {
        await syncSuscripcionPorStripeId(db, stripe, invoice.subscription);
        console.log(`⚠️ Pago fallido suscripción ${invoice.subscription}`);
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
    sql: `SELECT stripe_customer_id, stripe_subscription_id, status FROM suscripciones_coach WHERE usuario_id = ?`,
    args: [userId]
  });

  // Si el usuario es COACH por activación manual (sin suscripción), no hay "portal" que administrar.
  if (subRes.rows.length === 0) {
    return res.status(400).json({
      error: "Tu cuenta Coach no tiene una suscripción activa vinculada en Stripe. Suscríbete primero."
    });
  }

  let customerId = subRes.rows[0]?.stripe_customer_id;

  if (!customerId) {
    const userRes = await db.execute({
      sql: "SELECT email FROM usuarios WHERE id = ?",
      args: [userId]
    });
    const email = userRes.rows[0]?.email;
    if (email) {
      const list = await stripe.customers.list({ email, limit: 1 });
      customerId = list.data[0]?.id;
      if (customerId && subRes.rows.length > 0) {
        await db.execute({
          sql: "UPDATE suscripciones_coach SET stripe_customer_id = ? WHERE usuario_id = ?",
          args: [customerId, userId]
        });
      }
    }
  }

  if (!customerId) {
    return res.status(400).json({
      error: "No hay cliente de Stripe vinculado. Suscríbete primero o contacta soporte."
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
    res.status(500).json({
      error:
        err.message ||
        "No se pudo abrir el portal. Activa Customer Portal en Stripe Dashboard."
    });
  }
}

async function enrichUsuarioConSuscripcion(db, usuario) {
  if (!usuario) return usuario;
  const subRes = await db.execute({
    sql: `SELECT plan, status, limite_clientes, current_period_end, cancel_at_period_end, stripe_subscription_id
          FROM suscripciones_coach WHERE usuario_id = ?`,
    args: [usuario.id]
  });

  if (subRes.rows.length > 0) {
    const s = subRes.rows[0];
    usuario.coach_plan = s.plan;
    usuario.coach_suscripcion_status = s.status;
    usuario.coach_suscripcion_activa = suscripcionCoachActiva(s.status);
    usuario.coach_limite_clientes = s.limite_clientes;
    usuario.coach_periodo_fin = s.current_period_end;
    usuario.coach_cancel_at_period_end = !!s.cancel_at_period_end;
  } else {
    usuario.coach_plan = null;
    usuario.coach_suscripcion_status = null;
    // COACH sin fila en suscripciones_coach => rol activado manualmente, pero sin facturación vinculada.
    usuario.coach_suscripcion_activa = usuario.rol === "SUPERADMIN";
    usuario.coach_limite_clientes = null;
    usuario.coach_periodo_fin = null;
    usuario.coach_cancel_at_period_end = false;
    usuario.coach_necesita_suscripcion = usuario.rol === "COACH";
  }

  return usuario;
}

module.exports = {
  crearCheckoutAtleta,
  crearCheckoutCoach,
  crearPortalCoach,
  handleStripeWebhook,
  enrichUsuarioConSuscripcion
};
