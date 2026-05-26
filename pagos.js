const Stripe = require("stripe");

const MONTO_MXN_DEFAULT = 149;
const PRODUCTO_NOMBRE = "MétodoG — Rutina Full Week (6 días)";

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

function montoCentavosMxn() {
  const monto = parseInt(process.env.STRIPE_PAQUETE_MONTO_MXN || String(MONTO_MXN_DEFAULT), 10);
  return Math.max(1000, monto * 100);
}

async function activarPaqueteUsuario(db, usuarioId) {
  const result = await db.execute({
    sql: "UPDATE usuarios SET paquete_rutina_6_dias = 1 WHERE id = ?",
    args: [usuarioId]
  });
  return (result.rowsAffected ?? 0) > 0;
}

async function crearCheckoutAtleta(req, res, db) {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: "Pagos no configurados (falta STRIPE_SECRET_KEY)" });
  }

  const userId = parseInt(req.user.id, 10);
  const userRes = await db.execute({
    sql: "SELECT id, email, nombre, coach_id, paquete_rutina_6_dias FROM usuarios WHERE id = ?",
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
            unit_amount: montoCentavosMxn(),
            product_data: {
              name: PRODUCTO_NOMBRE,
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
    console.error("Stripe checkout:", err.message);
    res.status(500).json({ error: err.message || "No se pudo crear la sesión de pago" });
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
      const usuarioId =
        session.metadata?.usuario_id ||
        session.client_reference_id;

      if (!usuarioId) {
        console.error("Webhook sin usuario_id en sesión", session.id);
        return res.status(400).send("Sin usuario_id");
      }

      const ok = await activarPaqueteUsuario(db, parseInt(usuarioId, 10));
      if (!ok) {
        console.error("Webhook: usuario no actualizado", usuarioId);
        return res.status(500).send("Usuario no encontrado");
      }
      console.log(`✅ Paquete 6 días activado para usuario ${usuarioId}`);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler:", err.message);
    res.status(500).send("Error interno");
  }
}

module.exports = { crearCheckoutAtleta, handleStripeWebhook };
