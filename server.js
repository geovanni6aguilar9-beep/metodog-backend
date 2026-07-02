require("dotenv").config({ quiet: true });
const path = require("path");
const express = require("express");
const cors = require("cors");
const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");
const {
  signToken,
  sanitizeUsuario,
  requireAuthMiddleware,
  assertAccesoUsuario,
  assertAccesoUsuarioEdicion,
  assertCoachOAdmin,
  assertSuperAdmin,
  assertComunidadSelf
} = require("./auth");
const {
  crearCheckoutAtleta,
  crearCheckoutCoach,
  crearPortalCoach,
  iniciarTrialCoach,
  resetCoachStripeLive,
  handleStripeWebhook,
  enrichUsuarioConSuscripcion,
  migrarPaquetesGrandfathered
} = require("./pagos");
const {
  ensureTablesNotificaciones,
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
  notificarClientePlanActualizado,
  notificarSuperadminsEscaparateCoach
} = require("./notificaciones");
const { evaluarSuscripcionCoach } = require("./coachSuscripcion");
const {
  ensureTableConcesiones,
  listarConcesiones,
  otorgarConcesion,
  revocarConcesion,
  obtenerConcesionActiva,
  badgeSuscripcionUsuario
} = require("./concesionesAdmin");
const { buildMeso2Payload, PROGRAMA_MESO2 } = require("./data/programa-meso2-geovanni");
const { buildCorsOptions, isProduction } = require("./corsConfig");
const { generarOpinionInformeMensual } = require("./aiInforme");
const {
  fingerprintGrupos,
  leerInformeCache,
  guardarInformeCache
} = require("./informeIaCache");
const { buildResumenRutina } = require("./resumenRutinaInforme");
const { contextoMesInforme } = require("./informeMesContext");
const { seedAlimentosMetodog } = require("./seedAlimentos");
const { calcularSustitutos, SIN_SUSTITUTO } = require("./equivalenciasNutricion");
const { importarAlimentosCsv, previewImportacionCsv, PLANTILLA_CSV } = require("./importarAlimentos");
const {
  generarRecetaComida,
  generarDietaDiaCompleta,
  mensajeErrorAmigable,
  geminiConfigurado,
  formatoKeyPareceValido,
  probarConexionGemini,
  OPTIMIZER_DISPONIBLE,
  VERSION_PIPELINE_IA
} = require("./recetaIaGemini");
const { previewImportPlan } = require("./importarPlan");
const { importarPdfPreview } = require("./importarPlanPdf");
const { previewImportDietaIa, previewImportRutinaIa } = require("./importarPlanIa");
const { deduplicarFilasHistorialFuerza } = require("./fuerzaHistorial");
const {
  obtenerOverridesParaUsuario,
  upsertOverride,
  GRUPOS_VALIDOS
} = require("./catalogoEjercicios");
const multer = require("multer");
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const DEV_JWT_FALLBACK = "metodog-dev-cambiar-en-produccion";
if (isProduction()) {
  const secret = (process.env.JWT_SECRET || "").trim();
  if (!secret || secret === DEV_JWT_FALLBACK || secret.length < 32) {
    console.error(
      "❌ JWT_SECRET ausente o débil en producción. Define un secreto aleatorio ≥32 caracteres en Render."
    );
  }
}

const app = express();

app.post(
  "/api/pagos/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => handleStripeWebhook(req, res, db)
);

app.use(cors(buildCorsOptions()));
app.use(express.json());

/** Público — ANTES del JWT (UptimeRobot usa HEAD) */
function responderPing(req, res) {
  if (req.method === "HEAD") {
    return res.status(200).end();
  }
  res.status(200).json({
    ok: true,
    message: "pong",
    service: "metodog-backend",
    recetas_ia_gemini: geminiConfigurado(),
    recetas_ia_key_formato_ok: formatoKeyPareceValido(),
    version_pipeline: VERSION_PIPELINE_IA,
    optimizer: OPTIMIZER_DISPONIBLE ? VERSION_PIPELINE_IA : "off",
    ts: new Date().toISOString()
  });
}

app.get("/", (req, res) => {
  if (req.method === "HEAD") return res.status(200).end();
  res.status(200).json({
    ok: true,
    service: "metodog-backend",
    version_pipeline: VERSION_PIPELINE_IA,
    optimizer: OPTIMIZER_DISPONIBLE ? VERSION_PIPELINE_IA : "off"
  });
});
app.head("/", (req, res) => res.status(200).end());
app.all("/api/ping", responderPing);

/** Público — comprueba si Gemini responde (no genera combos). */
app.get("/api/alimentos/receta-ia/status", async (req, res) => {
  if (!geminiConfigurado()) {
    return res.status(503).json({ ok: false, motivo: "sin_api_key" });
  }
  try {
    const resultado = await probarConexionGemini();
    return res.status(resultado.ok ? 200 : 503).json({
      ...resultado,
      optimizer: OPTIMIZER_DISPONIBLE ? VERSION_PIPELINE_IA : "off",
      version_pipeline: VERSION_PIPELINE_IA
    });
  } catch (err) {
    return res.status(503).json({ ok: false, motivo: "api_error", detalle: err.message });
  }
});

app.use(requireAuthMiddleware);

process.on('uncaughtException', (err) => console.error("🔥 ERROR FATAL:", err));

function crearClienteDB() {
  const useLocal = process.env.USE_LOCAL_DB === "true";
  let url = (process.env.TURSO_DATABASE_URL || "").trim();
  const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim();

  if (useLocal || url.startsWith("file:")) {
    const localPath = url.startsWith("file:")
      ? url
      : `file:${path.join(__dirname, "metodog.db")}`;
    console.log(`📂 BD local: ${localPath}`);
    return createClient({ url: localPath });
  }

  if (!url) {
    throw new Error("TURSO_DATABASE_URL vacío. Usa USE_LOCAL_DB=true o credenciales de Turso.");
  }
  if (url.startsWith("libsql://")) url = url.replace("libsql://", "https://");
  console.log(`☁️ BD Turso: ${url.split("?")[0]}`);
  return createClient({ url, authToken });
}

const db = crearClienteDB();

// 💌 CONFIGURACIÓN DEL CARTERO RESEND
const resend = new Resend(process.env.RESEND_API_KEY);

