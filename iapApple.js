/**
 * App Store IAP — verificación StoreKit 2 (JWS) + App Store Server Notifications V2.
 * Entitlements: mismas tablas que Stripe (suscripciones_atleta / suscripciones_coach).
 */

const fs = require("fs");
const path = require("path");
const { clasificarProductId } = require("./iapProductos");
const { suscripcionActiva, limiteAlumnosCoach, normalizarPlanCoach } = require("./planesSuscripcion");

const BUNDLE_ID = (process.env.APPLE_BUNDLE_ID || "com.metodog.app").trim();
const APP_APPLE_ID = parseInt(process.env.APPLE_APP_ID || process.env.APPLE_IAP_APP_ID || "", 10) || undefined;

function iapConfigurado() {
  const issuer = (process.env.APPLE_IAP_ISSUER_ID || "").trim();
  const keyId = (process.env.APPLE_IAP_KEY_ID || "").trim();
  const privateKey = (process.env.APPLE_IAP_PRIVATE_KEY || "").trim();
  return !!(issuer && keyId && privateKey && BUNDLE_ID);
}

function normalizarPrivateKey(raw) {
  let key = String(raw || "").trim();
  if (!key) return "";
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  if (!key.includes("BEGIN") && fs.existsSync(key)) {
    key = fs.readFileSync(key, "utf8");
  }
  return key.trim();
}

function environmentPreferido() {
  const raw = (process.env.APPLE_IAP_ENV || "Production").trim().toLowerCase();
  if (raw === "sandbox") return "Sandbox";
  return "Production";
}

/** Apple Root CA - G3 (DER), público — para SignedDataVerifier. */
function cargarAppleRootCerts() {
  const local = path.join(__dirname, "certs", "AppleRootCA-G3.cer");
  if (fs.existsSync(local)) {
    return [fs.readFileSync(local)];
  }
  // Fallback: sin archivo local, online checks del verifier + API getTransactionInfo.
  return [];
}

let _apiClientCache = null;
let _verifierCache = {};

function getAppleLib() {
  return require("@apple/app-store-server-library");
}

function getApiClient() {
  if (_apiClientCache) return _apiClientCache;
  if (!iapConfigurado()) return null;
  const { AppStoreServerAPIClient, Environment } = getAppleLib();
  const envName = environmentPreferido();
  const environment = envName === "Sandbox" ? Environment.SANDBOX : Environment.PRODUCTION;
  _apiClientCache = new AppStoreServerAPIClient(
    normalizarPrivateKey(process.env.APPLE_IAP_PRIVATE_KEY),
    (process.env.APPLE_IAP_KEY_ID || "").trim(),
    (process.env.APPLE_IAP_ISSUER_ID || "").trim(),
    BUNDLE_ID,
    environment
  );
  return _apiClientCache;
}

function getVerifier(envName) {
  if (_verifierCache[envName]) return _verifierCache[envName];
  const { SignedDataVerifier, Environment } = getAppleLib();
  const environment = envName === "Sandbox" ? Environment.SANDBOX : Environment.PRODUCTION;
  const roots = cargarAppleRootCerts();
  if (!roots.length) {
    console.warn("iapApple: falta certs/AppleRootCA-G3.cer — verificación JWS local limitada; se usará API.");
  }
  const verifier = new SignedDataVerifier(
    roots,
    true,
    environment,
    BUNDLE_ID,
    APP_APPLE_ID
  );
  _verifierCache[envName] = verifier;
  return verifier;
}

function msToIso(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return null;
  return new Date(Number(ms)).toISOString();
}

function statusDesdeTransaccion(tx) {
  const exp = tx.expiresDate != null ? Number(tx.expiresDate) : null;
  const revocado = tx.revocationDate != null;
  if (revocado) return "canceled";
  if (exp != null && exp < Date.now()) return "expired";
  if (tx.offerType === 1 || tx.offerDiscountType === "FREE_TRIAL") {
    // Introductory free trial sigue contando como trialing si aún no vence
    if (exp != null && exp > Date.now()) return "trialing";
  }
  return "active";
}

/**
 * Decodifica JWS de transacción (cliente o ASN). Prueba Production y Sandbox.
 */