async function inicializarBD() {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, email TEXT UNIQUE, password TEXT, 
      rol TEXT, codigo_invitacion TEXT UNIQUE, coach_id INTEGER, fecha_inicio DATETIME DEFAULT CURRENT_TIMESTAMP, calificacion REAL DEFAULT 5.0
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS rutinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER UNIQUE, datos_rutina TEXT, notas_generales TEXT, ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS mediciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, peso REAL, grasa REAL, datos_extra TEXT, fecha DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS valoraciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, coach_id INTEGER, cliente_id INTEGER UNIQUE, estrellas INTEGER, FOREIGN KEY(coach_id) REFERENCES usuarios(id), FOREIGN KEY(cliente_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS dietas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER UNIQUE, datos_dieta TEXT, macros_totales TEXT, notas_dieta TEXT, ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS alimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, grupo TEXT, porcion_base REAL, unidad TEXT, calorias REAL, proteinas REAL, carbohidratos REAL, grasas REAL, sodio REAL
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS recuperacion (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, codigo TEXT, fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 🔥 NUEVA TABLA: PERFILES EXTENDIDOS DE CLIENTES (FICHA INICIAL)
    await db.execute(`CREATE TABLE IF NOT EXISTS perfiles_clientes (
      usuario_id INTEGER PRIMARY KEY,
      edad INTEGER,
      estatura REAL,
      peso_kg REAL,
      genero TEXT,
      gustos TEXT,
      disgustos TEXT,
      enfermedades TEXT,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);

    for (const sql of [
      'ALTER TABLE perfiles_clientes ADD COLUMN peso_kg REAL',
      'ALTER TABLE perfiles_clientes ADD COLUMN genero TEXT',
      "ALTER TABLE perfiles_clientes ADD COLUMN intencion_atleta TEXT"
    ]) {
      try { await db.execute(sql); } catch (_) { /* columna ya existe */ }
    }

    await db.execute(`CREATE TABLE IF NOT EXISTS perfiles_coach_publicos (
      usuario_id INTEGER PRIMARY KEY,
      foto_url TEXT,
      bio TEXT,
      especialidad TEXT,
      logros TEXT,
      tarifa_base REAL,
      whatsapp TEXT,
      visible_en_directorio INTEGER DEFAULT 1,
      verificado INTEGER DEFAULT 0,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    try {
      await db.execute(
        "ALTER TABLE perfiles_coach_publicos ADD COLUMN verificado INTEGER DEFAULT 0"
      );
    } catch (_) { /* columna ya existe */ }
    try {
      await db.execute(
        "ALTER TABLE perfiles_coach_publicos ADD COLUMN redes_sociales TEXT DEFAULT '{}'"
      );
    } catch (_) { /* columna ya existe */ }
    for (const sql of [
      "ALTER TABLE perfiles_coach_publicos ADD COLUMN nombre_completo TEXT DEFAULT ''",
      "ALTER TABLE perfiles_coach_publicos ADD COLUMN edad INTEGER",
      "ALTER TABLE perfiles_coach_publicos ADD COLUMN ciudad TEXT DEFAULT ''",
      "ALTER TABLE perfiles_coach_publicos ADD COLUMN tiempo_entrenando TEXT DEFAULT ''"
    ]) {
      try { await db.execute(sql); } catch (_) { /* columna ya existe */ }
    }
    try {
      await db.execute(`
        UPDATE perfiles_coach_publicos SET verificado = 1
        WHERE usuario_id IN (SELECT id FROM usuarios WHERE rol = 'SUPERADMIN')
      `);
    } catch (err) {
      console.warn("migrar verificado SUPERADMIN:", err.message);
    }

    await db.execute(`CREATE TABLE IF NOT EXISTS planes_archivados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER,
      coach_id INTEGER,
      tipo TEXT,
      datos_json TEXT,
      archivado_hasta DATETIME,
      FOREIGN KEY(cliente_id) REFERENCES usuarios(id),
      FOREIGN KEY(coach_id) REFERENCES usuarios(id)
    )`);

    try {
      await db.execute("ALTER TABLE usuarios ADD COLUMN paquete_rutina_6_dias INTEGER DEFAULT 0");
    } catch (_) { /* columna ya existe */ }
    try {
      await db.execute("ALTER TABLE usuarios ADD COLUMN paquete_grandfathered INTEGER DEFAULT 0");
    } catch (_) { /* columna ya existe */ }

    await db.execute(`CREATE TABLE IF NOT EXISTS suscripciones_atleta (
      usuario_id INTEGER PRIMARY KEY,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      current_period_end TEXT,
      cancel_at_period_end INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS suscripciones_coach (
      usuario_id INTEGER PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'starter',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      limite_clientes INTEGER DEFAULT 5,
      current_period_end TEXT,
      cancel_at_period_end INTEGER DEFAULT 0,
      trial_end TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    try {
      await db.execute(
        "ALTER TABLE suscripciones_coach ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0"
      );
    } catch (_) { /* columna ya existe */ }
    try {
      await db.execute(
        "ALTER TABLE suscripciones_coach ADD COLUMN trial_end TEXT"
      );
    } catch (_) { /* columna ya existe */ }
    try {
      await db.execute(
        "ALTER TABLE suscripciones_coach ADD COLUMN trial_usado INTEGER DEFAULT 0"
      );
    } catch (_) { /* columna ya existe */ }
    try {
      await db.execute(`
        UPDATE suscripciones_coach SET trial_usado = 1
        WHERE COALESCE(trial_usado, 0) = 0
          AND (trial_end IS NOT NULL OR stripe_subscription_id IS NOT NULL)
      `);
    } catch (_) { /* ignore */ }

    await migrarPaquetesGrandfathered(db);

    await ensureTableConcesiones(db);

    await ensureTablesNotificaciones(db);

    await db.execute(`CREATE TABLE IF NOT EXISTS historial_fuerza (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      ejercicio TEXT NOT NULL,
      peso REAL NOT NULL,
      reps INTEGER DEFAULT 0,
      numero_serie INTEGER,
      dia_rutina TEXT,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_historial_fuerza_user_ej ON historial_fuerza(usuario_id, ejercicio)`);

    await db.execute(`CREATE TABLE IF NOT EXISTS notas_ejercicio_coach (
      coach_id INTEGER NOT NULL,
      nombre_ejercicio TEXT NOT NULL,
      nota TEXT NOT NULL DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (coach_id, nombre_ejercicio),
      FOREIGN KEY(coach_id) REFERENCES usuarios(id)
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS informes_anatomia_ia (
      usuario_id INTEGER NOT NULL,
      mes TEXT NOT NULL,
      fingerprint TEXT NOT NULL DEFAULT '',
      opinion TEXT NOT NULL DEFAULT '',
      siguiente_paso TEXT NOT NULL DEFAULT '[]',
      recomendaciones TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (usuario_id, mes),
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS catalogo_ejercicios_grupo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('coach', 'cliente')),
      nombre_norm TEXT NOT NULL,
      nombre_display TEXT NOT NULL,
      grupo TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_id, scope, nombre_norm),
      FOREIGN KEY(owner_id) REFERENCES usuarios(id)
    )`);
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_catalogo_ejercicios_owner ON catalogo_ejercicios_grupo(owner_id, scope)`
    );

    await seedAlimentosMetodog(db);
    console.log("✅ Base de datos conectada (suscripciones atleta/coach + tiers).");
  } catch (error) {
    console.error("❌ Error al conectar con la base de datos:", error.message);
    if (process.env.USE_LOCAL_DB !== "true") {
      console.error("💡 Si estás en local y falla la red a Turso, añade USE_LOCAL_DB=true en backend/.env");
    }
  }
}
inicializarBD();

function validarStripeEnProduccion() {
  if (!isProduction()) return;
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) {
    console.warn("⚠️ STRIPE_SECRET_KEY no definida — checkout deshabilitado.");
    return;
  }
  if (key.startsWith("sk_test_")) {
    console.error(
      "❌ STRIPE en modo TEST en producción (sk_test_…). Paso 5: sustituye por sk_live_ y Price IDs live en Render."
    );
    return;
  }
  if (key.startsWith("sk_live_")) {
    console.log("💳 Stripe LIVE configurado.");
  }
  const precios = [
    "STRIPE_PRICE_FULL_WEEK",
    "STRIPE_PRICE_COACH_STARTER",
    "STRIPE_PRICE_COACH_GROWTH",
    "STRIPE_PRICE_COACH_PRO",
    "STRIPE_PRICE_COACH_STUDIO",
    "STRIPE_PRICE_COACH_ELITE"
  ];
  const faltantes = precios.filter(k => !(process.env[k] || "").trim());
  if (faltantes.length > 0) {
    console.warn(`⚠️ Price IDs live faltantes en Render: ${faltantes.join(", ")}`);
  }

  if (!key.startsWith("sk_live_") && !key.startsWith("sk_test_")) return;

  const Stripe = require("stripe");
  const stripe = new Stripe(key);
  (async () => {
    for (const envKey of precios) {
      const priceId = (process.env[envKey] || "").trim();
      if (!priceId) continue;
      try {
        const price = await stripe.prices.retrieve(priceId);
        if (!price.active) {
          console.error(`❌ ${envKey}=${priceId} existe pero está INACTIVO en Stripe.`);
        } else {
          console.log(`✓ ${envKey} OK (${priceId}, ${price.currency} ${price.unit_amount / 100})`);
        }
      } catch (err) {
        console.error(
          `❌ ${envKey}=${priceId} NO válido con tu STRIPE_SECRET_KEY: ${err.message}\n` +
          `   → Copia el Price ID desde Stripe Dashboard en el MISMO modo (Live) y actualiza Render.`
        );
      }
    }
  })().catch(err => console.warn("validarStripeEnProduccion:", err.message));
}
validarStripeEnProduccion();

// 🚀 RUTAS GENERALES DE LA APP
app.get("/api/alimentos", async (req, res) => {
  try {
    const user = req.user;
    const esCoachOAdmin =
      user && (user.rol === "COACH" || user.rol === "SUPERADMIN");
    let sql = "SELECT * FROM alimentos WHERE coach_id IS NULL";
    const args = [];
    if (esCoachOAdmin) {
      const coachId = parseInt(user.id, 10);
      sql = "SELECT * FROM alimentos WHERE coach_id IS NULL OR coach_id = ?";
      args.push(coachId);
    }
    sql += " ORDER BY grupo, nombre ASC";
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/alimentos/plantilla-csv", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="plantilla_alimentos_metodog.csv"'
  );
  res.send(`\uFEFF${PLANTILLA_CSV}`);
});

app.post("/api/alimentos/preview-import-csv", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  const { csv, mapeo } = req.body || {};
  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "Envía el contenido del archivo en el campo «csv»." });
  }
  try {
    const resultado = previewImportacionCsv(csv, mapeo);
    if (!resultado.ok) {
      return res.status(400).json(resultado);
    }
    res.json(resultado);
  } catch (err) {
    console.error("preview-import-csv:", err.message);
    res.status(500).json({ error: err.message || "No se pudo analizar el archivo." });
  }
});

app.post("/api/planes/preview-import", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  const { texto, csv, tipo } = req.body || {};
  const raw = typeof texto === "string" ? texto : csv;
  if (!raw || typeof raw !== "string") {
    return res.status(400).json({ error: "Envía el contenido en el campo «texto» o «csv»." });
  }
  try {
    const resultado = previewImportPlan(raw, {
      tipo: tipo === "rutina" || tipo === "dieta" ? tipo : null
    });
    if (!resultado.ok) return res.status(400).json(resultado);
    res.json(resultado);
  } catch (err) {
    console.error("planes/preview-import:", err.message);
    res.status(500).json({ error: err.message || "No se pudo analizar el plan." });
  }
});

app.post("/api/planes/preview-import-ia", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  const { texto, origen, tipo } = req.body || {};
  if (!texto || typeof texto !== "string") {
    return res.status(400).json({ error: "Envía el texto en el campo «texto»." });
  }
  try {
    const esPdf = origen === "pdf";
    const resultado =
      tipo === "rutina"
        ? await previewImportRutinaIa(texto, { origen: esPdf ? "pdf" : "texto" })
        : await previewImportDietaIa(texto, { origen: esPdf ? "pdf" : "texto" });
    if (!resultado.ok) return res.status(400).json(resultado);
    res.json(resultado);
  } catch (err) {
    console.error("planes/preview-import-ia:", err.message);
    res.status(500).json({ error: err.message || "IA no disponible." });
  }
});

app.post("/api/planes/importar-pdf", uploadPdf.single("pdf"), async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ error: "Sube un archivo PDF en el campo «pdf»." });
  }
  const tipo = req.body?.tipo === "rutina" ? "rutina" : "dieta";
  try {
    const resultado = await importarPdfPreview(req.file.buffer, { tipo });
    if (!resultado.ok) return res.status(400).json(resultado);
    res.json(resultado);
  } catch (err) {
    console.error("planes/importar-pdf:", err.message);
    res.status(500).json({ error: err.message || "No se pudo leer el PDF." });
  }
});

app.post("/api/alimentos/importar-csv", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  const { csv, alcance, mapeo } = req.body || {};
  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "Envía el contenido del archivo en el campo «csv»." });
  }
  const coachId =
    req.user.rol === "SUPERADMIN" && alcance === "global"
      ? null
      : parseInt(req.user.id, 10);
  try {
    const resultado = await importarAlimentosCsv(db, coachId, csv, mapeo);
    if (!resultado.ok) {
      return res.status(400).json(resultado);
    }
    res.json(resultado);
  } catch (err) {
    console.error("importar-csv:", err.message);
    res.status(500).json({ error: err.message || "No se pudo importar el archivo." });
  }
});

async function usuarioPuedeRecetasIa(userId, rol) {
  if (rol === "SUPERADMIN" || rol === "COACH") return true;
  const r = await db.execute({
    sql: "SELECT paquete_rutina_6_dias FROM usuarios WHERE id = ?",
    args: [parseInt(userId, 10)]
  });
  return !!r.rows[0]?.paquete_rutina_6_dias;
}

function coachIdParaCatalogoIa(user) {
  if (!user || (user.rol !== "COACH" && user.rol !== "SUPERADMIN")) return null;
  const id = parseInt(user.id, 10);
  return Number.isNaN(id) || id <= 0 ? null : id;
}

app.get("/api/alimentos/receta-ia/probe", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: "Sesión requerida" });
  if (user.rol !== "SUPERADMIN" && user.rol !== "COACH") {
    return res.status(403).json({ ok: false, error: "Solo coach o superadmin." });
  }
  try {
    const resultado = await probarConexionGemini();
    res.status(resultado.ok ? 200 : 503).json(resultado);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/alimentos/receta-ia", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: "Sesión requerida" });

  const puede = await usuarioPuedeRecetasIa(user.id, user.rol);
  if (!puede) {
    return res.status(403).json({
      ok: false,
      error: "Activa Full Week PRO para usar recetas con IA."
    });
  }

  const payload = req.body || {};
  const iaOpts = { coachId: coachIdParaCatalogoIa(user) };
  try {
    const resultado = await generarRecetaComida(payload, db, iaOpts);
    if (!resultado.ok) {
      const esAdmin = user.rol === "SUPERADMIN" || user.rol === "COACH";
      const mostrarDetalle = esAdmin || resultado.motivo === "formato_key";
      const err400 = [
        "sin_catalogo",
        "sin_objetivo",
        "sin_ingredientes",
        "macros_cubiertos",
        "sin_comidas"
      ];
      return res.status(err400.includes(resultado.motivo) ? 400 : 503).json({
        ok: false,
        motivo: resultado.motivo,
        error: mensajeErrorAmigable(
          resultado.motivo,
          mostrarDetalle,
          resultado.detalle || ""
        )
      });
    }
    res.json(resultado);
  } catch (err) {
    console.error("receta-ia:", err.message);
    res.status(500).json({
      ok: false,
      error: mensajeErrorAmigable("api_error")
    });
  }
});