async function decodificarTransaccionJws(jws) {
  if (!jws || typeof jws !== "string") {
    throw Object.assign(new Error("jwsRepresentation requerido"), { status: 400 });
  }
  const orden =
    environmentPreferido() === "Sandbox"
      ? ["Sandbox", "Production"]
      : ["Production", "Sandbox"];

  let lastErr = null;
  for (const env of orden) {
    try {
      const verifier = getVerifier(env);
      const decoded = await verifier.verifyAndDecodeTransaction(jws);
      return { ...decoded, _iapEnv: env };
    } catch (err) {
      lastErr = err;
    }
  }
  throw Object.assign(
    new Error(lastErr?.message || "No se pudo verificar la transacción Apple"),
    { status: 400, cause: lastErr }
  );
}

async function obtenerTransaccionPorId(transactionId) {
  if (!transactionId) return null;
  const client = getApiClient();
  if (!client) return null;
  try {
    const res = await client.getTransactionInfo(String(transactionId));
    if (!res?.signedTransactionInfo) return null;
    return decodificarTransaccionJws(res.signedTransactionInfo);
  } catch (err) {
    // Reintentar en el otro entorno
    try {
      const { AppStoreServerAPIClient, Environment } = getAppleLib();
      const other =
        environmentPreferido() === "Sandbox" ? Environment.PRODUCTION : Environment.SANDBOX;
      const alt = new AppStoreServerAPIClient(
        normalizarPrivateKey(process.env.APPLE_IAP_PRIVATE_KEY),
        (process.env.APPLE_IAP_KEY_ID || "").trim(),
        (process.env.APPLE_IAP_ISSUER_ID || "").trim(),
        BUNDLE_ID,
        other
      );
      const res = await alt.getTransactionInfo(String(transactionId));
      if (!res?.signedTransactionInfo) return null;
      return decodificarTransaccionJws(res.signedTransactionInfo);
    } catch (err2) {
      console.warn("iapApple getTransactionInfo:", err.message, err2.message);
      return null;
    }
  }
}

async function leerSuscripcion(db, tabla, usuarioId) {
  const r = await db.execute({
    sql: `SELECT * FROM ${tabla} WHERE usuario_id = ?`,
    args: [usuarioId]
  });
  return r.rows[0] || null;
}

/**
 * No degradar Stripe activo con un evento Apple expirado/cancelado.
 */
function debeAplicarCambio(existente, nuevoStatus) {
  if (!existente) return true;
  const prevActiva = suscripcionActiva(existente.status);
  const nuevaActiva = suscripcionActiva(nuevoStatus);
  if (prevActiva && !nuevaActiva && existente.store === "stripe" && existente.stripe_subscription_id) {
    return false;
  }
  return true;
}

async function upsertAtletaApple(db, {
  usuarioId,
  status,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  appleOriginalTransactionId,
  appleProductId
}) {
  const existente = await leerSuscripcion(db, "suscripciones_atleta", usuarioId);
  if (!debeAplicarCambio(existente, status)) {
    return { aplicado: false, motivo: "stripe_activo_protegido" };
  }

  await db.execute({
    sql: `INSERT INTO suscripciones_atleta (
            usuario_id, stripe_customer_id, stripe_subscription_id, status,
            current_period_end, cancel_at_period_end, store,
            apple_original_transaction_id, apple_product_id, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'apple', ?, ?, datetime('now'))
          ON CONFLICT(usuario_id) DO UPDATE SET
            status = excluded.status,
            current_period_end = excluded.current_period_end,
            cancel_at_period_end = excluded.cancel_at_period_end,
            store = 'apple',
            apple_original_transaction_id = COALESCE(excluded.apple_original_transaction_id, suscripciones_atleta.apple_original_transaction_id),
            apple_product_id = COALESCE(excluded.apple_product_id, suscripciones_atleta.apple_product_id),
            updated_at = datetime('now')`,
    args: [
      usuarioId,
      existente?.stripe_customer_id || null,
      existente?.stripe_subscription_id || null,
      status,
      currentPeriodEnd || null,
      cancelAtPeriodEnd ? 1 : 0,
      appleOriginalTransactionId || null,
      appleProductId || null
    ]
  });
  return { aplicado: true };
}

async function upsertCoachApple(db, {
  usuarioId,
  plan,
  status,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  trialEnd,
  trialUsado,
  appleOriginalTransactionId,
  appleProductId
}) {
  const existente = await leerSuscripcion(db, "suscripciones_coach", usuarioId);
  if (!debeAplicarCambio(existente, status)) {
    return { aplicado: false, motivo: "stripe_activo_protegido" };
  }

  const planNorm = normalizarPlanCoach(plan || existente?.plan || "starter");
  const limite = limiteAlumnosCoach(planNorm, status);
  const marcarTrial = trialUsado ? 1 : status === "trialing" ? 1 : 0;

  await db.execute({
    sql: `INSERT INTO suscripciones_coach (
            usuario_id, plan, stripe_customer_id, stripe_subscription_id, status,
            limite_clientes, current_period_end, cancel_at_period_end, trial_end, trial_usado,
            store, apple_original_transaction_id, apple_product_id, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'apple', ?, ?, datetime('now'))
          ON CONFLICT(usuario_id) DO UPDATE SET
            plan = excluded.plan,
            status = excluded.status,
            limite_clientes = excluded.limite_clientes,
            current_period_end = excluded.current_period_end,
            cancel_at_period_end = excluded.cancel_at_period_end,
            trial_end = COALESCE(excluded.trial_end, suscripciones_coach.trial_end),
            trial_usado = MAX(COALESCE(suscripciones_coach.trial_usado, 0), COALESCE(excluded.trial_usado, 0)),
            store = 'apple',
            apple_original_transaction_id = COALESCE(excluded.apple_original_transaction_id, suscripciones_coach.apple_original_transaction_id),
            apple_product_id = COALESCE(excluded.apple_product_id, suscripciones_coach.apple_product_id),
            updated_at = datetime('now')`,
    args: [
      usuarioId,
      planNorm,
      existente?.stripe_customer_id || null,
      existente?.stripe_subscription_id || null,
      status,
      limite,
      currentPeriodEnd || null,
      cancelAtPeriodEnd ? 1 : 0,
      trialEnd || null,
      marcarTrial,
      appleOriginalTransactionId || null,
      appleProductId || null
    ]
  });
  return { aplicado: true };
}

async function aplicarTransaccionApple(db, usuarioId, tx) {
  const productId = tx.productId || tx.productID;
  const meta = clasificarProductId(productId);
  if (!meta) {
    throw Object.assign(new Error(`Producto Apple no reconocido: ${productId}`), { status: 400 });
  }
  if (tx.bundleId && tx.bundleId !== BUNDLE_ID) {
    throw Object.assign(new Error("bundleId no coincide"), { status: 400 });
  }

  const status = statusDesdeTransaccion(tx);
  const currentPeriodEnd = msToIso(tx.expiresDate);
  const originalId = String(tx.originalTransactionId || tx.transactionId || "");
  const cancelAtPeriodEnd = false;
  const { syncPaqueteDesdeSuscripcion } = require("./pagos");

  if (meta.tipo === "atleta") {
    const r = await upsertAtletaApple(db, {
      usuarioId,
      status,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      appleOriginalTransactionId: originalId,
      appleProductId: meta.productId
    });
    if (r.aplicado) await syncPaqueteDesdeSuscripcion(db, usuarioId);
    return { tipo: "atleta", status, aplicado: r.aplicado, motivo: r.motivo || null };
  }

  // Coach
  const { ascenderUsuarioACoach } = require("./pagos");
  const ok = await ascenderUsuarioACoach(db, usuarioId);
  if (!ok) {
    throw Object.assign(
      new Error("No se pudo activar rol coach (¿cuenta con coach vinculado?)"),
      { status: 400 }
    );
  }
  const trialEnd = status === "trialing" ? currentPeriodEnd : null;
  const r = await upsertCoachApple(db, {
    usuarioId,
    plan: meta.plan,
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    trialEnd,
    trialUsado: status === "trialing" || status === "active",
    appleOriginalTransactionId: originalId,
    appleProductId: meta.productId
  });
  return { tipo: "coach", plan: meta.plan, status, aplicado: r.aplicado, motivo: r.motivo || null };
}

async function buscarUsuarioPorOriginalTransactionId(db, originalId) {
  if (!originalId) return null;
  for (const tabla of ["suscripciones_atleta", "suscripciones_coach"]) {
    const r = await db.execute({
      sql: `SELECT usuario_id FROM ${tabla} WHERE apple_original_transaction_id = ?`,
      args: [String(originalId)]
    });
    if (r.rows[0]?.usuario_id) return Number(r.rows[0].usuario_id);
  }
  return null;
}