app.post("/api/alimentos/dieta-ia", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: "Sesión requerida" });

  console.log("========================================");
  console.log(`[MetodoG] Pipeline 4.7-PromptElite ACTIVA — POST /api/alimentos/dieta-ia`, new Date().toISOString());
  console.log("========================================");

  const puede = await usuarioPuedeRecetasIa(user.id, user.rol);
  if (!puede) {
    return res.status(403).json({
      ok: false,
      error: "Activa Full Week PRO para usar el planificador IA."
    });
  }

  const payload = req.body || {};
  const iaOpts = { coachId: coachIdParaCatalogoIa(user) };
  try {
    const resultado = await generarDietaDiaCompleta(payload, db, iaOpts);
    if (!resultado.ok) {
      const esAdmin = user.rol === "SUPERADMIN" || user.rol === "COACH";
      const mostrarDetalle =
        esAdmin ||
        resultado.motivo === "formato_key" ||
        resultado.motivo === "ids_invalidos" ||
        resultado.motivo === "parse_error" ||
        resultado.motivo === "plan_no_cuadrado";
      const err400 = [
        "sin_catalogo",
        "sin_objetivo",
        "sin_comidas",
        "ids_invalidos",
        "parse_error",
        "comidas_incompletas",
        "plan_no_cuadrado",
        "optimizador_fallo",
        "optimizador_off"
      ];
      return res.status(err400.includes(resultado.motivo) ? 400 : 503).json({
        ok: false,
        motivo: resultado.motivo,
        error: mensajeErrorAmigable(
          resultado.motivo,
          mostrarDetalle,
          resultado.detalle || ""
        )
      });
    }
    res.json(resultado);
  } catch (err) {
    console.error("dieta-ia:", err.message);
    res.status(500).json({
      ok: false,
      error: mensajeErrorAmigable("api_error")
    });
  }
});