/**
 * POST /api/pagos/iap/verificar — usuario autenticado envía jws y/o transactionId.
 */
async function verificarCompraIap(req, res, db) {
  try {
    if (!iapConfigurado() && cargarAppleRootCerts().length === 0) {
      // Sin key ni certs no podemos verificar de forma segura
      console.warn("iapApple: APPLE_IAP_* no configurado");
    }

    const usuarioId = Number(req.user?.id);
    if (!usuarioId) return res.status(401).json({ error: "No autenticado" });

    const jws = (req.body?.jwsRepresentation || req.body?.jws || "").trim();
    const transactionId = (req.body?.transactionId || "").trim();

    let tx = null;
    if (jws) {
      tx = await decodificarTransaccionJws(jws);
    } else if (transactionId) {
      tx = await obtenerTransaccionPorId(transactionId);
      if (!tx) {
        return res.status(400).json({ error: "No se pudo validar transactionId con Apple" });
      }
    } else {
      return res.status(400).json({ error: "Envía jwsRepresentation o transactionId" });
    }

    const resultado = await aplicarTransaccionApple(db, usuarioId, tx);
    return res.json({
      ok: true,
      ...resultado,
      productId: tx.productId || tx.productID,
      expiresDate: msToIso(tx.expiresDate),
      originalTransactionId: String(tx.originalTransactionId || "")
    });
  } catch (err) {
    console.error("verificarCompraIap:", err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || "Error al verificar IAP" });
  }
}

/**
 * POST /api/pagos/iap/asn — App Store Server Notifications V2 (público).
 */
async function handleAppleServerNotification(req, res, db) {
  try {
    const signedPayload = req.body?.signedPayload;
    if (!signedPayload) {
      return res.status(400).json({ error: "signedPayload requerido" });
    }

    const orden =
      environmentPreferido() === "Sandbox"
        ? ["Sandbox", "Production"]
        : ["Production", "Sandbox"];

    let notification = null;
    let lastErr = null;
    for (const env of orden) {
      try {
        const verifier = getVerifier(env);
        notification = await verifier.verifyAndDecodeNotification(signedPayload);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!notification) {
      console.error("ASN verify failed:", lastErr?.message);
      return res.status(400).json({ error: "Notificación Apple inválida" });
    }

    const data = notification.data || {};
    let tx = null;
    if (data.signedTransactionInfo) {
      tx = await decodificarTransaccionJws(data.signedTransactionInfo);
    }

    if (!tx) {
      // ACK para tipos sin transacción (ej. TEST)
      console.log("ASN sin transacción:", notification.notificationType, notification.subtype);
      return res.status(200).json({ ok: true, ignored: true });
    }

    const originalId = String(tx.originalTransactionId || tx.transactionId || "");
    let usuarioId = await buscarUsuarioPorOriginalTransactionId(db, originalId);

    // appAccountToken: UUID que el cliente puede setear = mapeo opcional en usuarios
    if (!usuarioId && tx.appAccountToken) {
      const map = await db.execute({
        sql: "SELECT id FROM usuarios WHERE apple_app_account_token = ?",
        args: [String(tx.appAccountToken)]
      });
      if (map.rows[0]?.id) usuarioId = Number(map.rows[0].id);
    }

    if (!usuarioId) {
      console.warn("ASN sin usuario para originalTransactionId:", originalId);
      return res.status(200).json({ ok: true, unmatched: true });
    }

    const resultado = await aplicarTransaccionApple(db, usuarioId, tx);
    console.log(
      "ASN OK",
      notification.notificationType,
      notification.subtype,
      "user",
      usuarioId,
      resultado
    );
    return res.status(200).json({ ok: true, usuarioId, ...resultado });
  } catch (err) {
    console.error("handleAppleServerNotification:", err.message);
    return res.status(500).json({ error: err.message || "Error ASN" });
  }
}

module.exports = {
  iapConfigurado,
  verificarCompraIap,
  handleAppleServerNotification,
  aplicarTransaccionApple,
  decodificarTransaccionJws,
  BUNDLE_ID
};