app.post("/api/alimentos/sustitutos", async (req, res) => {
  const { alimento_id, nombre, cantidad, prioridad } = req.body || {};
  const cant = parseFloat(cantidad);
  if (!cant || cant <= 0) {
    return res.status(400).json({ error: "cantidad es obligatoria y debe ser > 0" });
  }
  if (!alimento_id && !nombre) {
    return res.status(400).json({ error: "alimento_id o nombre es obligatorio" });
  }
  try {
    let alimento;
    if (alimento_id) {
      const r = await db.execute({
        sql: "SELECT * FROM alimentos WHERE id = ?",
        args: [alimento_id]
      });
      alimento = r.rows[0];
    } else {
      const r = await db.execute({
        sql: "SELECT * FROM alimentos WHERE LOWER(nombre) = LOWER(?) LIMIT 1",
        args: [String(nombre).trim()]
      });
      alimento = r.rows[0];
    }
    if (!alimento) {
      return res.status(404).json({ error: "Alimento no encontrado en biblioteca" });
    }
    const ge = String(alimento.grupo_equivalencia || "").trim();
    if (!ge || SIN_SUSTITUTO.has(ge)) {
      return res.json({
        ok: false,
        motivo: "sin_sustituto",
        mensaje: "Este alimento no tiene intercambios automáticos. Consulta a tu coach."
      });
    }
    const bib = await db.execute("SELECT * FROM alimentos ORDER BY nombre ASC");
    const resultado = calcularSustitutos(alimento, cant, bib.rows, {
      prioridad: prioridad || "prot",
      limite: 3
    });
    return res.json({
      ...resultado,
      original: {
        id: alimento.id,
        nombre: alimento.nombre,
        cantidad: cant,
        unidad: alimento.unidad,
        grupo_equivalencia: ge
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/coach/notas-ejercicio", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  try {
    const result = await db.execute({
      sql: "SELECT nombre_ejercicio, nota, updated_at FROM notas_ejercicio_coach WHERE coach_id = ? ORDER BY nombre_ejercicio ASC",
      args: [req.user.id]
    });
    res.json({ notas: result.rows || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/coach/notas-ejercicio", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  const { nombre_ejercicio, nota } = req.body || {};
  const nombre = String(nombre_ejercicio || "").trim();
  const texto = String(nota || "").trim();
  if (!nombre) return res.status(400).json({ error: "nombre_ejercicio requerido" });
  if (!texto) return res.status(400).json({ error: "nota requerida" });
  try {
    await db.execute({
      sql: `INSERT INTO notas_ejercicio_coach (coach_id, nombre_ejercicio, nota, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(coach_id, nombre_ejercicio) DO UPDATE SET
              nota = excluded.nota,
              updated_at = datetime('now')`,
      args: [req.user.id, nombre, texto]
    });
    res.json({ mensaje: "Nota guardada en tu biblioteca" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/dietas/guardar", async (req, res) => {
  const { usuario_id, datos_dieta, macros_totales, notas_dieta } = req.body;
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;
  try {
    await db.execute({
      sql: `INSERT INTO dietas (usuario_id, datos_dieta, macros_totales, notas_dieta) VALUES (?, ?, ?, ?) ON CONFLICT(usuario_id) DO UPDATE SET datos_dieta = excluded.datos_dieta, macros_totales = excluded.macros_totales, notas_dieta = excluded.notas_dieta`,
      args: [usuario_id, JSON.stringify(datos_dieta), JSON.stringify(macros_totales), notas_dieta ?? ""]
    });
    await notificarClientePlanActualizado(db, req, usuario_id, "plan_dieta");
    res.json({ mensaje: "Dieta asignada" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/dietas/:usuario_id", async (req, res) => {
  if (!(await assertAccesoUsuario(db, req, res, req.params.usuario_id))) return;
  try {
    const result = await db.execute({ sql: "SELECT * FROM dietas WHERE usuario_id = ?", args: [req.params.usuario_id] });
    if (result.rows.length === 0) return res.json({ datos_dieta: null, macros_totales: null, notas_dieta: null });
    const row = result.rows[0];
    let notas = row.notas_dieta || "";
    if (typeof notas === "string" && notas.startsWith('"')) {
      try { notas = JSON.parse(notas); } catch { /* texto plano legacy */ }
    }
    res.json({
      datos_dieta: JSON.parse(row.datos_dieta),
      macros_totales: row.macros_totales ? JSON.parse(row.macros_totales) : null,
      notas_dieta: notas
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const generarCodigo = () => Math.random().toString(36).substring(2, 8).toUpperCase();

app.post("/api/rutinas/guardar", async (req, res) => {
  const { usuario_id, datos_rutina, notas_generales } = req.body;
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;
  try {
    await db.execute({
      sql: `INSERT INTO rutinas (usuario_id, datos_rutina, notas_generales) VALUES (?, ?, ?) ON CONFLICT(usuario_id) DO UPDATE SET datos_rutina = excluded.datos_rutina, notas_generales = excluded.notas_generales`,
      args: [usuario_id, JSON.stringify(datos_rutina), JSON.stringify(notas_generales)]
    });
    await notificarClientePlanActualizado(db, req, usuario_id, "plan_rutina");
    res.json({ mensaje: "Ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/rutinas/:usuario_id", async (req, res) => {
  if (!(await assertAccesoUsuario(db, req, res, req.params.usuario_id))) return;
  try {
    const result = await db.execute({ sql: "SELECT * FROM rutinas WHERE usuario_id = ?", args: [req.params.usuario_id] });
    if (result.rows.length === 0) return res.json({ datos_rutina: null, notas_generales: null });
    const row = result.rows[0];
    res.json({
      datos_rutina: JSON.parse(row.datos_rutina),
      notas_generales: row.notas_generales ? JSON.parse(row.notas_generales) : null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/fuerza/guardar", async (req, res) => {
  const { usuario_id, ejercicio, peso, reps, numero_serie, dia_rutina } = req.body;
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;
  if (!usuario_id || !ejercicio || peso == null || peso === "") {
    return res.status(400).json({ error: "usuario_id, ejercicio y peso son obligatorios" });
  }
  const pesoNum = parseFloat(peso);
  if (Number.isNaN(pesoNum)) return res.status(400).json({ error: "Peso inválido" });
  const repsNum = parseInt(reps, 10) || 0;
  const nSerie = numero_serie != null ? parseInt(numero_serie, 10) : null;
  const ejercicioStr = String(ejercicio).trim();
  try {
    const dup = await db.execute({
      sql: `SELECT id FROM historial_fuerza
            WHERE usuario_id = ? AND ejercicio = ?
              AND COALESCE(numero_serie, -1) = COALESCE(?, -1)
              AND date(fecha) = date('now')
            ORDER BY id ASC LIMIT 1`,
      args: [usuario_id, ejercicioStr, nSerie]
    });
    if (dup.rows?.length) {
      const existenteId = Number(dup.rows[0].id);
      const upd = await db.execute({
        sql: `UPDATE historial_fuerza SET peso = ?, reps = ?, dia_rutina = ? WHERE id = ?`,
        args: [pesoNum, repsNum, dia_rutina || null, existenteId]
      });
      if (!upd.rowsAffected) {
        return res.status(500).json({ error: "No se pudo actualizar la serie existente" });
      }
      return res.json({ mensaje: "Ok", id: existenteId, duplicado: true });
    }

    const result = await db.execute({
      sql: `INSERT INTO historial_fuerza (usuario_id, ejercicio, peso, reps, numero_serie, dia_rutina) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [usuario_id, ejercicioStr, pesoNum, repsNum, nSerie, dia_rutina || null]
    });
    res.json({ mensaje: "Ok", id: Number(result.lastInsertRowid) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/fuerza/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });
  try {
    const row = await db.execute({
      sql: `SELECT usuario_id FROM historial_fuerza WHERE id = ? LIMIT 1`,
      args: [id]
    });
    if (!row.rows?.length) return res.status(404).json({ error: "Registro no encontrado" });
    const usuarioId = row.rows[0].usuario_id;
    if (!(await assertAccesoUsuarioEdicion(db, req, res, usuarioId))) return;
    const del = await db.execute({
      sql: `DELETE FROM historial_fuerza WHERE id = ?`,
      args: [id]
    });
    if (!del.rowsAffected) return res.status(404).json({ error: "Registro no encontrado" });
    res.json({ mensaje: "Ok", id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/fuerza/desmarcar", async (req, res) => {
  const { usuario_id, ejercicio, numero_serie } = req.body || {};
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;
  if (!usuario_id || !ejercicio) {
    return res.status(400).json({ error: "usuario_id y ejercicio son obligatorios" });
  }
  const nSerie = numero_serie != null ? parseInt(numero_serie, 10) : null;
  const ejercicioStr = String(ejercicio).trim();
  try {
    const candidatos = await db.execute({
      sql: `SELECT id, numero_serie FROM historial_fuerza
            WHERE usuario_id = ? AND ejercicio = ? AND date(fecha) = date('now')
            ORDER BY id DESC LIMIT 30`,
      args: [usuario_id, ejercicioStr]
    });
    const fila = (candidatos.rows || []).find(
      (r) => (r.numero_serie == null ? null : Number(r.numero_serie)) === nSerie
    );
    if (!fila) return res.status(404).json({ error: "Serie no encontrada hoy" });
    const del = await db.execute({
      sql: `DELETE FROM historial_fuerza WHERE id = ?`,
      args: [fila.id]
    });
    if (!del.rowsAffected) return res.status(404).json({ error: "Registro no encontrado" });
    res.json({ mensaje: "Ok", id: Number(fila.id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/fuerza/hoy/:usuario_id", async (req, res) => {
  const usuarioId = req.params.usuario_id;
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuarioId))) return;
  try {
    const del = await db.execute({
      sql: `DELETE FROM historial_fuerza WHERE usuario_id = ? AND date(fecha) = date('now')`,
      args: [usuarioId]
    });
    if (!del.rowsAffected && del.rowsAffected !== 0) {
      return res.status(500).json({ error: "No se pudo limpiar el historial de hoy" });
    }
    res.json({ mensaje: "Ok", eliminados: Number(del.rowsAffected || 0) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/catalogo-ejercicios/overrides/:usuario_id", async (req, res) => {
  const usuarioId = req.params.usuario_id;
  if (!(await assertAccesoUsuario(db, req, res, usuarioId))) return;
  try {
    const data = await obtenerOverridesParaUsuario(db, usuarioId);
    res.json({
      merged: data.merged,
      coach: data.coach,
      cliente: data.cliente,
      coach_id: data.coach_id
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/catalogo-ejercicios/overrides", async (req, res) => {
  const { nombre, grupo, scope, usuario_id: usuarioIdBody } = req.body || {};
  const scopeVal = scope === "cliente" ? "cliente" : "coach";
  const grupoStr = String(grupo || "").trim();
  if (!GRUPOS_VALIDOS.has(grupoStr)) {
    return res.status(400).json({ error: "grupo muscular inválido" });
  }
  if (!String(nombre || "").trim()) {
    return res.status(400).json({ error: "nombre es obligatorio" });
  }

  try {
    let ownerId;
    if (scopeVal === "coach") {
      const coachId = Number(req.user?.id);
      if (!coachId || (req.user?.rol !== "COACH" && req.user?.rol !== "SUPERADMIN")) {
        return res.status(403).json({ error: "Solo coach puede guardar en biblioteca coach" });
      }
      ownerId = coachId;
    } else {
      const uid = Number(usuarioIdBody || req.user?.id);
      if (!(await assertAccesoUsuarioEdicion(db, req, res, uid))) return;
      ownerId = uid;
    }

    const result = await upsertOverride(db, {
      ownerId,
      scope: scopeVal,
      nombre,
      grupo: grupoStr
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ mensaje: "Ok", ...result, scope: scopeVal, owner_id: ownerId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/fuerza/historial/:usuario_id/:ejercicio", async (req, res) => {
  if (!(await assertAccesoUsuario(db, req, res, req.params.usuario_id))) return;
  try {
    const ejercicio = decodeURIComponent(req.params.ejercicio || "");
    const result = await db.execute({
      sql: `SELECT id, ejercicio, peso, reps, numero_serie, dia_rutina, fecha
            FROM historial_fuerza WHERE usuario_id = ? AND ejercicio = ? ORDER BY fecha ASC, id ASC LIMIT 500`,
      args: [req.params.usuario_id, ejercicio]
    });
    const historial = deduplicarFilasHistorialFuerza(
      (result.rows || []).map((r) => ({ ...r, usuario_id: req.params.usuario_id }))
    );
    res.json({ historial });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/fuerza/historial/:usuario_id", async (req, res) => {
  if (!(await assertAccesoUsuario(db, req, res, req.params.usuario_id))) return;
  try {
    const result = await db.execute({
      sql: `SELECT id, ejercicio, peso, reps, numero_serie, dia_rutina, fecha
            FROM historial_fuerza WHERE usuario_id = ? ORDER BY fecha ASC, id ASC LIMIT 1000`,
      args: [req.params.usuario_id]
    });
    const historial = deduplicarFilasHistorialFuerza(
      (result.rows || []).map((r) => ({ ...r, usuario_id: req.params.usuario_id }))
    );
    const ejercicios = [...new Set(historial.map((r) => r.ejercicio))];
    res.json({ historial, ejercicios });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/rendimiento/informe-ia", async (req, res) => {
  const {
    usuario_id,
    mes,
    grupos,
    balance_score,
    fuente_grupos,
    reglas_base
  } = req.body || {};
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;
  if (!mes) return res.status(400).json({ ok: false, error: "mes requerido" });

  const regenerar = req.query.regenerar === "1" || req.query.regenerar === 1;

  let resumenRutina = { tiene_rutina: false, fingerprint: "" };
  try {
    const rutRes = await db.execute({
      sql: "SELECT datos_rutina FROM rutinas WHERE usuario_id = ?",
      args: [usuario_id]
    });
    if (rutRes.rows[0]?.datos_rutina) {
      resumenRutina = buildResumenRutina(rutRes.rows[0].datos_rutina);
    }
  } catch (err) {
    console.warn("[informe-ia] rutina:", err?.message);
  }

  const fp = fingerprintGrupos(
    grupos || [],
    balance_score ?? 0,
    resumenRutina.fingerprint || ""
  );

  try {
    if (!regenerar) {
      const cache = await leerInformeCache(db, usuario_id, mes);
      if (cache && cache.fingerprint === fp) {
        return res.json({
          ok: true,
          ia: true,
          cached: true,
          opinion: cache.opinion,
          siguiente_paso: cache.siguiente_paso,
          recomendaciones: cache.recomendaciones
        });
      }
    }

    const ctxMes = contextoMesInforme(mes);
    const resultado = await generarOpinionInformeMensual({
      mes,
      grupos,
      balanceScore: balance_score,
      fuenteGrupos: resumenRutina.tiene_rutina ? "rutina" : (fuente_grupos || "nombre"),
      reglasBase: reglas_base,
      resumenRutina,
      corteParcial: ctxMes.corteParcial,
      diaMes: ctxMes.diaMes,
      pctMes: ctxMes.pctMes
    });

    if (!resultado.ok) {
      return res.json({ ok: false, motivo: resultado.motivo || "sin_ia" });
    }

    await guardarInformeCache(db, usuario_id, mes, fp, resultado);
    return res.json({ ...resultado, cached: false });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/pagos/crear-checkout-atleta", async (req, res) => {
  return crearCheckoutAtleta(req, res, db);
});

app.post("/api/pagos/crear-checkout-coach", async (req, res) => {
  return crearCheckoutCoach(req, res, db);
});

app.post("/api/pagos/iniciar-trial-coach", async (req, res) => {
  return iniciarTrialCoach(req, res, db);
});

app.post("/api/pagos/portal-coach", async (req, res) => {
  return crearPortalCoach(req, res, db);
});

app.post("/api/pagos/reset-coach-stripe-live", async (req, res) => {
  return resetCoachStripeLive(req, res, db);
});

async function cancelarSuscripcionesStripeUsuario(db, userId) {
  try {
    const Stripe = require("stripe");
    const key = (process.env.STRIPE_SECRET_KEY || "").trim();
    if (!key) return;

    const stripe = new Stripe(key);
    for (const tabla of ["suscripciones_coach", "suscripciones_atleta"]) {
      const subRes = await db.execute({
        sql: `SELECT stripe_subscription_id FROM ${tabla} WHERE usuario_id = ?`,
        args: [userId]
      });
      const subId = subRes.rows[0]?.stripe_subscription_id;
      if (subId) await stripe.subscriptions.cancel(subId);
    }
  } catch (err) {
    console.warn("cancelarSuscripcionesStripeUsuario:", err.message);
  }
}

async function eliminarUsuarioCompleto(db, userId) {
  await cancelarSuscripcionesStripeUsuario(db, userId);

  await db.execute({
    sql: "UPDATE usuarios SET coach_id = NULL WHERE coach_id = ?",
    args: [userId]
  });

  const tablasUsuario = [
    ["rutinas", "usuario_id"],
    ["dietas", "usuario_id"],
    ["mediciones", "usuario_id"],
    ["historial_fuerza", "usuario_id"],
    ["perfiles_clientes", "usuario_id"],
    ["perfiles_coach_publicos", "usuario_id"],
    ["suscripciones_coach", "usuario_id"],
    ["suscripciones_atleta", "usuario_id"],
    ["informes_anatomia_ia", "usuario_id"],
    ["notificaciones", "usuario_id"]
  ];
  for (const [tabla, col] of tablasUsuario) {
    await db.execute({ sql: `DELETE FROM ${tabla} WHERE ${col} = ?`, args: [userId] });
  }

  await db.execute({
    sql: "DELETE FROM solicitudes_vinculo WHERE cliente_id = ? OR coach_id = ?",
    args: [userId, userId]
  });
  await db.execute({
    sql: "DELETE FROM planes_archivados WHERE coach_id = ? OR cliente_id = ?",
    args: [userId, userId]
  });
  await db.execute({
    sql: "DELETE FROM valoraciones WHERE coach_id = ? OR cliente_id = ?",
    args: [userId, userId]
  });
  await db.execute({
    sql: "DELETE FROM notas_ejercicio_coach WHERE coach_id = ?",
    args: [userId]
  });
  await db.execute({
    sql: "DELETE FROM recuperacion WHERE email = (SELECT email FROM usuarios WHERE id = ?)",
    args: [userId]
  });

  const del = await db.execute({ sql: "DELETE FROM usuarios WHERE id = ?", args: [userId] });
  return (del.rowsAffected ?? 0) > 0;
}

app.get("/api/admin/usuarios", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;

  const q = String(req.query.q || "").trim().toLowerCase();
  const limite = Math.min(parseInt(req.query.limit, 10) || 200, 500);

  try {
    let sql = `
      SELECT u.id, u.nombre, u.email, u.rol, u.coach_id, u.fecha_inicio,
        u.paquete_rutina_6_dias, u.paquete_grandfathered,
        sc.status AS coach_sub_status,
        sc.plan AS coach_plan,
        sa.status AS atleta_sub_status,
        COALESCE(p.verificado, 0) AS directorio_verificado
      FROM usuarios u
      LEFT JOIN suscripciones_coach sc ON sc.usuario_id = u.id
      LEFT JOIN suscripciones_atleta sa ON sa.usuario_id = u.id
      LEFT JOIN perfiles_coach_publicos p ON p.usuario_id = u.id
      WHERE u.rol != 'SUPERADMIN'
    `;
    const args = [];
    if (q) {
      sql += ` AND (LOWER(u.nombre) LIKE ? OR LOWER(u.email) LIKE ?)`;
      args.push(`%${q}%`, `%${q}%`);
    }
    sql += ` ORDER BY u.fecha_inicio DESC, u.nombre ASC LIMIT ?`;
    args.push(limite);

    const result = await db.execute({ sql, args });
    const rows = await Promise.all(
      (result.rows || []).map(async (r) => {
        const concesion = await obtenerConcesionActiva(db, r.id);
        const activa = concesion && concesion.status === "active";
        return {
          id: Number(r.id),
          nombre: r.nombre,
          email: r.email,
          rol: r.rol,
          coach_id: r.coach_id != null ? Number(r.coach_id) : null,
          fecha_inicio: r.fecha_inicio,
          coach_sub_status: r.coach_sub_status || null,
          coach_plan: r.coach_plan || null,
          atleta_sub_status: r.atleta_sub_status || null,
          paquete_rutina_6_dias: !!Number(r.paquete_rutina_6_dias),
          paquete_grandfathered: !!Number(r.paquete_grandfathered),
          directorio_verificado: !!Number(r.directorio_verificado),
          suscripcion_badge: badgeSuscripcionUsuario(r, activa),
          concesion_activa: activa,
          concesion_tipo: activa ? concesion.tipo : null,
          concesion_plan: activa ? concesion.plan : null,
          concesion_fin: activa ? concesion.fin || null : null
        };
      })
    );
    res.json(rows);
  } catch (err) {
    console.error("Error admin listar usuarios:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/concesiones", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;

  const usuarioId = req.query.usuario_id ? parseInt(req.query.usuario_id, 10) : null;
  const soloActivas = req.query.activas === "1" || req.query.activas === "true";

  try {
    const rows = await listarConcesiones(db, { usuarioId, soloActivas });
    res.json(rows);
  } catch (err) {
    console.error("Error admin listar concesiones:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/concesiones", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;

  try {
    const result = await otorgarConcesion(db, {
      ...req.body,
      concedido_por: req.user.id
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.status(201).json(result);
  } catch (err) {
    console.error("Error admin otorgar concesión:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/concesiones/:id", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;

  const concesionId = parseInt(req.params.id, 10);
  if (!concesionId || Number.isNaN(concesionId)) {
    return res.status(400).json({ error: "ID de concesión inválido" });
  }

  try {
    const result = await revocarConcesion(
      db,
      concesionId,
      req.user.id,
      req.body?.motivo_revocacion
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error("Error admin revocar concesión:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/usuarios/:id", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;

  const targetId = parseInt(req.params.id, 10);
  const adminId = parseInt(req.user.id, 10);
  if (!targetId || Number.isNaN(targetId)) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }
  if (targetId === adminId) {
    return res.status(400).json({ error: "No puedes eliminar tu propia cuenta SUPERADMIN" });
  }

  try {
    const userRes = await db.execute({
      sql: "SELECT id, nombre, email, rol FROM usuarios WHERE id = ?",
      args: [targetId]
    });
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const target = userRes.rows[0];
    if (target.rol === "SUPERADMIN") {
      return res.status(403).json({ error: "No se puede eliminar otra cuenta SUPERADMIN" });
    }

    const ok = await eliminarUsuarioCompleto(db, targetId);
    if (!ok) return res.status(404).json({ error: "Usuario no encontrado" });

    res.json({
      deleted: true,
      id: targetId,
      email: target.email,
      mensaje: `Cuenta ${target.email} eliminada permanentemente.`
    });
  } catch (err) {
    console.error("Error admin eliminar usuario:", err.message);
    res.status(500).json({ error: err.message || "No se pudo eliminar la cuenta" });
  }
});

app.delete("/api/usuarios/me", async (req, res) => {
  const userId = parseInt(req.user.id, 10);
  if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: "Usuario inválido" });

  try {
    const ok = await eliminarUsuarioCompleto(db, userId);
    if (!ok) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("Error eliminar cuenta:", err.message);
    res.status(500).json({ error: "No se pudo eliminar la cuenta" });
  }
});

app.put("/api/usuarios/paquete-6-dias", async (req, res) => {
  if (isProduction() && req.user.rol !== "SUPERADMIN") {
    return res.status(403).json({
      error: "Activa Full Week PRO desde Paquetes (Stripe). Solo SUPERADMIN puede simular en producción."
    });
  }
  const { usuario_id, activo } = req.body;
  if (!usuario_id) return res.status(400).json({ error: "usuario_id requerido" });
  if (parseInt(usuario_id, 10) !== parseInt(req.user.id, 10) && req.user.rol !== "SUPERADMIN") {
    return res.status(403).json({ error: "Solo puedes activar tu propio paquete" });
  }
  try {
    const flag = activo ? 1 : 0;
    const grandfather = activo ? 1 : 0;
    const result = await db.execute({
      sql: "UPDATE usuarios SET paquete_rutina_6_dias = ?, paquete_grandfathered = ? WHERE id = ?",
      args: [flag, grandfather, usuario_id]
    });
    if ((result.rowsAffected ?? 0) === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ paquete_rutina_6_dias: !!activo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/mediciones/guardar", async (req, res) => {
  const { usuario_id, peso, grasa, datos_extra } = req.body;
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;
  try {
    await db.execute({ sql: "INSERT INTO mediciones (usuario_id, peso, grasa, datos_extra) VALUES (?, ?, ?, ?)", args: [usuario_id, peso, grasa, datos_extra] });
    res.json({ mensaje: "Ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/mediciones/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: "ID de medición inválido" });
  }
  try {
    const owner = await db.execute({ sql: "SELECT usuario_id FROM mediciones WHERE id = ?", args: [id] });
    if (owner.rows.length === 0) return res.status(404).json({ error: "Registro no encontrado" });
    if (!(await assertAccesoUsuarioEdicion(db, req, res, owner.rows[0].usuario_id))) return;

    const result = await db.execute({
      sql: "DELETE FROM mediciones WHERE id = ?",
      args: [id]
    });
    const affected = result.rowsAffected ?? 0;
    if (affected === 0) {
      return res.status(404).json({ error: "Registro no encontrado" });
    }
    res.json({ mensaje: "Eliminado", deleted: affected });
  } catch (err) {
    console.error("Error DELETE medicion:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NUEVA RUTA: GUARDAR O ACTUALIZAR EL FORMULARIO DEL CLIENTE
app.post("/api/clientes/guardar-perfil", async (req, res) => {
  const { usuario_id, edad, estatura, peso_kg, genero, gustos, disgustos, enfermedades, intencion_atleta } = req.body;
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;
  const generoNorm = genero === 'F' ? 'F' : genero === 'M' ? 'M' : null;
  let intencionNorm = null;
  if (intencion_atleta != null && String(intencion_atleta).trim() !== '') {
    const raw = String(intencion_atleta).toLowerCase().trim();
    if (raw === 'solo' || raw === 'coach' || raw === 'busco_coach') {
      intencionNorm = raw === 'busco_coach' ? 'coach' : raw;
    } else {
      return res.status(400).json({ error: "intencion_atleta debe ser 'solo' o 'coach'" });
    }
  }
  try {
    await db.execute({
      sql: `INSERT INTO perfiles_clientes (usuario_id, edad, estatura, peso_kg, genero, gustos, disgustos, enfermedades, intencion_atleta) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) 
            ON CONFLICT(usuario_id) 
            DO UPDATE SET 
              edad = COALESCE(excluded.edad, perfiles_clientes.edad),
              estatura = COALESCE(excluded.estatura, perfiles_clientes.estatura),
              peso_kg = COALESCE(excluded.peso_kg, perfiles_clientes.peso_kg),
              genero = COALESCE(excluded.genero, perfiles_clientes.genero),
              gustos = COALESCE(NULLIF(excluded.gustos, ''), perfiles_clientes.gustos),
              disgustos = COALESCE(NULLIF(excluded.disgustos, ''), perfiles_clientes.disgustos),
              enfermedades = COALESCE(NULLIF(excluded.enfermedades, ''), perfiles_clientes.enfermedades),
              intencion_atleta = COALESCE(excluded.intencion_atleta, perfiles_clientes.intencion_atleta)`,
      args: [
        usuario_id,
        edad != null && edad !== '' ? parseInt(edad, 10) : null,
        estatura != null && estatura !== '' ? parseFloat(estatura) : null,
        peso_kg != null && peso_kg !== '' ? parseFloat(peso_kg) : null,
        generoNorm,
        gustos != null ? String(gustos).trim() : null,
        disgustos != null ? String(disgustos).trim() : null,
        enfermedades != null ? String(enfermedades).trim() : null,
        intencionNorm
      ]
    });
    res.json({ mensaje: "Perfil de diagnóstico guardado correctamente" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/clientes/desvincular-coach", async (req, res) => {
  const { cliente_id } = req.body;
  if (!cliente_id) return res.status(400).json({ error: "cliente_id requerido" });
  if (parseInt(cliente_id, 10) !== parseInt(req.user.id, 10)) {
    return res.status(403).json({ error: "Solo puedes desvincular tu propia cuenta" });
  }
  try {
    const userRes = await db.execute({ sql: "SELECT id, coach_id FROM usuarios WHERE id = ?", args: [cliente_id] });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Cliente no encontrado" });
    const cliente = userRes.rows[0];
    if (!cliente.coach_id) return res.status(400).json({ error: "No tienes un coach asignado" });

    const coachId = cliente.coach_id;
    const archivadoHasta = new Date();
    archivadoHasta.setDate(archivadoHasta.getDate() + 30);
    const hastaISO = archivadoHasta.toISOString();

    const rutinaRes = await db.execute({ sql: "SELECT datos_rutina, notas_generales FROM rutinas WHERE usuario_id = ?", args: [cliente_id] });
    if (rutinaRes.rows.length > 0) {
      await db.execute({
        sql: "INSERT INTO planes_archivados (cliente_id, coach_id, tipo, datos_json, archivado_hasta) VALUES (?, ?, ?, ?, ?)",
        args: [cliente_id, coachId, "rutina", JSON.stringify(rutinaRes.rows[0]), hastaISO]
      });
    }
    const dietaRes = await db.execute({ sql: "SELECT datos_dieta, macros_totales, notas_dieta FROM dietas WHERE usuario_id = ?", args: [cliente_id] });
    if (dietaRes.rows.length > 0) {
      await db.execute({
        sql: "INSERT INTO planes_archivados (cliente_id, coach_id, tipo, datos_json, archivado_hasta) VALUES (?, ?, ?, ?, ?)",
        args: [cliente_id, coachId, "dieta", JSON.stringify(dietaRes.rows[0]), hastaISO]
      });
    }

    await cancelarSolicitudesPendientesCliente(db, cliente_id);

    const updateRes = await db.execute({ sql: "UPDATE usuarios SET coach_id = NULL WHERE id = ?", args: [cliente_id] });
    if ((updateRes.rowsAffected ?? 0) === 0) {
      return res.status(500).json({ error: "No se pudo actualizar el vínculo" });
    }
    res.json({ mensaje: "Desvinculado correctamente", archivado_hasta: hastaISO });
  } catch (err) {
    console.error("Error desvincular coach:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clientes/vincular-coach", async (req, res) => {
  const { coach_id } = req.body || {};
  const coachId = parseInt(coach_id, 10);
  const clienteId = parseInt(req.user.id, 10);

  if (!coachId || Number.isNaN(coachId)) return res.status(400).json({ error: "coach_id requerido" });
  if (!clienteId || Number.isNaN(clienteId)) return res.status(400).json({ error: "Cliente inválido" });

  if (req.user.rol !== "CLIENTE") {
    return res.status(403).json({ error: "Solo CLIENTE puede vincularse a un coach" });
  }

  try {
    const result = await solicitarVinculoCoach(db, { clienteId, coachId, resend });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    const userRes = await db.execute({ sql: "SELECT * FROM usuarios WHERE id = ?", args: [clienteId] });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Cliente no encontrado" });
    let usuario = sanitizeUsuario(userRes.rows[0]);
    usuario = await enrichUsuarioConSuscripcion(db, usuario);
    usuario = await enrichUsuarioVinculo(db, usuario);

    res.json({
      pendiente: true,
      mensaje: result.mensaje,
      solicitud_id: result.solicitud_id != null ? Number(result.solicitud_id) : null,
      usuario
    });
  } catch (err) {
    console.error("Error vincular coach:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/notificaciones/contador", async (req, res) => {
  try {
    const no_leidas = await contarNotificacionesNoLeidas(db, req.user.id);
    res.json({ no_leidas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/notificaciones", async (req, res) => {
  try {
    const filtro = (req.query.filtro || "all").trim();
    const notificaciones = await listarNotificaciones(db, req.user.id, { filtro });
    res.json({ notificaciones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/notificaciones/leer-todas", async (req, res) => {
  try {
    const actualizadas = await marcarTodasNotificacionesLeidas(db, req.user.id);
    res.json({ mensaje: "Ok", actualizadas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/notificaciones/:id/leer", async (req, res) => {
  const notifId = parseInt(req.params.id, 10);
  if (!notifId) return res.status(400).json({ error: "id inválido" });
  try {
    const ok = await marcarNotificacionLeida(db, req.user.id, notifId);
    if (!ok) return res.status(404).json({ error: "Notificación no encontrada" });
    res.json({ mensaje: "Ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/notificaciones/todas", async (req, res) => {
  try {
    const borradas = await borrarTodasNotificaciones(db, req.user.id);
    res.json({ mensaje: "Ok", borradas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/notificaciones/:id", async (req, res) => {
  const notifId = parseInt(req.params.id, 10);
  if (!notifId) return res.status(400).json({ error: "id inválido" });
  try {
    const ok = await borrarNotificacion(db, req.user.id, notifId);
    if (!ok) return res.status(404).json({ error: "Notificación no encontrada" });
    res.json({ mensaje: "Ok", borrada: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/solicitudes-vinculo/:id/responder", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  const solicitudId = parseInt(req.params.id, 10);
  const { accion } = req.body || {};
  if (!solicitudId) return res.status(400).json({ error: "id inválido" });
  if (accion !== "aceptar" && accion !== "rechazar") {
    return res.status(400).json({ error: "accion debe ser aceptar o rechazar" });
  }
  try {
    const result = await responderSolicitudVinculo(db, {
      solicitudId,
      coachUserId: req.user.id,
      accion,
      resend
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ mensaje: result.mensaje, cliente_id: result.cliente_id });
  } catch (err) {
    console.error("Error responder solicitud:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Carga programa Meso 2 en la rutina del SUPERADMIN autenticado (prueba en vivo). */
app.post("/api/admin/seed-meso2-rutina", async (req, res) => {
  if (req.user.rol !== "SUPERADMIN") {
    return res.status(403).json({ error: "Solo SUPERADMIN puede cargar esta rutina de prueba" });
  }
  try {
    const userRes = await db.execute({
      sql: "SELECT id, rol FROM usuarios WHERE id = ?",
      args: [req.user.id]
    });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    if (userRes.rows[0].rol !== "SUPERADMIN") {
      return res.status(403).json({ error: "Cuenta no es SUPERADMIN" });
    }

    const { datos_rutina, notas_generales } = buildMeso2Payload(PROGRAMA_MESO2);
    const totalEjercicios = Object.keys(datos_rutina)
      .filter((k) => !k.startsWith("_"))
      .reduce((acc, d) => acc + (datos_rutina[d]?.length || 0), 0);

    const result = await db.execute({
      sql: `INSERT INTO rutinas (usuario_id, datos_rutina, notas_generales, ultima_actualizacion)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(usuario_id) DO UPDATE SET
              datos_rutina = excluded.datos_rutina,
              notas_generales = excluded.notas_generales,
              ultima_actualizacion = datetime('now')`,
      args: [req.user.id, JSON.stringify(datos_rutina), JSON.stringify(notas_generales)]
    });
    if ((result.rowsAffected ?? 0) === 0) {
      return res.status(500).json({ error: "No se pudo guardar la rutina" });
    }

    res.json({
      mensaje: "Programa Meso 2 cargado en tu cuenta",
      nombre_rutina: PROGRAMA_MESO2.nombre_rutina,
      ejercicios: totalEjercicios,
      sesiones: 6
    });
  } catch (err) {
    console.error("Error seed meso2:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🔄 RUTA ACTUALIZADA: ENVÍA EL PACK COMPLETO AL COACH (INFO, PERFIL Y HISTORIAL)
app.get("/api/clientes/:id/resumen", async (req, res) => {
  if (!(await assertAccesoUsuario(db, req, res, req.params.id))) return;
  try {
    // 1. Obtener datos base del usuario
    const infoRes = await db.execute({ sql: "SELECT nombre, email, fecha_inicio FROM usuarios WHERE id = ?", args: [req.params.id] });
    if (infoRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    
    // 2. Obtener su perfil extendido (si no lo ha llenado, manda valores vacíos por defecto)
    const perfilRes = await db.execute({ sql: "SELECT edad, estatura, peso_kg, genero, gustos, disgustos, enfermedades, intencion_atleta FROM perfiles_clientes WHERE usuario_id = ?", args: [req.params.id] });
    const perfil = perfilRes.rows.length > 0 ? perfilRes.rows[0] : { edad: null, estatura: null, peso_kg: null, genero: null, gustos: "", disgustos: "", enfermedades: "", intencion_atleta: null };

    // 3. Obtener su historial de pesajes ordenados del más reciente al más antiguo
    const histRes = await db.execute({ sql: "SELECT id, peso, grasa, datos_extra, fecha FROM mediciones WHERE usuario_id = ? ORDER BY fecha DESC", args: [req.params.id] });
    
    // Mandamos las 3 piezas de información en una sola respuesta limpia
    const clienteId = parseInt(req.params.id, 10);
    res.json({ 
      info: { id: clienteId, ...infoRes.rows[0] }, 
      perfil: perfil,
      historial: histRes.rows || [] 
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/comunidad/:id", async (req, res) => {
  if (!assertComunidadSelf(req, res)) return;
  if (!(await assertCoachOAdmin(db, req, res))) return;
  try {
    const userRes = await db.execute({ sql: "SELECT rol FROM usuarios WHERE id = ?", args: [req.params.id] });
    if (userRes.rows.length === 0) return res.json([]);
    const user = userRes.rows[0];
    if (user.rol === 'SUPERADMIN') {
      const allRes = await db.execute("SELECT id, nombre, email, rol, coach_id, calificacion, codigo_invitacion FROM usuarios");
      res.json(allRes.rows);
    } else if (user.rol === 'COACH') {
      const coachRes = await db.execute({ sql: "SELECT id, nombre, email, rol FROM usuarios WHERE coach_id = ?", args: [req.params.id] });
      res.json(coachRes.rows);
    } else { res.json([]); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/coach/:id", async (req, res) => {
  try {
    const coachRes = await db.execute({ sql: "SELECT id, nombre, email, calificacion FROM usuarios WHERE id = ?", args: [req.params.id] });
    if (coachRes.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(coachRes.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/directorio/coaches", async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT u.id, u.nombre, u.calificacion, u.codigo_invitacion,
        p.foto_url, p.bio, p.especialidad, p.logros, p.tarifa_base, p.whatsapp,
        COALESCE(p.redes_sociales, '{}') AS redes_sociales
      FROM usuarios u
      INNER JOIN perfiles_coach_publicos p ON p.usuario_id = u.id
      INNER JOIN suscripciones_coach s ON s.usuario_id = u.id
      WHERE u.rol IN ('COACH', 'SUPERADMIN')
        AND COALESCE(p.verificado, 0) = 1
        AND COALESCE(p.visible_en_directorio, 1) = 1
        AND (
          u.rol = 'SUPERADMIN'
          OR s.status = 'active'
        )
      ORDER BY u.calificacion DESC, u.nombre ASC
    `);
    res.json(result.rows || []);
  } catch (err) {
    console.error("Error directorio coaches:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PERFIL_COACH_SELECT = `foto_url, bio, especialidad, logros, tarifa_base, whatsapp,
  visible_en_directorio, verificado, COALESCE(redes_sociales, '{}') AS redes_sociales,
  COALESCE(nombre_completo, '') AS nombre_completo, edad, COALESCE(ciudad, '') AS ciudad,
  COALESCE(tiempo_entrenando, '') AS tiempo_entrenando`;

/** Valida ficha mínima para aparecer en directorio (coach + analytics MétodoG). */
function validarEscaparateCoachPublicar(body, redesJson) {
  const faltantes = [];
  const nombre = String(body.nombre_completo ?? "").trim();
  const ciudad = String(body.ciudad ?? "").trim();
  const exp = String(body.tiempo_entrenando ?? "").trim();
  const edad = parseInt(body.edad, 10);
  const bio = String(body.bio ?? "").trim();
  const esp = String(body.especialidad ?? "").trim();
  if (nombre.length < 3) faltantes.push("nombre completo");
  if (!Number.isFinite(edad) || edad < 18 || edad > 99) faltantes.push("edad válida (18–99)");
  if (ciudad.length < 2) faltantes.push("ciudad");
  if (exp.length < 2) faltantes.push("tiempo entrenando");
  if (!esp) faltantes.push("especialidad");
  if (bio.length < 8) faltantes.push("bio");
  let redes = {};
  try {
    redes = JSON.parse(redesJson || "{}");
  } catch (_) { redes = {}; }
  if (!redes || typeof redes !== "object" || !Object.keys(redes).length) {
    faltantes.push("al menos una red social");
  }
  return faltantes;
}

/** SUPERADMIN — fila de revisión directorio. */
function mapCoachRevisionRow(row) {
  const bio = String(row.bio ?? "").trim();
  const especialidad = String(row.especialidad ?? "").trim();
  const logros = String(row.logros ?? "").trim();
  const whatsapp = String(row.whatsapp ?? "").trim();
  const fotoUrl = String(row.foto_url ?? "").trim();
  const nombreCompleto = String(row.nombre_completo ?? "").trim();
  const ciudad = String(row.ciudad ?? "").trim();
  const tiempoEntrenando = String(row.tiempo_entrenando ?? "").trim();
  const edad = row.edad != null && row.edad !== "" ? Number(row.edad) : null;
  const tarifaBase = row.tarifa_base != null && row.tarifa_base !== "" ? Number(row.tarifa_base) : null;
  let redesCount = 0;
  try {
    const r = JSON.parse(String(row.redes_sociales || "{}"));
    if (r && typeof r === "object") redesCount = Object.keys(r).length;
  } catch (_) { /* ignore */ }
  const perfilPublicado = !!(
    nombreCompleto.length >= 3
    && edad != null && edad >= 18
    && ciudad.length >= 2
    && tiempoEntrenando.length >= 2
    && especialidad
    && bio.length >= 8
    && redesCount >= 1
  );

  return {
    id: Number(row.id),
    nombre: row.nombre,
    nombre_completo: nombreCompleto,
    email: row.email,
    edad,
    ciudad,
    tiempo_entrenando: tiempoEntrenando,
    calificacion: row.calificacion,
    codigo_invitacion: row.codigo_invitacion,
    foto_url: fotoUrl,
    bio,
    especialidad,
    logros,
    tarifa_base: tarifaBase,
    whatsapp,
    redes_sociales: row.redes_sociales || "{}",
    verificado: !!Number(row.verificado),
    visible_en_directorio: !!Number(row.visible_en_directorio ?? 1),
    sub_status: row.sub_status || null,
    sub_plan: row.sub_plan || null,
    perfil_publicado: perfilPublicado
  };
}

app.get("/api/directorio/mi-perfil/:usuario_id", async (req, res) => {
  if (parseInt(req.params.usuario_id, 10) !== parseInt(req.user.id, 10)) {
    return res.status(403).json({ error: "Solo puedes ver tu perfil de coach" });
  }
  try {
    const userRes = await db.execute({
      sql: "SELECT id, nombre, email, rol, calificacion, codigo_invitacion FROM usuarios WHERE id = ?",
      args: [req.params.usuario_id]
    });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    const user = userRes.rows[0];
    if (user.rol !== 'COACH' && user.rol !== 'SUPERADMIN') {
      return res.status(403).json({ error: "Solo coaches pueden tener perfil público" });
    }
    const perfilRes = await db.execute({
      sql: `SELECT ${PERFIL_COACH_SELECT}
            FROM perfiles_coach_publicos WHERE usuario_id = ?`,
      args: [req.params.usuario_id]
    });
    const subRes = await db.execute({
      sql: "SELECT status, plan FROM suscripciones_coach WHERE usuario_id = ?",
      args: [req.params.usuario_id]
    });
    const perfil = perfilRes.rows[0] || {
      foto_url: '', bio: '', especialidad: '', logros: '', tarifa_base: null, whatsapp: '',
      visible_en_directorio: 1, verificado: 0, redes_sociales: '{}',
      nombre_completo: '', edad: null, ciudad: '', tiempo_entrenando: ''
    };
    res.json({
      usuario: user,
      perfil,
      suscripcion: subRes.rows[0] || null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/directorio/guardar-perfil", async (req, res) => {
  const {
    usuario_id, foto_url, bio, especialidad, logros, tarifa_base, whatsapp, visible_en_directorio,
    redes_sociales, nombre_completo, edad, ciudad, tiempo_entrenando
  } = req.body;
  if (!usuario_id) return res.status(400).json({ error: "usuario_id requerido" });
  if (parseInt(usuario_id, 10) !== parseInt(req.user.id, 10)) {
    return res.status(403).json({ error: "Solo puedes editar tu perfil público" });
  }
  const fotoRaw = String(foto_url || '');
  if (fotoRaw.length > 500_000) {
    return res.status(400).json({ error: "La foto es demasiado pesada. Usa otra imagen más ligera." });
  }
  try {
    const userRes = await db.execute({
      sql: "SELECT rol, nombre FROM usuarios WHERE id = ?",
      args: [usuario_id]
    });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    const rol = userRes.rows[0].rol;
    const coachNombre = userRes.rows[0].nombre || '';
    if (rol !== 'COACH' && rol !== 'SUPERADMIN') {
      return res.status(403).json({ error: "Solo coaches pueden guardar perfil público" });
    }

    const subRes = await db.execute({
      sql: "SELECT status, plan FROM suscripciones_coach WHERE usuario_id = ?",
      args: [usuario_id]
    });
    const subStatus = subRes.rows[0]?.status || null;
    const quiereVisible = !(visible_en_directorio === false || visible_en_directorio === 0);

    let redesJson = '{}';
    if (redes_sociales != null) {
      if (typeof redes_sociales === 'string') {
        try {
          const p = JSON.parse(redes_sociales);
          redesJson = JSON.stringify(p && typeof p === 'object' ? p : {});
        } catch {
          redesJson = '{}';
        }
      } else if (typeof redes_sociales === 'object') {
        redesJson = JSON.stringify(redes_sociales);
      }
    }

    if (quiereVisible) {
      const faltantes = validarEscaparateCoachPublicar(
        { nombre_completo, edad, ciudad, tiempo_entrenando, bio, especialidad },
        redesJson
      );
      if (faltantes.length) {
        return res.status(400).json({
          error: `Completa tu ficha para publicar: ${faltantes.join(', ')}.`
        });
      }
    }

    const puedePublicar = rol === 'SUPERADMIN' || subStatus === 'active';
    const verificadoAuto = quiereVisible && puedePublicar ? 1 : 0;

    const edadNum = edad != null && edad !== '' ? parseInt(edad, 10) : null;
    const edadFinal = Number.isFinite(edadNum) ? edadNum : null;

    await db.execute({
      sql: `INSERT INTO perfiles_coach_publicos (
              usuario_id, foto_url, bio, especialidad, logros, tarifa_base, whatsapp,
              visible_en_directorio, verificado, redes_sociales,
              nombre_completo, edad, ciudad, tiempo_entrenando
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(usuario_id) DO UPDATE SET
              foto_url = excluded.foto_url,
              bio = excluded.bio,
              especialidad = excluded.especialidad,
              logros = excluded.logros,
              tarifa_base = excluded.tarifa_base,
              whatsapp = excluded.whatsapp,
              visible_en_directorio = excluded.visible_en_directorio,
              verificado = excluded.verificado,
              redes_sociales = excluded.redes_sociales,
              nombre_completo = excluded.nombre_completo,
              edad = excluded.edad,
              ciudad = excluded.ciudad,
              tiempo_entrenando = excluded.tiempo_entrenando`,
      args: [
        usuario_id,
        fotoRaw,
        bio || '',
        especialidad || '',
        logros || '',
        tarifa_base != null && tarifa_base !== '' ? parseFloat(tarifa_base) : null,
        whatsapp || '',
        quiereVisible ? 1 : 0,
        verificadoAuto,
        redesJson,
        String(nombre_completo || '').trim(),
        edadFinal,
        String(ciudad || '').trim(),
        String(tiempo_entrenando || '').trim()
      ]
    });
    const perfilGuardado = await db.execute({
      sql: `SELECT ${PERFIL_COACH_SELECT}
            FROM perfiles_coach_publicos WHERE usuario_id = ?`,
      args: [usuario_id]
    });

    let mensaje = 'Perfil guardado correctamente.';
    if (quiereVisible && verificadoAuto) {
      mensaje = 'Perfil publicado con éxito. Ya eres visible en el directorio de coaches.';
    } else if (quiereVisible && subStatus === 'trialing') {
      mensaje = 'Perfil guardado. Activa tu suscripción de pago (no trial) para aparecer en el directorio público.';
    } else if (quiereVisible && !puedePublicar) {
      mensaje = 'Perfil guardado. Activa tu suscripción Coach PRO para publicarte en el directorio.';
    } else if (!quiereVisible) {
      mensaje = 'Perfil actualizado. No apareces en el directorio mientras la casilla esté desmarcada.';
    }

    const debeNotificarAdmin =
      quiereVisible && (subStatus === 'active' || subStatus === 'trialing');

    if (debeNotificarAdmin) {
      try {
        await notificarSuperadminsEscaparateCoach(db, {
          coachId: usuario_id,
          coachNombre,
          publicado: !!verificadoAuto,
          resend
        });
      } catch (notifErr) {
        console.warn('Notificación SUPERADMIN escaparate:', notifErr.message);
      }
    }

    res.json({
      mensaje,
      perfil: perfilGuardado.rows[0] || null,
      publicado: !!verificadoAuto
    });
  } catch (err) {
    console.error("Error guardar perfil coach:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/directorio/admin/revision", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const result = await db.execute(`
      SELECT u.id, u.nombre, u.email, u.calificacion, u.codigo_invitacion,
        p.foto_url, p.bio, p.especialidad, p.logros, p.tarifa_base, p.whatsapp,
        COALESCE(p.verificado, 0) AS verificado,
        COALESCE(p.visible_en_directorio, 1) AS visible_en_directorio,
        COALESCE(p.redes_sociales, '{}') AS redes_sociales,
        COALESCE(p.nombre_completo, '') AS nombre_completo,
        p.edad, COALESCE(p.ciudad, '') AS ciudad,
        COALESCE(p.tiempo_entrenando, '') AS tiempo_entrenando,
        s.status AS sub_status, s.plan AS sub_plan
      FROM usuarios u
      INNER JOIN suscripciones_coach s ON s.usuario_id = u.id
      LEFT JOIN perfiles_coach_publicos p ON p.usuario_id = u.id
      WHERE u.rol = 'COACH'
        AND s.status IN ('active', 'trialing')
      ORDER BY COALESCE(p.verificado, 0) ASC, u.nombre ASC
    `);
    res.json((result.rows || []).map(mapCoachRevisionRow));
  } catch (err) {
    console.error("Error admin revision directorio:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/directorio/admin/verificar", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;
  const { usuario_id, verificado, visible_en_directorio } = req.body || {};
  const uid = parseInt(usuario_id, 10);
  if (!uid || Number.isNaN(uid)) {
    return res.status(400).json({ error: "usuario_id requerido" });
  }

  const flagVerificado = verificado === true || verificado === 1 || verificado === "1" ? 1 : 0;
  let visibleFinal = 0;
  if (visible_en_directorio != null) {
    visibleFinal =
      visible_en_directorio === false || visible_en_directorio === 0 || visible_en_directorio === "0"
        ? 0
        : 1;
  } else {
    visibleFinal = flagVerificado ? 1 : 0;
  }

  try {
    const userRes = await db.execute({
      sql: "SELECT id, rol FROM usuarios WHERE id = ?",
      args: [uid]
    });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    if (userRes.rows[0].rol !== "COACH") {
      return res.status(400).json({ error: "Solo coaches pueden verificarse en el directorio" });
    }

    if (flagVerificado) {
      const subRes = await db.execute({
        sql: "SELECT status FROM suscripciones_coach WHERE usuario_id = ?",
        args: [uid]
      });
      if (subRes.rows[0]?.status !== "active") {
        return res.status(400).json({
          error: "El coach debe tener suscripción de pago activa (no trial) para aparecer en el directorio."
        });
      }
    }

    await db.execute({
      sql: `INSERT INTO perfiles_coach_publicos (usuario_id, visible_en_directorio, verificado)
            VALUES (?, 1, 0)
            ON CONFLICT(usuario_id) DO NOTHING`,
      args: [uid]
    });
    await db.execute({
      sql: `UPDATE perfiles_coach_publicos
            SET verificado = ?, visible_en_directorio = ?
            WHERE usuario_id = ?`,
      args: [flagVerificado, visibleFinal, uid]
    });

    const perfilRes = await db.execute({
      sql: `SELECT foto_url, bio, especialidad, logros, tarifa_base, whatsapp, verificado, visible_en_directorio
            FROM perfiles_coach_publicos WHERE usuario_id = ?`,
      args: [uid]
    });

    res.json({
      ok: true,
      usuario_id: uid,
      verificado: !!flagVerificado,
      visible_en_directorio: !!visibleFinal,
      perfil: perfilRes.rows[0] || null,
      mensaje: flagVerificado
        ? "Coach verificado — visible en el directorio público."
        : "Verificación revocada — ya no aparece en el catálogo."
    });
  } catch (err) {
    console.error("Error admin verificar coach:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/calificar", async (req, res) => {
  const { coach_id, cliente_id, estrellas } = req.body;
  if (parseInt(cliente_id, 10) !== parseInt(req.user.id, 10)) {
    return res.status(403).json({ error: "Solo puedes calificar como cliente" });
  }
  try {
    await db.execute({ sql: `INSERT INTO valoraciones (coach_id, cliente_id, estrellas) VALUES (?, ?, ?) ON CONFLICT(cliente_id) DO UPDATE SET estrellas = excluded.estrellas`, args: [coach_id, cliente_id, estrellas] });
    const avgRes = await db.execute({ sql: "SELECT AVG(estrellas) as promedio FROM valoraciones WHERE coach_id = ?", args: [coach_id] });
    const nuevoPromedio = avgRes.rows[0].promedio || 5.0;
    await db.execute({ sql: "UPDATE usuarios SET calificacion = ? WHERE id = ?", args: [nuevoPromedio, coach_id] });
    res.json({ mensaje: "Ok", calificacion: nuevoPromedio });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/registro", async (req, res) => {
  const { nombre, email, password, codigoIngresado } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  const emailLimpio = email.toLowerCase().trim();
  const rol = (emailLimpio === 'geovanni6aguilar9@gmail.com') ? 'SUPERADMIN' : 'CLIENTE';
  const query = `INSERT INTO usuarios (nombre, email, password, rol, codigo_invitacion, coach_id) VALUES (?, ?, ?, ?, ?, ?)`;
  
  try {
    if (codigoIngresado && codigoIngresado.trim() !== '') {
      const coachRes = await db.execute({
        sql: "SELECT id FROM usuarios WHERE codigo_invitacion = ?",
        args: [codigoIngresado.toUpperCase()]
      });
      if (coachRes.rows.length === 0) {
        return res.status(400).json({ error: "El código de Coach que ingresaste no es válido." });
      }
      const coachId = coachRes.rows[0].id;
      const sub = await evaluarSuscripcionCoach(db, coachId);
      if (!sub) {
        return res.status(400).json({
          error: "Este coach no tiene suscripción activa. No puedes registrarte con su código ahora."
        });
      }
      const countRes = await db.execute({
        sql: "SELECT COUNT(*) as count FROM usuarios WHERE coach_id = ?",
        args: [coachId]
      });
      const count = Number(countRes.rows[0]?.count || 0);
      if (sub.limite_efectivo && count >= Number(sub.limite_efectivo)) {
        return res.status(400).json({ error: "Este coach alcanzó su límite de alumnos." });
      }
      await db.execute({
        sql: query,
        args: [nombre, emailLimpio, hash, 'CLIENTE', null, coachId]
      });
      res.json({ mensaje: "Ok" });
    } else {
      await db.execute({ sql: query, args: [nombre, emailLimpio, hash, rol, (rol === 'SUPERADMIN' ? generarCodigo() : null), null] });
      res.json({ mensaje: "Ok" });
    }
  } catch (err) { 
    if (err.message.includes("UNIQUE constraint failed: usuarios.email")) {
      return res.status(400).json({ error: "Este correo ya está registrado. Por favor, inicia sesión." });
    }
    console.error("Error en registro:", err.message);
    res.status(500).json({ error: "Ocurrió un problema al crear tu cuenta. Intenta de nuevo." }); 
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const userRes = await db.execute({ sql: `SELECT * FROM usuarios WHERE email = ?`, args: [email.toLowerCase().trim()] });
    if (userRes.rows.length === 0) return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    const user = userRes.rows[0];
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    let usuario = sanitizeUsuario(user);
    usuario = await enrichUsuarioConSuscripcion(db, usuario);
    usuario = await enrichUsuarioVinculo(db, usuario);
    const token = signToken(usuario);
    res.json({ usuario, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const userRes = await db.execute({ sql: "SELECT * FROM usuarios WHERE id = ?", args: [req.user.id] });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    let usuario = sanitizeUsuario(userRes.rows[0]);
    usuario = await enrichUsuarioConSuscripcion(db, usuario);
    usuario = await enrichUsuarioVinculo(db, usuario);
    const payload = { usuario };
    if (usuario.rol !== req.user.rol) {
      payload.token = signToken(usuario);
    }
    res.json(payload);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/upgrade", async (req, res) => {
  if (isProduction() && req.user.rol !== "SUPERADMIN") {
    return res.status(403).json({
      error: "Conviértete en coach con una suscripción Coach PRO o el trial de 14 días."
    });
  }
  if (parseInt(req.body.usuario_id, 10) !== parseInt(req.user.id, 10)) {
    return res.status(403).json({ error: "Solo puedes actualizar tu propia cuenta" });
  }
  try {
    const check = await db.execute({
      sql: "SELECT coach_id FROM usuarios WHERE id = ?",
      args: [req.user.id]
    });
    if (check.rows[0]?.coach_id != null && check.rows[0]?.coach_id !== "") {
      return res.status(400).json({
        error: "Tienes un coach asignado. Desvincúlate en Ajustes → Mi Coach antes de convertirte en coach."
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  const cod = generarCodigo();
  try {
    const result = await db.execute({ sql: "UPDATE usuarios SET rol = 'COACH', codigo_invitacion = ? WHERE id = ?", args: [cod, req.user.id] });
    if ((result.rowsAffected ?? 0) === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ rol: "COACH", codigo_invitacion: cod });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/solicitar-recuperacion", async (req, res) => {
  const { email } = req.body;
  const emailLimpio = email.toLowerCase().trim();
  console.log(`🔎 1. Petición recibida para el correo: ${emailLimpio}`);

  try {
    const user = await db.execute({ sql: "SELECT nombre FROM usuarios WHERE email = ?", args: [emailLimpio] });
    if (user.rows.length === 0) {
        return res.status(404).json({ error: "Correo no registrado" });
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    await db.execute({ sql: `INSERT INTO recuperacion (email, codigo) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET codigo = excluded.codigo`, args: [emailLimpio, codigo] });

    const { data, error } = await resend.emails.send({
      from: 'MétodoG Soporte <onboarding@resend.dev>',
      to: emailLimpio,
      subject: "🛡️ Recuperación de Contraseña - MétodoG",
      html: `<h3>Hola ${user.rows[0].nombre},</h3><p>Tu código secreto para cambiar tu contraseña es: <b>${codigo}</b></p><p>Si no solicitaste este cambio, ignora este correo.</p>`
    });

    if (error) {
       console.error("🔥 ERROR DE LA API DE RESEND:", error);
       return res.status(500).json({ error: "No se pudo enviar el correo de recuperación." });
    }
    
    res.json({ mensaje: "Código enviado" });
  } catch (err) { 
    res.status(500).json({ error: "Error interno del servidor." }); 
  }
});

app.post("/api/cambiar-password", async (req, res) => {
  const { email, codigo, nuevaPassword } = req.body;
  const emailLimpio = email.toLowerCase().trim();
  try {
    const rec = await db.execute({ sql: "SELECT * FROM recuperacion WHERE email = ? AND codigo = ?", args: [emailLimpio, codigo] });
    if (rec.rows.length === 0) return res.status(400).json({ error: "Código incorrecto o caducado" });
    const creado = new Date(rec.rows[0].fecha).getTime();
    if (Number.isNaN(creado) || Date.now() - creado > 15 * 60 * 1000) {
      return res.status(400).json({ error: "Código caducado. Solicita uno nuevo." });
    }

    const hash = bcrypt.hashSync(nuevaPassword, 10);
    await db.execute({ sql: "UPDATE usuarios SET password = ? WHERE email = ?", args: [hash, emailLimpio] });
    await db.execute({ sql: "DELETE FROM recuperacion WHERE email = ?", args: [emailLimpio] });
    
    res.json({ mensaje: "Contraseña actualizada con éxito" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 MOTOR EN PUERTO ${PORT}`));