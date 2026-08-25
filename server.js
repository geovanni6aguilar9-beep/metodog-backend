require("dotenv").config({ quiet: true });
const path = require("path");
const express = require("express");
const cors = require("cors");
const { createClient } = require("@libsql/client");
const { wrapTursoClient, mensajeErrorDb } = require("./tursoRetry");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");
const {
  signToken,
  sanitizeUsuario,
  requireAuthMiddleware,
  assertAccesoUsuario,
  assertAccesoUsuarioEdicion,
  assertCoachSuscripcionActiva,
  assertCoachOAdmin,
  assertBibliotecaPersonal,
  resolverAccesoBibliotecaPersonal,
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
  notificarClientePlanActualizado
} = require("./notificaciones");
const { evaluarSuscripcionCoach } = require("./coachSuscripcion");
const { procesarRecordatoriosTrialCoach } = require("./trialRecordatorios");
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
const { generarOpinionInformeMensual, generarVeredictoMedidasIa } = require("./aiInforme");
const {
  fingerprintGrupos,
  leerInformeCache,
  guardarInformeCache,
  fingerprintMedidasVeredicto,
  ensureTablaVeredictosMedidasIa,
  leerVeredictoMedidasCache,
  guardarVeredictoMedidasCache
} = require("./informeIaCache");
const { buildResumenRutina } = require("./resumenRutinaInforme");
const { contextoMesInforme } = require("./informeMesContext");
const { seedAlimentosMetodog } = require("./seedAlimentos");
const { calcularSustitutos, SIN_SUSTITUTO } = require("./equivalenciasNutricion");
const {
  ensureTablaCuotaComboIa,
  estadoCuotaComboIa,
  reservarCuotaComboIa,
  liberarReservaCuotaComboIa,
  MAX_COMBOS_GRATIS
} = require("./comboIaCuota");
const {
  MAX_DIETAS_GRATIS,
  estadoCuotaDietaIa,
  reservarCuotaDietaIa,
  liberarReservaCuotaDietaIa
} = require("./dietaIaCuota");
const {
  MAX_IMPORT_PLAN_IA_GRATIS,
  estadoCuotaImportPlanIa,
  puedeIntentarImportPlanIa,
  consumirCuotaImportPlanIa
} = require("./importPlanIaCuota");
const {
  aplicarSustitutoEnDatosDieta,
  mapearAlimentoDesdeBiblioteca
} = require("./dietaSustituir");
const {
  ensureTablaFotosProgreso,
  listarFotosProgreso,
  crearFotoProgreso,
  borrarFotoProgreso
} = require("./fotosProgreso");
const {
  ensureTablaPlantillasRutinaCoach,
  listarPlantillasRutinaCoach,
  obtenerPlantillaRutinaCoach,
  crearPlantillaRutinaCoach,
  renombrarPlantillaRutinaCoach,
  borrarPlantillaRutinaCoach
} = require("./plantillasRutinaCoach");
const {
  ensureTablasPerfilSocial,
  obtenerYo: obtenerPerfilSocialYo,
  guardarYo: guardarPerfilSocialYo,
  guardarFoto: guardarFotoPerfilSocial,
  borrarFoto: borrarFotoPerfilSocial,
  agregarVitrina,
  borrarVitrina,
  listarEnlaces: listarEnlacesSocial,
  solicitar: solicitarPerfilSocial,
  responderSolicitud: responderSolicitudSocial,
  quitarCompanero,
  bloquearUsuario: bloquearUsuarioSocial,
  desbloquearUsuario: desbloquearUsuarioSocial,
  rankingCirculo,
  tarjetaPublica: tarjetaPerfilSocial,
  listarChats: listarChatsSocial,
  listarHilo: listarHiloSocial,
  enviarMensaje: enviarMensajeSocial,
  listarFeed: listarFeedSocial,
  crearPost: crearPostSocial,
  borrarPost: borrarPostSocial,
  listarMuro: listarMuroSocial,
  buscarPersonas: buscarPersonasSocial,
  toggleLikePost: toggleLikePostSocial,
  comentarPost: comentarPostSocial,
  borrarComentario: borrarComentarioSocial,
  borrarDatosSocialesUsuario
} = require("./perfilSocial");
const {
  importarAlimentosCsv,
  previewImportacionCsv,
  PLANTILLA_CSV,
  limpiarNombresInvalidosCoach,
  esNombreAlimentoValido
} = require("./importarAlimentos");
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
const { previewImportDietaIa, previewImportRutinaIa, previewImportDietaDesdeImagen, previewImportRutinaDesdeImagen } = require("./importarPlanIa");
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
const uploadImagenPlan = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype || "");
    cb(ok ? null : new Error("Solo JPG, PNG o WebP"), ok);
  }
});
const MAX_IMAGENES_IMPORT_PLAN = 6;

const DEV_JWT_FALLBACK = "metodog-dev-cambiar-en-produccion";
if (isProduction()) {
  const secret = (process.env.JWT_SECRET || "").trim();
  if (!secret || secret === DEV_JWT_FALLBACK || secret.length < 32) {
    console.error(
      "❌ JWT_SECRET ausente o débil en producción. Define un secreto aleatorio ≥32 caracteres en Render."
    );
  }
}

/** Emails fundador → rol SUPERADMIN (registro + auto-promoción en login). */
const SUPERADMIN_EMAILS = new Set([
  "geovanni6aguilar9@gmail.com",
  "aguilar6geovanni9@gmail.com"
]);

function esEmailSuperAdmin(email) {
  return SUPERADMIN_EMAILS.has(String(email || "").toLowerCase().trim());
}

/**
 * Si el correo está en allowlist y aún no es SUPERADMIN, lo promociona en Turso.
 * @returns {Promise<object>} fila usuario actualizada
 */
async function asegurarRolSuperAdminPorEmail(dbConn, userRow) {
  if (!userRow || !esEmailSuperAdmin(userRow.email)) return userRow;
  if (userRow.rol === "SUPERADMIN") return userRow;
  const codigo =
    userRow.codigo_invitacion && String(userRow.codigo_invitacion).trim()
      ? userRow.codigo_invitacion
      : Math.random().toString(36).substring(2, 8).toUpperCase();
  await dbConn.execute({
    sql: "UPDATE usuarios SET rol = 'SUPERADMIN', codigo_invitacion = ?, coach_id = NULL WHERE id = ?",
    args: [codigo, userRow.id]
  });
  return { ...userRow, rol: "SUPERADMIN", codigo_invitacion: codigo, coach_id: null };
}

const app = express();

app.post(
  "/api/pagos/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => handleStripeWebhook(req, res, db)
);

app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: "800kb" }));

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

const db = wrapTursoClient(crearClienteDB());

// 💌 CONFIGURACIÓN DEL CARTERO RESEND
const resend = new Resend(process.env.RESEND_API_KEY);
const { remiteResend } = require("./emailFrom");

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

    await db.execute(`CREATE TABLE IF NOT EXISTS sesiones_entrenamiento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      dia_rutina TEXT,
      duracion_seg INTEGER NOT NULL DEFAULT 0,
      volumen_kg REAL NOT NULL DEFAULT 0,
      series_completadas INTEGER NOT NULL DEFAULT 0,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_sesiones_ent_fecha ON sesiones_entrenamiento(fecha)`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_sesiones_ent_user ON sesiones_entrenamiento(usuario_id, fecha)`
    );

    /** 1 fila por usuario/día = “abrió la app” (login o ping con sesión). */
    await db.execute(`CREATE TABLE IF NOT EXISTS accesos_app (
      usuario_id INTEGER NOT NULL,
      dia TEXT NOT NULL,
      fuente TEXT NOT NULL DEFAULT 'ping',
      primera_vez DATETIME DEFAULT CURRENT_TIMESTAMP,
      ultima_vez DATETIME DEFAULT CURRENT_TIMESTAMP,
      hits INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (usuario_id, dia),
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_accesos_app_dia ON accesos_app(dia)`
    );

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

    await ensureTablaCuotaComboIa(db);
    await ensureTablaFotosProgreso(db);
    await ensureTablaPlantillasRutinaCoach(db);
    await ensureTablasPerfilSocial(db);
    await ensureTablaVeredictosMedidasIa(db);

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
/** Catálogo MétodoG (global) + biblioteca personal si coach / Full Week libre. */
app.get("/api/alimentos", async (req, res) => {
  try {
    let sql = "SELECT * FROM alimentos WHERE coach_id IS NULL";
    const args = [];
    if (req.user) {
      const acceso = await resolverAccesoBibliotecaPersonal(db, req.user);
      if (acceso.ok) {
        await limpiarNombresInvalidosCoach(db, acceso.ownerId);
        sql = "SELECT * FROM alimentos WHERE coach_id IS NULL OR coach_id = ?";
        args.push(acceso.ownerId);
      }
    }
    sql += " ORDER BY grupo, nombre ASC";
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/alimentos/plantilla-csv", async (req, res) => {
  if ((await assertBibliotecaPersonal(db, req, res)) == null) return;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="plantilla_alimentos_metodog.csv"'
  );
  res.send(`\uFEFF${PLANTILLA_CSV}`);
});

app.post("/api/alimentos/preview-import-csv", async (req, res) => {
  if ((await assertBibliotecaPersonal(db, req, res)) == null) return;
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
  if (raw.length > 50000) {
    return res.status(400).json({
      ok: false,
      error: "El texto es demasiado largo. Recorta el plan o usa un archivo más corto."
    });
  }
  try {
    const resultado = previewImportPlan(raw.slice(0, 50000), {
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
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: "Sesion requerida" });
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;

  const acceso = await resolverAccesoImportPlanIa(user.id, user.rol);
  if (!acceso.ok) {
    return res.status(403).json({
      ok: false,
      motivo: acceso.motivo || "sin_acceso",
      error: acceso.error || "Activa Full Week PRO para importar con IA.",
      restantes: acceso.restantes ?? 0
    });
  }

  if (!acceso.ilimitado) {
    const cupo = await puedeIntentarImportPlanIa(db, user.id);
    if (!cupo.ok) {
      return res.status(403).json({
        ok: false,
        motivo: "sin_cuota",
        error: "Ya usaste tus 3 importaciones IA de prueba. Activa Full Week PRO para continuar.",
        restantes: cupo.restantes ?? 0
      });
    }
  }

  const { texto, origen, tipo } = req.body || {};
  if (!texto || typeof texto !== "string") {
    return res.status(400).json({ error: "Envia el texto en el campo texto." });
  }
  if (texto.length > 50000) {
    return res.status(400).json({
      ok: false,
      error: "El texto es demasiado largo. Recorta el plan o usa un archivo más corto."
    });
  }
  try {
    const esPdf = origen === "pdf";
    const textoSafe = texto.slice(0, 50000);
    const resultado =
      tipo === "rutina"
        ? await previewImportRutinaIa(textoSafe, { origen: esPdf ? "pdf" : "texto" })
        : await previewImportDietaIa(textoSafe, { origen: esPdf ? "pdf" : "texto" });
    if (!resultado.ok) {
      return res.status(400).json(resultado);
    }
    let cuotaOut = { ilimitado: true, restantes: null };
    if (!acceso.ilimitado) {
      // Solo se cobra intento cuando Gemini devolvio plan OK (atómico; sin fuga en carrera)
      const cobro = await consumirCuotaImportPlanIa(db, user.id);
      if (!cobro.ok) {
        return res.status(403).json({
          ok: false,
          motivo: "sin_cuota",
          error: "Ya usaste tus 3 importaciones IA de prueba. Activa Full Week PRO para continuar.",
          restantes: cobro.restantes ?? 0
        });
      }
      cuotaOut = {
        ilimitado: false,
        restantes: cobro.restantes,
        max: cobro.max,
        usados: cobro.usados
      };
    }
    res.json({ ...resultado, cuota_import_ia: cuotaOut });
  } catch (err) {
    console.error("planes/preview-import-ia:", err.message);
    res.status(500).json({ error: err.message || "IA no disponible." });
  }
});

/** Captura/foto de dieta o rutina (modo libre + coaches) — misma cuota IA que preview-import-ia. */
app.post("/api/planes/preview-import-imagen", (req, res) => {
  uploadImagenPlan.array("imagenes", MAX_IMAGENES_IMPORT_PLAN)(req, res, async (errMulter) => {
    if (errMulter) {
      return res.status(400).json({
        ok: false,
        error: errMulter.message || "No se pudo leer la imagen (JPG, PNG o WebP, máx 8 MB)."
      });
    }
    const user = req.user;
    if (!user) return res.status(401).json({ ok: false, error: "Sesion requerida" });
    if (!(await assertCoachSuscripcionActiva(db, req, res))) return;

    const acceso = await resolverAccesoImportPlanIa(user.id, user.rol);
    if (!acceso.ok) {
      return res.status(403).json({
        ok: false,
        motivo: acceso.motivo || "sin_acceso",
        error: acceso.error || "Activa Full Week PRO para importar con IA.",
        restantes: acceso.restantes ?? 0
      });
    }

    if (!acceso.ilimitado) {
      const cupo = await puedeIntentarImportPlanIa(db, user.id);
      if (!cupo.ok) {
        return res.status(403).json({
          ok: false,
          motivo: "sin_cuota",
          error: "Ya usaste tus 3 importaciones IA de prueba. Activa Full Week PRO para continuar.",
          restantes: cupo.restantes ?? 0
        });
      }
    }

    const files = Array.isArray(req.files) ? req.files.filter((f) => f?.buffer?.length) : [];
    if (!files.length) {
      return res.status(400).json({
        ok: false,
        error: "Sube una o más imágenes en el campo «imagenes» (máx. 6)."
      });
    }
    const tipo = req.body?.tipo === "dieta" ? "dieta" : "rutina";
    const buffers = files.map((f) => f.buffer);

    try {
      const resultado =
        tipo === "dieta"
          ? await previewImportDietaDesdeImagen(buffers)
          : await previewImportRutinaDesdeImagen(buffers);
      if (!resultado.ok) return res.status(400).json(resultado);
      let cuotaOut = { ilimitado: true, restantes: null };
      if (!acceso.ilimitado) {
        const cobro = await consumirCuotaImportPlanIa(db, user.id);
        if (!cobro.ok) {
          return res.status(403).json({
            ok: false,
            motivo: "sin_cuota",
            error: "Ya usaste tus 3 importaciones IA de prueba. Activa Full Week PRO para continuar.",
            restantes: cobro.restantes ?? 0
          });
        }
        cuotaOut = {
          ilimitado: false,
          restantes: cobro.restantes,
          max: cobro.max,
          usados: cobro.usados
        };
      }
      res.json({ ...resultado, cuota_import_ia: cuotaOut });
    } catch (err) {
      console.error("planes/preview-import-imagen:", err.message);
      res.status(500).json({ ok: false, error: err.message || "IA no pudo leer la imagen." });
    }
  });
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
  const ownerId = await assertBibliotecaPersonal(db, req, res);
  if (ownerId == null) return;
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;
  const { csv, alcance, mapeo } = req.body || {};
  if (alcance === "global") {
    return res.status(403).json({
      error: "La biblioteca MétodoG no se puede modificar. Importa a tu biblioteca personal."
    });
  }
  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "Envía el contenido del archivo en el campo «csv»." });
  }
  try {
    const resultado = await importarAlimentosCsv(db, ownerId, csv, mapeo);
    if (!resultado.ok) {
      return res.status(400).json(resultado);
    }
    res.json(resultado);
  } catch (err) {
    console.error("importar-csv:", err.message);
    res.status(500).json({ error: err.message || "No se pudo importar el archivo." });
  }
});

function normalizarPayloadAlimento(body) {
  const nombre = String(body?.nombre || "").trim();
  if (nombre.length < 2) {
    return { error: "El nombre debe tener al menos 2 caracteres." };
  }
  if (!esNombreAlimentoValido(nombre)) {
    return { error: "Nombre de alimento inválido." };
  }
  return {
    nombre,
    grupo: String(body?.grupo || "Otros").trim() || "Otros",
    grupo_equivalencia: String(body?.grupo_equivalencia || "sin_sustituto").trim() || "sin_sustituto",
    porcion_base: parseFloat(body?.porcion_base) || 1,
    unidad: String(body?.unidad || "g").trim() || "g",
    calorias: parseFloat(body?.calorias) || 0,
    proteinas: parseFloat(body?.proteinas) || 0,
    carbohidratos: parseFloat(body?.carbohidratos) || 0,
    grasas: parseFloat(body?.grasas) || 0,
    sodio: parseFloat(body?.sodio) || 0
  };
}

/** Alta en biblioteca personal (nunca global MétodoG). */
app.post("/api/alimentos", async (req, res) => {
  const ownerId = await assertBibliotecaPersonal(db, req, res);
  if (ownerId == null) return;
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;
  const payload = normalizarPayloadAlimento(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });
  try {
    const result = await db.execute({
      sql: `INSERT INTO alimentos (
        nombre, grupo, grupo_equivalencia, porcion_base, unidad,
        calorias, proteinas, carbohidratos, grasas, sodio, coach_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        payload.nombre,
        payload.grupo,
        payload.grupo_equivalencia,
        payload.porcion_base,
        payload.unidad,
        payload.calorias,
        payload.proteinas,
        payload.carbohidratos,
        payload.grasas,
        payload.sodio,
        ownerId
      ]
    });
    const newId = Number(result.lastInsertRowid);
    if (!newId) {
      return res.status(500).json({ error: "No se pudo crear el alimento." });
    }
    const created = await db.execute({
      sql: "SELECT * FROM alimentos WHERE id = ? AND coach_id = ?",
      args: [newId, ownerId]
    });
    if (!created.rows[0]) {
      return res.status(500).json({ error: "Alimento creado pero no legible." });
    }
    res.status(201).json(created.rows[0]);
  } catch (err) {
    console.error("POST /api/alimentos:", err.message);
    res.status(500).json({ error: err.message || "No se pudo crear." });
  }
});

/** Editar solo ítems de la biblioteca personal del caller. Global = 403. */
app.put("/api/alimentos/:id", async (req, res) => {
  const ownerId = await assertBibliotecaPersonal(db, req, res);
  if (ownerId == null) return;
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: "ID inválido." });
  }
  const payload = normalizarPayloadAlimento(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });
  try {
    const cur = await db.execute({
      sql: "SELECT id, coach_id FROM alimentos WHERE id = ?",
      args: [id]
    });
    const row = cur.rows[0];
    if (!row) return res.status(404).json({ error: "Alimento no encontrado." });
    if (row.coach_id == null || row.coach_id === "") {
      return res.status(403).json({
        error: "La biblioteca MétodoG no se puede modificar."
      });
    }
    if (Number(row.coach_id) !== Number(ownerId)) {
      return res.status(403).json({ error: "Solo puedes editar tu biblioteca personal." });
    }
    const upd = await db.execute({
      sql: `UPDATE alimentos SET
        nombre = ?, grupo = ?, grupo_equivalencia = ?, porcion_base = ?, unidad = ?,
        calorias = ?, proteinas = ?, carbohidratos = ?, grasas = ?, sodio = ?
        WHERE id = ? AND coach_id = ?`,
      args: [
        payload.nombre,
        payload.grupo,
        payload.grupo_equivalencia,
        payload.porcion_base,
        payload.unidad,
        payload.calorias,
        payload.proteinas,
        payload.carbohidratos,
        payload.grasas,
        payload.sodio,
        id,
        ownerId
      ]
    });
    if (!upd.rowsAffected) {
      return res.status(500).json({ error: "No se actualizó el alimento." });
    }
    const fresh = await db.execute({
      sql: "SELECT * FROM alimentos WHERE id = ? AND coach_id = ?",
      args: [id, ownerId]
    });
    res.json(fresh.rows[0]);
  } catch (err) {
    console.error("PUT /api/alimentos/:id:", err.message);
    res.status(500).json({ error: err.message || "No se pudo guardar." });
  }
});

/** Borrar solo ítems propios. Global = 403. */
app.delete("/api/alimentos/:id", async (req, res) => {
  const ownerId = await assertBibliotecaPersonal(db, req, res);
  if (ownerId == null) return;
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: "ID inválido." });
  }
  try {
    const cur = await db.execute({
      sql: "SELECT id, coach_id FROM alimentos WHERE id = ?",
      args: [id]
    });
    const row = cur.rows[0];
    if (!row) return res.status(404).json({ error: "Alimento no encontrado." });
    if (row.coach_id == null || row.coach_id === "") {
      return res.status(403).json({
        error: "La biblioteca MétodoG no se puede modificar."
      });
    }
    if (Number(row.coach_id) !== Number(ownerId)) {
      return res.status(403).json({ error: "Solo puedes borrar tu biblioteca personal." });
    }
    const del = await db.execute({
      sql: "DELETE FROM alimentos WHERE id = ? AND coach_id = ?",
      args: [id, ownerId]
    });
    if (!del.rowsAffected) {
      return res.status(500).json({ error: "No se borró el alimento." });
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error("DELETE /api/alimentos/:id:", err.message);
    res.status(500).json({ error: err.message || "No se pudo borrar." });
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

/**
 * Combo IA:
 * - COACH/SUPERADMIN: sí (sujeto a suscripción coach en la ruta)
 * - CLIENTE Full Week: ilimitado
 * - CLIENTE con coach_id: no (el plan es del coach)
 * - CLIENTE libre: cuota Turso freemium
 */
async function resolverAccesoComboIa(userId, rol) {
  if (rol === "SUPERADMIN" || rol === "COACH") {
    return { ok: true, ilimitado: true, restantes: null };
  }
  if (rol !== "CLIENTE") {
    return { ok: false, motivo: "rol", error: "No autorizado para Combo IA." };
  }
  const uid = parseInt(userId, 10);
  const r = await db.execute({
    sql: "SELECT coach_id, paquete_rutina_6_dias FROM usuarios WHERE id = ?",
    args: [uid]
  });
  const row = r.rows[0];
  if (!row) {
    return { ok: false, motivo: "usuario", error: "Usuario no encontrado." };
  }
  if (row.paquete_rutina_6_dias) {
    return { ok: true, ilimitado: true, restantes: null };
  }
  const coachId = row.coach_id != null && row.coach_id !== "" ? Number(row.coach_id) : null;
  if (coachId && !Number.isNaN(coachId) && coachId > 0) {
    return {
      ok: false,
      motivo: "plan_coach",
      error: "Tu dieta la gestiona tu coach. El Combo IA libre no aplica aquí."
    };
  }
  const cuota = await estadoCuotaComboIa(db, uid);
  if (cuota.restantes <= 0) {
    return {
      ok: false,
      motivo: "sin_cuota",
      error: "Ya usaste tus 3 combos de prueba. Activa Full Week PRO para continuar.",
      restantes: 0,
      max: cuota.max
    };
  }
  return { ok: true, ilimitado: false, restantes: cuota.restantes, max: cuota.max };
}


/**
 * Armar dia con IA:
 * - COACH/SUPERADMIN / Full Week: ilimitado
 * - CLIENTE con coach: no
 * - CLIENTE libre: 1 intento Turso (beta)
 */

/**
 * Import plan con IA (PDF/texto):
 * - COACH/SUPERADMIN: ilimitado (sujeto a suscripcion coach en ruta)
 * - CLIENTE Full Week: ilimitado
 * - CLIENTE con coach: no
 * - CLIENTE libre: 3 intentos Turso (carril import)
 */
async function resolverAccesoImportPlanIa(userId, rol) {
  if (rol === "SUPERADMIN" || rol === "COACH") {
    return { ok: true, ilimitado: true, restantes: null };
  }
  if (rol !== "CLIENTE") {
    return { ok: false, motivo: "rol", error: "No autorizado para importar con IA." };
  }
  const uid = parseInt(userId, 10);
  const r = await db.execute({
    sql: "SELECT coach_id, paquete_rutina_6_dias FROM usuarios WHERE id = ?",
    args: [uid]
  });
  const row = r.rows[0];
  if (!row) {
    return { ok: false, motivo: "usuario", error: "Usuario no encontrado." };
  }
  if (row.paquete_rutina_6_dias) {
    return { ok: true, ilimitado: true, restantes: null };
  }
  const coachId = row.coach_id != null && row.coach_id !== "" ? Number(row.coach_id) : null;
  if (coachId && !Number.isNaN(coachId) && coachId > 0) {
    return {
      ok: false,
      motivo: "plan_coach",
      error: "Tu rutina la gestiona tu coach. La importacion IA libre no aplica aqui."
    };
  }
  const cuota = await estadoCuotaImportPlanIa(db, uid);
  if (cuota.restantes <= 0) {
    return {
      ok: false,
      motivo: "sin_cuota",
      error: "Ya usaste tus 3 importaciones IA de prueba. Activa Full Week PRO para continuar.",
      restantes: 0,
      max: cuota.max
    };
  }
  return { ok: true, ilimitado: false, restantes: cuota.restantes, max: cuota.max };
}
async function resolverAccesoDietaIa(userId, rol) {
  if (rol === "SUPERADMIN" || rol === "COACH") {
    return { ok: true, ilimitado: true, restantes: null };
  }
  if (rol !== "CLIENTE") {
    return { ok: false, motivo: "rol", error: "No autorizado para plan IA." };
  }
  const uid = parseInt(userId, 10);
  const r = await db.execute({
    sql: "SELECT coach_id, paquete_rutina_6_dias FROM usuarios WHERE id = ?",
    args: [uid]
  });
  const row = r.rows[0];
  if (!row) {
    return { ok: false, motivo: "usuario", error: "Usuario no encontrado." };
  }
  if (row.paquete_rutina_6_dias) {
    return { ok: true, ilimitado: true, restantes: null };
  }
  const coachId = row.coach_id != null && row.coach_id !== "" ? Number(row.coach_id) : null;
  if (coachId && !Number.isNaN(coachId) && coachId > 0) {
    return {
      ok: false,
      motivo: "plan_coach",
      error: "Tu dieta la gestiona tu coach. El planificador IA libre no aplica aquí."
    };
  }
  const cuota = await estadoCuotaDietaIa(db, uid);
  if (cuota.restantes <= 0) {
    return {
      ok: false,
      motivo: "sin_cuota",
      error: "Ya usaste tu prueba de Armar dia con IA. Activa Full Week PRO para continuar.",
      restantes: 0,
      max: cuota.max
    };
  }
  return { ok: true, ilimitado: false, restantes: cuota.restantes, max: cuota.max };
}
function coachIdParaCatalogoIa(user) {
  if (!user || (user.rol !== "COACH" && user.rol !== "SUPERADMIN")) return null;
  const id = parseInt(user.id, 10);
  return Number.isNaN(id) || id <= 0 ? null : id;
}

app.get("/api/alimentos/receta-ia/cuota", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: "Sesión requerida" });
  if (user.rol === "SUPERADMIN" || user.rol === "COACH") {
    return res.json({ ok: true, ilimitado: true, restantes: null, max: MAX_COMBOS_GRATIS });
  }
  if (user.rol !== "CLIENTE") {
    return res.status(403).json({ ok: false, error: "No autorizado" });
  }
  try {
    const acceso = await resolverAccesoComboIa(user.id, user.rol);
    if (acceso.ilimitado) {
      return res.json({ ok: true, ilimitado: true, restantes: null, max: MAX_COMBOS_GRATIS });
    }
    if (acceso.motivo === "plan_coach") {
      return res.json({
        ok: true,
        ilimitado: false,
        restantes: 0,
        max: MAX_COMBOS_GRATIS,
        plan_coach: true
      });
    }
    const cuota = await estadoCuotaComboIa(db, user.id);
    return res.json({
      ok: true,
      ilimitado: false,
      restantes: cuota.restantes,
      max: cuota.max,
      usados: cuota.usados
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

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
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;

  const acceso = await resolverAccesoComboIa(user.id, user.rol);
  if (!acceso.ok) {
    return res.status(403).json({
      ok: false,
      motivo: acceso.motivo || "sin_acceso",
      error: acceso.error || "Activa Full Week PRO para usar recetas con IA.",
      restantes: acceso.restantes ?? 0
    });
  }

  let reservado = false;
  if (!acceso.ilimitado) {
    const reserva = await reservarCuotaComboIa(db, user.id);
    if (!reserva.ok) {
      return res.status(403).json({
        ok: false,
        motivo: "sin_cuota",
        error: "Ya usaste tus 3 combos de prueba. Activa Full Week PRO para continuar.",
        restantes: reserva.restantes ?? 0
      });
    }
    reservado = true;
  }

  const payload = req.body || {};
  const iaOpts = { coachId: coachIdParaCatalogoIa(user) };
  try {
    const resultado = await generarRecetaComida(payload, db, iaOpts);
    if (!resultado.ok) {
      if (reservado) await liberarReservaCuotaComboIa(db, user.id);
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
    let cuotaOut = { ilimitado: true, restantes: null };
    if (!acceso.ilimitado) {
      const est = await estadoCuotaComboIa(db, user.id);
      cuotaOut = { ilimitado: false, restantes: est.restantes, max: est.max, usados: est.usados };
    }
    res.json({ ...resultado, cuota_combo: cuotaOut });
  } catch (err) {
    if (reservado) await liberarReservaCuotaComboIa(db, user.id);
    console.error("receta-ia:", err.message);
    res.status(500).json({
      ok: false,
      error: mensajeErrorAmigable("api_error")
    });
  }
});


app.get("/api/alimentos/dieta-ia/cuota", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: "Sesión requerida" });
  if (user.rol === "SUPERADMIN" || user.rol === "COACH") {
    return res.json({ ok: true, ilimitado: true, restantes: null, max: MAX_DIETAS_GRATIS });
  }
  if (user.rol !== "CLIENTE") {
    return res.status(403).json({ ok: false, error: "No autorizado" });
  }
  try {
    const acceso = await resolverAccesoDietaIa(user.id, user.rol);
    if (acceso.ilimitado) {
      return res.json({ ok: true, ilimitado: true, restantes: null, max: MAX_DIETAS_GRATIS });
    }
    if (acceso.motivo === "plan_coach") {
      return res.json({
        ok: true,
        ilimitado: false,
        restantes: 0,
        max: MAX_DIETAS_GRATIS,
        plan_coach: true
      });
    }
    const cuota = await estadoCuotaDietaIa(db, user.id);
    return res.json({
      ok: true,
      ilimitado: false,
      restantes: cuota.restantes,
      max: cuota.max,
      usados: cuota.usados
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
app.post("/api/alimentos/dieta-ia", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: "Sesión requerida" });
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;

  console.log("========================================");
  console.log(`[MetodoG] Pipeline 4.7-PromptElite ACTIVA — POST /api/alimentos/dieta-ia`, new Date().toISOString());
  console.log("========================================");

  const acceso = await resolverAccesoDietaIa(user.id, user.rol);
  if (!acceso.ok) {
    return res.status(403).json({
      ok: false,
      motivo: acceso.motivo || "sin_acceso",
      error: acceso.error || "Activa Full Week PRO para usar el planificador IA.",
      restantes: acceso.restantes ?? 0
    });
  }

  let reservado = false;
  if (!acceso.ilimitado) {
    const reserva = await reservarCuotaDietaIa(db, user.id);
    if (!reserva.ok) {
      return res.status(403).json({
        ok: false,
        motivo: "sin_cuota",
        error: "Ya usaste tu prueba de Armar dia con IA. Activa Full Week PRO para continuar.",
        restantes: reserva.restantes ?? 0
      });
    }
    reservado = true;
  }

  const payload = req.body || {};
  const iaOpts = { coachId: coachIdParaCatalogoIa(user) };
  try {
    const resultado = await generarDietaDiaCompleta(payload, db, iaOpts);
    if (!resultado.ok) {
      if (reservado) await liberarReservaCuotaDietaIa(db, user.id);
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
    let cuotaOut = { ilimitado: true, restantes: null };
    if (!acceso.ilimitado) {
      const est = await estadoCuotaDietaIa(db, user.id);
      cuotaOut = { ilimitado: false, restantes: est.restantes, max: est.max, usados: est.usados };
    }
    res.json({ ...resultado, cuota_dieta: cuotaOut });
  } catch (err) {
    if (reservado) await liberarReservaCuotaDietaIa(db, user.id);
    console.error("dieta-ia:", err.message);
    res.status(500).json({
      ok: false,
      error: mensajeErrorAmigable("api_error")
    });
  }
});

/** Normaliza nombres de plan vs biblioteca (s/azúcar ↔ sin azúcar, acentos). */
function normNombreAlimento(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/s\/\s*azucar/g, "sin azucar")
    .replace(/\bsin\s+azucar\b/g, "sin azucar")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens útiles; ignora relleno tipo "natural" (plan Leonardo vs seed). */
function tokensNombreAlimento(s) {
  const stop = new Set(["de", "y", "con", "en", "el", "la", "los", "las", "natural"]);
  return normNombreAlimento(s)
    .split(" ")
    .filter((t) => t && !stop.has(t));
}

function nombresAlimentoCompatibles(a, b) {
  const ta = tokensNombreAlimento(a);
  const tb = tokensNombreAlimento(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const [short, longSet] =
    ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return short.every((t) => longSet.has(t));
}

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
    }
    // Si el id del plan está desfasado o es custom, cae a nombre (exacto + normalizado + tokens).
    if (!alimento && nombre) {
      const nombreTrim = String(nombre).trim();
      const rExact = await db.execute({
        sql: "SELECT * FROM alimentos WHERE LOWER(nombre) = LOWER(?) LIMIT 1",
        args: [nombreTrim]
      });
      alimento = rExact.rows[0];
      if (!alimento) {
        const clave = normNombreAlimento(nombreTrim);
        if (clave) {
          const bib = await db.execute("SELECT * FROM alimentos");
          const rows = bib.rows || [];
          alimento = rows.find((a) => normNombreAlimento(a.nombre) === clave) || null;
          if (!alimento) {
            alimento = rows.find((a) => nombresAlimentoCompatibles(nombreTrim, a.nombre)) || null;
          }
        }
      }
    }
    if (!alimento) {
      return res.status(404).json({
        ok: false,
        error: "alimento_no_encontrado",
        mensaje: "Ese alimento no está en la biblioteca MétodoG. Avísale a tu coach para mapearlo."
      });
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

/** Plantillas de rutina del coach (semana + notas) — solo COACH/SUPERADMIN. */
app.get("/api/coach/plantillas-rutina", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  try {
    const plantillas = await listarPlantillasRutinaCoach(db, parseInt(req.user.id, 10));
    res.json({ plantillas });
  } catch (err) {
    console.error("GET plantillas-rutina:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/coach/plantillas-rutina/:id", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "ID inválido." });
  try {
    const plantilla = await obtenerPlantillaRutinaCoach(db, parseInt(req.user.id, 10), id);
    if (!plantilla) return res.status(404).json({ error: "Plantilla no encontrada." });
    res.json({ plantilla });
  } catch (err) {
    console.error("GET plantillas-rutina/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/coach/plantillas-rutina", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;
  try {
    const result = await crearPlantillaRutinaCoach(db, parseInt(req.user.id, 10), req.body || {});
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, plantilla: result.plantilla });
  } catch (err) {
    console.error("POST plantillas-rutina:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/coach/plantillas-rutina/:id", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "ID inválido." });
  try {
    const result = await renombrarPlantillaRutinaCoach(
      db,
      parseInt(req.user.id, 10),
      id,
      req.body?.nombre
    );
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, plantilla: result.plantilla });
  } catch (err) {
    console.error("PUT plantillas-rutina/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/coach/plantillas-rutina/:id", async (req, res) => {
  if (!(await assertCoachOAdmin(db, req, res))) return;
  if (!(await assertCoachSuscripcionActiva(db, req, res))) return;
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "ID inválido." });
  try {
    const result = await borrarPlantillaRutinaCoach(db, parseInt(req.user.id, 10), id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, id: result.id });
  } catch (err) {
    console.error("DELETE plantillas-rutina/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

function responderPerfilSocial(res, result, extra = {}) {
  if (!result?.ok) {
    return res.status(result?.status || 400).json({ error: result?.error || "No se pudo completar." });
  }
  return res.json({ ok: true, ...result, ...extra, error: undefined, status: undefined });
}

app.get("/api/social/yo", async (req, res) => {
  try {
    const result = await obtenerPerfilSocialYo(db, req.user, req.user.nombre);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("GET social/yo:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/social/yo", async (req, res) => {
  try {
    const result = await guardarPerfilSocialYo(db, req.user, req.body || {});
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("PUT social/yo:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/yo/foto", async (req, res) => {
  try {
    const result = await guardarFotoPerfilSocial(db, req.user, req.body?.foto);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/yo/foto:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/social/yo/foto", async (req, res) => {
  try {
    const result = await borrarFotoPerfilSocial(db, req.user);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("DELETE social/yo/foto:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/vitrina", async (req, res) => {
  try {
    const result = await agregarVitrina(db, req.user, req.body?.foto);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/vitrina:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/social/vitrina/:id", async (req, res) => {
  try {
    const result = await borrarVitrina(db, req.user, req.params.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("DELETE social/vitrina:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/social/enlaces", async (req, res) => {
  try {
    const result = await listarEnlacesSocial(db, req.user.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("GET social/enlaces:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/solicitar", async (req, res) => {
  try {
    const result = await solicitarPerfilSocial(db, req.user, req.body || {});
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/solicitar:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/solicitud/:id/aceptar", async (req, res) => {
  try {
    const result = await responderSolicitudSocial(db, req.user, req.params.id, true);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/aceptar:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/solicitud/:id/rechazar", async (req, res) => {
  try {
    const result = await responderSolicitudSocial(db, req.user, req.params.id, false);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/rechazar:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/enlace/:id/quitar", async (req, res) => {
  try {
    const result = await quitarCompanero(db, req.user, req.params.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/quitar:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/enlace/:id/bloquear", async (req, res) => {
  try {
    const result = await bloquearUsuarioSocial(db, req.user, req.params.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/bloquear:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/enlace/:id/desbloquear", async (req, res) => {
  try {
    const result = await desbloquearUsuarioSocial(db, req.user, req.params.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/desbloquear:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/social/ranking", async (req, res) => {
  try {
    const result = await rankingCirculo(db, req.user);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("GET social/ranking:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/social/tarjeta/:id", async (req, res) => {
  try {
    const result = await tarjetaPerfilSocial(db, req.user, req.params.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("GET social/tarjeta:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/social/chats", async (req, res) => {
  try {
    const result = await listarChatsSocial(db, req.user);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("GET social/chats:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/social/chat/:id", async (req, res) => {
  try {
    const result = await listarHiloSocial(db, req.user, req.params.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("GET social/chat:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/chat/:id", async (req, res) => {
  try {
    const result = await enviarMensajeSocial(db, req.user, req.params.id, req.body?.texto);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/chat:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/social/feed", async (req, res) => {
  try {
    const result = await listarFeedSocial(db, req.user);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("GET social/feed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/feed", async (req, res) => {
  try {
    const result = await crearPostSocial(db, req.user, req.body || {});
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/feed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/social/feed/:id", async (req, res) => {
  try {
    const result = await borrarPostSocial(db, req.user, req.params.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("DELETE social/feed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/social/muro", async (req, res) => {
  try {
    const result = await listarMuroSocial(db, req.user);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("GET social/muro:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/social/buscar", async (req, res) => {
  try {
    const result = await buscarPersonasSocial(db, req.user, req.query?.q);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("GET social/buscar:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/muro/:id/like", async (req, res) => {
  try {
    const result = await toggleLikePostSocial(db, req.user, req.params.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/muro/like:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/social/muro/:id/comentario", async (req, res) => {
  try {
    const result = await comentarPostSocial(db, req.user, req.params.id, req.body?.texto);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("POST social/muro/comentario:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/social/comentario/:id", async (req, res) => {
  try {
    const result = await borrarComentarioSocial(db, req.user, req.params.id);
    return responderPerfilSocial(res, result);
  } catch (err) {
    console.error("DELETE social/comentario:", err.message);
    res.status(500).json({ error: err.message });
  }
});

function parseMacrosTotalesJson(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Si el coach/atleta guarda plan sin adherenciaDia, no borrar el checklist del día. */
function mergeMacrosPreservandoAdherencia(prevRaw, incoming) {
  const prev = parseMacrosTotalesJson(prevRaw);
  const base =
    incoming && typeof incoming === "object" && !Array.isArray(incoming)
      ? { ...incoming }
      : {};
  if (!base.adherenciaDia && prev?.adherenciaDia) {
    base.adherenciaDia = prev.adherenciaDia;
    if (base.consumido == null && prev.consumido != null) {
      base.consumido = prev.consumido;
    }
  }
  return base;
}

app.post("/api/dietas/guardar", async (req, res) => {
  const { usuario_id, datos_dieta, macros_totales, notas_dieta, notificar } = req.body;
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;

  // Blindaje A: CLIENTE con coach no puede reescribir su dieta por este endpoint.
  try {
    const tid = parseInt(usuario_id, 10);
    const aid = parseInt(req.user.id, 10);
    if (req.user.rol === "CLIENTE" && tid === aid) {
      const u = await db.execute({
        sql: "SELECT coach_id FROM usuarios WHERE id = ?",
        args: [aid]
      });
      const coachRaw = u.rows[0]?.coach_id;
      const coachId = coachRaw != null && coachRaw !== "" ? Number(coachRaw) : null;
      if (coachId && !Number.isNaN(coachId) && coachId > 0) {
        return res.status(403).json({
          error: "Tu plan lo administra tu coach. No puedes sobrescribir la dieta completa. Usa Sustituir (Full Week PRO) para un intercambio puntual.",
          codigo: "dieta_solo_coach",
          ruta_alternativa: "/api/dietas/sustituir"
        });
      }
    }
  } catch (err) {
    console.error("dietas/guardar guardrail:", err.message);
    return res.status(503).json({
      error: mensajeErrorDb(err, "No se pudo validar el acceso a la dieta."),
      codigo: "db_temporal"
    });
  }

  try {
    const prevRes = await db.execute({
      sql: "SELECT macros_totales FROM dietas WHERE usuario_id = ?",
      args: [usuario_id]
    });
    const macrosMerged = mergeMacrosPreservandoAdherencia(
      prevRes.rows[0]?.macros_totales,
      macros_totales
    );
    await db.execute({
      sql: `INSERT INTO dietas (usuario_id, datos_dieta, macros_totales, notas_dieta) VALUES (?, ?, ?, ?) ON CONFLICT(usuario_id) DO UPDATE SET datos_dieta = excluded.datos_dieta, macros_totales = excluded.macros_totales, notas_dieta = excluded.notas_dieta`,
      args: [usuario_id, JSON.stringify(datos_dieta), JSON.stringify(macrosMerged), notas_dieta ?? ""]
    });
    await notificarClientePlanActualizado(db, req, usuario_id, "plan_dieta", {
      silencioso: notificar === false
    });
    res.json({ mensaje: "Dieta asignada" });
  } catch (err) {
    console.error("dietas/guardar:", err.message);
    res.status(503).json({ error: mensajeErrorDb(err), codigo: "db_temporal" });
  }
});

/**
 * Checklist Fitia-light: solo adherenciaDia + consumido.
 * No toca datos_dieta. Permitido al dueño (con o sin coach).
 */
app.post("/api/dietas/adherencia", async (req, res) => {
  const { usuario_id, adherenciaDia, consumido } = req.body || {};
  if (!req.user) return res.status(401).json({ error: "Sesión requerida" });

  const tid = parseInt(usuario_id, 10);
  const aid = parseInt(req.user.id, 10);
  if (!tid || Number.isNaN(tid)) {
    return res.status(400).json({ error: "usuario_id inválido", codigo: "adherencia_bad_request" });
  }
  if (tid !== aid) {
    return res.status(403).json({
      error: "Solo puedes registrar tu propia adherencia.",
      codigo: "adherencia_solo_propia"
    });
  }
  if (!adherenciaDia || typeof adherenciaDia !== "object" || Array.isArray(adherenciaDia)) {
    return res.status(400).json({
      error: "adherenciaDia requerido",
      codigo: "adherencia_bad_request"
    });
  }
  if (!adherenciaDia.fecha || typeof adherenciaDia.fecha !== "string") {
    return res.status(400).json({
      error: "adherenciaDia.fecha requerida (YYYY-MM-DD)",
      codigo: "adherencia_bad_request"
    });
  }

  try {
    const dietaRes = await db.execute({
      sql: "SELECT datos_dieta, macros_totales, notas_dieta FROM dietas WHERE usuario_id = ?",
      args: [tid]
    });
    if (!dietaRes.rows.length) {
      return res.status(404).json({
        error: "Aún no tienes un plan de nutrición.",
        codigo: "adherencia_sin_dieta"
      });
    }

    const prev = parseMacrosTotalesJson(dietaRes.rows[0].macros_totales) || {};
    const macrosNext = {
      ...prev,
      adherenciaDia,
      ...(consumido != null ? { consumido } : {})
    };

    await db.execute({
      sql: "UPDATE dietas SET macros_totales = ? WHERE usuario_id = ?",
      args: [JSON.stringify(macrosNext), tid]
    });

    res.json({
      mensaje: "Adherencia guardada",
      macros_totales: macrosNext
    });
  } catch (err) {
    console.error("dietas/adherencia:", err.message);
    res.status(503).json({
      error: mensajeErrorDb(err, "No se pudo guardar la adherencia."),
      codigo: "db_temporal"
    });
  }
});

/**
 * Sustitución puntual (cliente con coach + Full Week).
 * Solo reemplaza un alimento; no acepta reescritura del plan completo.
 */
app.post("/api/dietas/sustituir", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Sesión requerida" });
  if (user.rol !== "CLIENTE") {
    return res.status(403).json({ error: "Solo el atleta puede usar esta ruta de sustitución." });
  }

  const aid = parseInt(user.id, 10);
  const {
    comida_id: comidaId,
    id_unico: idUnico,
    sustituto_id: sustitutoId,
    cantidad,
    cantidad_sugerida: cantidadSugerida
  } = req.body || {};

  const qty = parseFloat(cantidad ?? cantidadSugerida);
  if (comidaId == null || !idUnico || !sustitutoId || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({
      error: "comida_id, id_unico, sustituto_id y cantidad son obligatorios."
    });
  }

  try {
    const u = await db.execute({
      sql: "SELECT coach_id, paquete_rutina_6_dias FROM usuarios WHERE id = ?",
      args: [aid]
    });
    const row = u.rows[0];
    if (!row) return res.status(404).json({ error: "Usuario no encontrado" });

    const coachRaw = row.coach_id;
    const coachId = coachRaw != null && coachRaw !== "" ? Number(coachRaw) : null;
    if (!coachId || Number.isNaN(coachId) || coachId <= 0) {
      return res.status(403).json({
        error: "Esta ruta es para atletas con coach. En modo libre usa el guardado normal."
      });
    }
    if (!row.paquete_rutina_6_dias) {
      return res.status(403).json({
        error: "Activa Full Week PRO para aplicar equivalencias a tu plan.",
        codigo: "requiere_full_week"
      });
    }

    const dietaRes = await db.execute({
      sql: "SELECT datos_dieta, macros_totales, notas_dieta FROM dietas WHERE usuario_id = ?",
      args: [aid]
    });
    if (!dietaRes.rows?.length) {
      return res.status(404).json({ error: "Aún no tienes dieta asignada." });
    }

    let datosDieta;
    try {
      datosDieta = JSON.parse(dietaRes.rows[0].datos_dieta);
    } catch {
      return res.status(500).json({ error: "Dieta corrupta en servidor." });
    }

    // Localizar alimento original
    const comidas = Array.isArray(datosDieta)
      ? datosDieta
      : Array.isArray(datosDieta?.planDiario)
        ? datosDieta.planDiario
        : null;
    if (!comidas) {
      return res.status(400).json({ error: "Formato de dieta no soportado para sustitución." });
    }

    let original = null;
    for (const c of comidas) {
      if (String(c.id) !== String(comidaId) && Number(c.id) !== Number(comidaId)) continue;
      original = (c.alimentos || []).find((a) => String(a.idUnico) === String(idUnico));
      if (original) break;
    }
    if (!original) {
      return res.status(404).json({ error: "No se encontró ese alimento en tu plan." });
    }

    const bibOrig = original.id
      ? await db.execute({ sql: "SELECT * FROM alimentos WHERE id = ?", args: [original.id] })
      : { rows: [] };
    let filaOrig = bibOrig.rows[0];
    if (!filaOrig && original.nombre) {
      const byName = await db.execute({
        sql: "SELECT * FROM alimentos WHERE LOWER(nombre) = LOWER(?) LIMIT 1",
        args: [String(original.nombre).trim()]
      });
      filaOrig = byName.rows[0];
    }

    const bibNew = await db.execute({
      sql: "SELECT * FROM alimentos WHERE id = ?",
      args: [parseInt(sustitutoId, 10)]
    });
    const filaNew = bibNew.rows[0];
    if (!filaNew) {
      return res.status(404).json({ error: "Sustituto no encontrado en biblioteca." });
    }

    const geOrig = String(filaOrig?.grupo_equivalencia || original.grupo_equivalencia || "").trim();
    const geNew = String(filaNew.grupo_equivalencia || "").trim();
    if (!geOrig || !geNew || geOrig !== geNew || SIN_SUSTITUTO.has(geOrig)) {
      return res.status(400).json({
        error: "El sustituto no es equivalente nutricional al alimento original.",
        codigo: "grupo_invalido"
      });
    }

    const alimentoNuevo = mapearAlimentoDesdeBiblioteca(filaNew, qty, String(idUnico));
    if (!alimentoNuevo) {
      return res.status(400).json({ error: "Cantidad de sustituto inválida." });
    }

    const aplicado = aplicarSustitutoEnDatosDieta(datosDieta, {
      comidaId,
      idUnico: String(idUnico),
      alimentoNuevo
    });
    if (!aplicado.ok) {
      return res.status(400).json({ error: aplicado.error || "No se pudo aplicar el sustituto." });
    }

    const macrosPrev = dietaRes.rows[0].macros_totales;
    await db.execute({
      sql: `UPDATE dietas SET datos_dieta = ?, ultima_actualizacion = CURRENT_TIMESTAMP WHERE usuario_id = ?`,
      args: [JSON.stringify(aplicado.datos), aid]
    });

    res.json({
      ok: true,
      mensaje: "Sustituto aplicado",
      datos_dieta: aplicado.datos,
      macros_totales: macrosPrev ? JSON.parse(macrosPrev) : null
    });
  } catch (err) {
    console.error("dietas/sustituir:", err.message);
    res.status(500).json({ error: err.message || "Error al sustituir." });
  }
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
  const { usuario_id, datos_rutina, notas_generales, notificar } = req.body;
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;
  try {
    await db.execute({
      sql: `INSERT INTO rutinas (usuario_id, datos_rutina, notas_generales) VALUES (?, ?, ?) ON CONFLICT(usuario_id) DO UPDATE SET datos_rutina = excluded.datos_rutina, notas_generales = excluded.notas_generales`,
      args: [usuario_id, JSON.stringify(datos_rutina), JSON.stringify(notas_generales)]
    });
    await notificarClientePlanActualizado(db, req, usuario_id, "plan_rutina", {
      silencioso: notificar === false
    });
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

/** Cierra sesión ENTRENAR: duración + volumen (auditoría / Superadmin). */
app.post("/api/fuerza/sesion", async (req, res) => {
  const {
    usuario_id,
    dia_rutina,
    duracion_seg,
    volumen_kg,
    series_completadas
  } = req.body || {};
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;

  const duracion = Math.max(0, parseInt(duracion_seg, 10) || 0);
  const volumen = Math.max(0, parseFloat(volumen_kg) || 0);
  const series = Math.max(0, parseInt(series_completadas, 10) || 0);
  const dia = dia_rutina != null ? String(dia_rutina).trim() || null : null;

  if (duracion < 60 || series < 1) {
    return res.status(400).json({
      error: "Sesión demasiado corta o sin series (mín. 60s y 1 serie)"
    });
  }

  try {
    const dup = await db.execute({
      sql: `SELECT id FROM sesiones_entrenamiento
            WHERE usuario_id = ?
              AND COALESCE(dia_rutina, '') = COALESCE(?, '')
              AND date(fecha) = date('now')
            ORDER BY id DESC LIMIT 1`,
      args: [usuario_id, dia]
    });

    if (dup.rows?.length) {
      const id = Number(dup.rows[0].id);
      const upd = await db.execute({
        sql: `UPDATE sesiones_entrenamiento
              SET duracion_seg = ?, volumen_kg = ?, series_completadas = ?, fecha = CURRENT_TIMESTAMP
              WHERE id = ?`,
        args: [duracion, volumen, series, id]
      });
      if (!upd.rowsAffected) {
        return res.status(500).json({ error: "No se pudo actualizar la sesión" });
      }
      return res.json({ mensaje: "Ok", id, actualizado: true });
    }

    const result = await db.execute({
      sql: `INSERT INTO sesiones_entrenamiento
            (usuario_id, dia_rutina, duracion_seg, volumen_kg, series_completadas)
            VALUES (?, ?, ?, ?, ?)`,
      args: [usuario_id, dia, duracion, volumen, series]
    });
    res.json({ mensaje: "Ok", id: Number(result.lastInsertRowid), actualizado: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

app.post("/api/medidas/veredicto-ia", async (req, res) => {
  const {
    usuario_id,
    actual,
    dia1,
    anterior,
    deltas,
    reglas_base
  } = req.body || {};
  if (!(await assertAccesoUsuarioEdicion(db, req, res, usuario_id))) return;

  const payload = {
    actual: actual || null,
    dia1: dia1 || null,
    anterior: anterior || null,
    deltas: deltas || {},
    reglas_base: reglas_base || []
  };
  const fp = fingerprintMedidasVeredicto(payload);
  const regenerar = req.query.regenerar === "1" || req.query.regenerar === 1;

  try {
    await ensureTablaVeredictosMedidasIa(db);
    if (!regenerar) {
      const cache = await leerVeredictoMedidasCache(db, usuario_id, fp);
      if (cache) {
        return res.json({ ok: true, ia: true, cached: true, ...cache });
      }
    }

    const resultado = await generarVeredictoMedidasIa(payload);
    if (!resultado.ok) {
      return res.json({ ok: false, motivo: resultado.motivo || "sin_ia" });
    }

    await guardarVeredictoMedidasCache(db, usuario_id, fp, resultado);
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
    ["sesiones_entrenamiento", "usuario_id"],
    ["accesos_app", "usuario_id"],
    ["perfiles_clientes", "usuario_id"],
    ["perfiles_coach_publicos", "usuario_id"],
    ["suscripciones_coach", "usuario_id"],
    ["suscripciones_atleta", "usuario_id"],
    ["informes_anatomia_ia", "usuario_id"],
    ["veredictos_medidas_ia", "usuario_id"],
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
    sql: "DELETE FROM plantillas_rutina_coach WHERE coach_id = ?",
    args: [userId]
  });
  await borrarDatosSocialesUsuario(db, userId);
  await db.execute({
    sql: "DELETE FROM recuperacion WHERE email = (SELECT email FROM usuarios WHERE id = ?)",
    args: [userId]
  });

  const del = await db.execute({ sql: "DELETE FROM usuarios WHERE id = ?", args: [userId] });
  return (del.rowsAffected ?? 0) > 0;
}

/** Registra acceso diario (login o ping). Auth requerida. */
async function upsertAccesoApp(dbConn, usuarioId, fuenteRaw) {
  const uid = parseInt(usuarioId, 10);
  if (!Number.isFinite(uid) || uid <= 0) return { ok: false };
  const fuente =
    fuenteRaw === "login" || fuenteRaw === "registro" || fuenteRaw === "ping"
      ? fuenteRaw
      : "ping";
  const diaRes = await dbConn.execute({
    sql: `SELECT date('now') AS dia`,
    args: []
  });
  const dia = String(diaRes.rows?.[0]?.dia || "").slice(0, 10);
  if (!dia) return { ok: false };

  const existing = await dbConn.execute({
    sql: `SELECT hits FROM accesos_app WHERE usuario_id = ? AND dia = ?`,
    args: [uid, dia]
  });
  if (existing.rows?.length) {
    await dbConn.execute({
      sql: `UPDATE accesos_app
            SET ultima_vez = CURRENT_TIMESTAMP,
                hits = hits + 1,
                fuente = CASE WHEN fuente = 'ping' AND ? IN ('login','registro') THEN ? ELSE fuente END
            WHERE usuario_id = ? AND dia = ?`,
      args: [fuente, fuente, uid, dia]
    });
    return { ok: true, dia, nuevo: false };
  }
  await dbConn.execute({
    sql: `INSERT INTO accesos_app (usuario_id, dia, fuente, primera_vez, ultima_vez, hits)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
    args: [uid, dia, fuente]
  });
  return { ok: true, dia, nuevo: true };
}

app.post("/api/accesos/ping", async (req, res) => {
  try {
    const fuente = req.body?.fuente || "ping";
    const out = await upsertAccesoApp(db, req.user.id, fuente);
    if (!out.ok) return res.status(400).json({ error: "No se pudo registrar acceso" });
    res.json({ ok: true, dia: out.dia, nuevo: !!out.nuevo });
  } catch (err) {
    console.error("accesos/ping:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Quién abrió la app (DAU) — solo SUPERADMIN. */
app.get("/api/admin/accesos-stats", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;

  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 7, 1), 365);

  try {
    const agg = await db.execute({
      sql: `SELECT
              COUNT(*) AS dias_usuario,
              COUNT(DISTINCT usuario_id) AS usuarios_unicos,
              SUM(hits) AS hits_totales
            FROM accesos_app
            WHERE dia >= date('now', ?)`,
      args: [`-${dias - 1} days`]
    });
    const a = agg.rows?.[0] || {};

    const hoy = await db.execute({
      sql: `SELECT COUNT(DISTINCT usuario_id) AS usuarios_hoy
            FROM accesos_app WHERE dia = date('now')`,
      args: []
    });

    const recientes = await db.execute({
      sql: `SELECT a.usuario_id, a.dia, a.fuente, a.primera_vez, a.ultima_vez, a.hits,
                   u.nombre, u.email, u.rol
            FROM accesos_app a
            JOIN usuarios u ON u.id = a.usuario_id
            WHERE a.dia >= date('now', ?)
            ORDER BY a.ultima_vez DESC
            LIMIT 80`,
      args: [`-${dias - 1} days`]
    });

    res.json({
      ventana_dias: dias,
      usuarios_unicos: Number(a.usuarios_unicos) || 0,
      usuarios_hoy: Number(hoy.rows?.[0]?.usuarios_hoy) || 0,
      dias_usuario: Number(a.dias_usuario) || 0,
      hits_totales: Number(a.hits_totales) || 0,
      recientes: (recientes.rows || []).map((r) => ({
        usuario_id: Number(r.usuario_id),
        nombre: r.nombre,
        email: r.email,
        rol: r.rol,
        dia: r.dia,
        fuente: r.fuente,
        primera_vez: r.primera_vez,
        ultima_vez: r.ultima_vez,
        hits: Number(r.hits) || 0
      }))
    });
  } catch (err) {
    console.error("Error admin accesos-stats:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stats de duración de sesiones ENTRENAR — solo SUPERADMIN. */
app.get("/api/admin/sesiones-stats", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;

  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 1), 365);

  try {
    const agg = await db.execute({
      sql: `SELECT
              COUNT(*) AS sesiones,
              COUNT(DISTINCT usuario_id) AS usuarios_activos,
              AVG(duracion_seg) AS duracion_promedio_seg,
              AVG(volumen_kg) AS volumen_promedio_kg,
              AVG(series_completadas) AS series_promedio
            FROM sesiones_entrenamiento
            WHERE fecha >= datetime('now', ?)`,
      args: [`-${dias} days`]
    });
    const a = agg.rows?.[0] || {};

    const duraciones = await db.execute({
      sql: `SELECT duracion_seg FROM sesiones_entrenamiento
            WHERE fecha >= datetime('now', ?)
            ORDER BY duracion_seg ASC`,
      args: [`-${dias} days`]
    });
    const listaDur = (duraciones.rows || [])
      .map((r) => Number(r.duracion_seg) || 0)
      .filter((n) => n > 0);

    const percentil = (arr, p) => {
      if (!arr.length) return 0;
      const idx = Math.min(arr.length - 1, Math.max(0, Math.ceil(arr.length * p) - 1));
      return arr[idx];
    };

    const recientes = await db.execute({
      sql: `SELECT s.id, s.usuario_id, s.dia_rutina, s.duracion_seg, s.volumen_kg,
                   s.series_completadas, s.fecha, u.nombre, u.email, u.rol
            FROM sesiones_entrenamiento s
            JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.fecha >= datetime('now', ?)
            ORDER BY s.fecha DESC
            LIMIT 40`,
      args: [`-${dias} days`]
    });

    res.json({
      ventana_dias: dias,
      sesiones: Number(a.sesiones) || 0,
      usuarios_activos: Number(a.usuarios_activos) || 0,
      duracion_promedio_seg: Math.round(Number(a.duracion_promedio_seg) || 0),
      duracion_mediana_seg: Math.round(percentil(listaDur, 0.5)),
      duracion_p90_seg: Math.round(percentil(listaDur, 0.9)),
      volumen_promedio_kg: Math.round(Number(a.volumen_promedio_kg) || 0),
      series_promedio: Math.round((Number(a.series_promedio) || 0) * 10) / 10,
      recientes: (recientes.rows || []).map((r) => ({
        id: Number(r.id),
        usuario_id: Number(r.usuario_id),
        nombre: r.nombre,
        email: r.email,
        rol: r.rol,
        dia_rutina: r.dia_rutina || null,
        duracion_seg: Number(r.duracion_seg) || 0,
        volumen_kg: Math.round(Number(r.volumen_kg) || 0),
        series_completadas: Number(r.series_completadas) || 0,
        fecha: r.fecha
      }))
    });
  } catch (err) {
    console.error("Error admin sesiones-stats:", err.message);
    res.status(500).json({ error: err.message });
  }
});

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

/** Cambio de contraseña con sesión activa (Ajustes → Cuenta). */
app.post("/api/usuarios/me/password", async (req, res) => {
  const userId = parseInt(req.user.id, 10);
  if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: "Usuario inválido" });

  const passwordActual = String(req.body?.passwordActual || "");
  const nuevaPassword = String(req.body?.nuevaPassword || "");
  if (!passwordActual || !nuevaPassword) {
    return res.status(400).json({ error: "Contraseña actual y nueva son obligatorias" });
  }
  if (nuevaPassword.length < 4) {
    return res.status(400).json({ error: "La nueva contraseña es demasiado corta" });
  }
  if (passwordActual === nuevaPassword) {
    return res.status(400).json({ error: "La nueva contraseña debe ser distinta" });
  }

  try {
    const row = await db.execute({
      sql: "SELECT id, password FROM usuarios WHERE id = ?",
      args: [userId]
    });
    if (row.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    if (!bcrypt.compareSync(passwordActual, row.rows[0].password)) {
      /* 400 (no 401): 401 en apiClient cierra sesión */
      return res.status(400).json({ error: "Contraseña actual incorrecta" });
    }

    const hash = bcrypt.hashSync(nuevaPassword, 10);
    const result = await db.execute({
      sql: "UPDATE usuarios SET password = ? WHERE id = ?",
      args: [hash, userId]
    });
    if ((result.rowsAffected ?? 0) === 0) {
      return res.status(500).json({ error: "No se pudo actualizar la contraseña" });
    }
    res.json({ mensaje: "Contraseña actualizada" });
  } catch (err) {
    console.error("Error cambiar password sesión:", err.message);
    res.status(500).json({ error: "No se pudo actualizar la contraseña" });
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

/** Código de invitación: quita espacios (UI espaciada A B C…) y normaliza mayúsculas. */
function normalizarCodigoInvitacion(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

app.post("/api/clientes/vincular-coach", async (req, res) => {
  const { coach_id, codigo_invitacion, codigoIngresado, codigo } = req.body || {};
  let coachId = parseInt(coach_id, 10);
  const codigoNorm = normalizarCodigoInvitacion(
    codigo_invitacion || codigoIngresado || codigo || ""
  );
  const clienteId = parseInt(req.user.id, 10);

  if (!clienteId || Number.isNaN(clienteId)) return res.status(400).json({ error: "Cliente inválido" });

  if (req.user.rol !== "CLIENTE") {
    return res.status(403).json({ error: "Solo CLIENTE puede vincularse a un coach" });
  }

  try {
    if ((!coachId || Number.isNaN(coachId)) && codigoNorm) {
      const porCodigo = await db.execute({
        sql: "SELECT id FROM usuarios WHERE codigo_invitacion = ? AND rol IN ('COACH', 'SUPERADMIN') LIMIT 1",
        args: [codigoNorm]
      });
      if (porCodigo.rows.length === 0) {
        return res.status(404).json({ error: "No encontramos un coach con ese código." });
      }
      coachId = parseInt(porCodigo.rows[0].id, 10);
    }

    if (!coachId || Number.isNaN(coachId)) {
      return res.status(400).json({ error: "Indica coach_id o código de invitación" });
    }

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

/** Fotos de progreso corporal (frente / lado / espalda). */
app.get("/api/clientes/:id/fotos-progreso", async (req, res) => {
  if (!(await assertAccesoUsuario(db, req, res, req.params.id))) return;
  try {
    const usuarioId = parseInt(req.params.id, 10);
    const fotos = await listarFotosProgreso(db, usuarioId);
    res.json({ fotos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clientes/:id/fotos-progreso", async (req, res) => {
  if (!(await assertAccesoUsuarioEdicion(db, req, res, req.params.id))) return;
  try {
    const usuarioId = parseInt(req.params.id, 10);
    const { imagen, vista, nota, fecha } = req.body || {};
    const out = await crearFotoProgreso(db, {
      usuarioId,
      vista,
      nota,
      fecha,
      imagen,
      createdBy: parseInt(req.user.id, 10)
    });
    if (!out.ok) return res.status(out.status || 400).json({ error: out.error });
    res.status(201).json({ foto: out.foto });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/clientes/:id/fotos-progreso/:fotoId", async (req, res) => {
  if (!(await assertAccesoUsuarioEdicion(db, req, res, req.params.id))) return;
  try {
    const usuarioId = parseInt(req.params.id, 10);
    const fotoId = parseInt(req.params.fotoId, 10);
    if (!fotoId) return res.status(400).json({ error: "ID de foto inválido" });
    const out = await borrarFotoProgreso(db, { usuarioId, fotoId });
    if (!out.ok) return res.status(out.status || 404).json({ error: out.error });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
        p.foto_url, p.bio, p.especialidad, p.logros, p.tarifa_base, p.whatsapp
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

/** Lookup por código de invitación — coaches fuera del catálogo (trial / sin verificación). Auth requerida. */
app.get("/api/directorio/coach-por-codigo", async (req, res) => {
  const codigo = normalizarCodigoInvitacion(req.query.codigo || "");
  if (!codigo || codigo.length < 4) {
    return res.status(400).json({ error: "Escribe un código de coach válido." });
  }
  try {
    const coachRes = await db.execute({
      sql: `SELECT u.id, u.nombre, u.rol, u.calificacion,
              p.foto_url, p.bio, p.especialidad, p.tarifa_base,
              COALESCE(p.verificado, 0) AS verificado,
              COALESCE(p.visible_en_directorio, 1) AS visible_en_directorio
            FROM usuarios u
            LEFT JOIN perfiles_coach_publicos p ON p.usuario_id = u.id
            WHERE u.codigo_invitacion = ? AND u.rol IN ('COACH', 'SUPERADMIN')
            LIMIT 1`,
      args: [codigo]
    });
    if (coachRes.rows.length === 0) {
      return res.status(404).json({ error: "No encontramos un coach con ese código." });
    }
    const row = coachRes.rows[0];
    if (row.rol === "COACH") {
      const sub = await evaluarSuscripcionCoach(db, row.id);
      if (!sub) {
        return res.status(400).json({
          error: "Este coach no puede recibir alumnos ahora (suscripción inactiva)."
        });
      }
    }
    const enDirectorio =
      Number(row.verificado) === 1 && Number(row.visible_en_directorio) === 1;
    res.json({
      id: Number(row.id),
      nombre: row.nombre,
      calificacion: row.calificacion,
      foto_url: row.foto_url || "",
      bio: row.bio || "",
      especialidad: row.especialidad || "",
      tarifa_base: row.tarifa_base != null ? Number(row.tarifa_base) : null,
      en_directorio: enDirectorio,
      mensaje: enDirectorio
        ? null
        : "Coach privado — no aparece en el catálogo público."
    });
  } catch (err) {
    console.error("Error coach-por-codigo:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/directorio/mi-perfil/:usuario_id", async (req, res) => {
  if (parseInt(req.params.usuario_id, 10) !== parseInt(req.user.id, 10)) {
    return res.status(403).json({ error: "Solo puedes ver tu perfil de coach" });
  }
  try {
    const userRes = await db.execute({
      sql: "SELECT id, nombre, rol, calificacion, codigo_invitacion FROM usuarios WHERE id = ?",
      args: [req.params.usuario_id]
    });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    const user = userRes.rows[0];
    if (user.rol !== 'COACH' && user.rol !== 'SUPERADMIN') {
      return res.status(403).json({ error: "Solo coaches pueden tener perfil público" });
    }
    const perfilRes = await db.execute({
      sql: `SELECT foto_url, bio, especialidad, logros, tarifa_base, whatsapp, visible_en_directorio, verificado
            FROM perfiles_coach_publicos WHERE usuario_id = ?`,
      args: [req.params.usuario_id]
    });
    const subRes = await db.execute({
      sql: "SELECT status, plan FROM suscripciones_coach WHERE usuario_id = ?",
      args: [req.params.usuario_id]
    });
    const perfil = perfilRes.rows[0] || {
      foto_url: '', bio: '', especialidad: '', logros: '', tarifa_base: null, whatsapp: '',
      visible_en_directorio: 1, verificado: 0
    };
    res.json({
      usuario: user,
      perfil,
      suscripcion: subRes.rows[0] || null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/directorio/guardar-perfil", async (req, res) => {
  const { usuario_id, foto_url, bio, especialidad, logros, tarifa_base, whatsapp, visible_en_directorio } = req.body;
  if (!usuario_id) return res.status(400).json({ error: "usuario_id requerido" });
  if (parseInt(usuario_id, 10) !== parseInt(req.user.id, 10)) {
    return res.status(403).json({ error: "Solo puedes editar tu perfil público" });
  }
  try {
    const userRes = await db.execute({ sql: "SELECT rol FROM usuarios WHERE id = ?", args: [usuario_id] });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    const rol = userRes.rows[0].rol;
    if (rol !== 'COACH' && rol !== 'SUPERADMIN') {
      return res.status(403).json({ error: "Solo coaches pueden guardar perfil público" });
    }
    await db.execute({
      sql: `INSERT INTO perfiles_coach_publicos (
              usuario_id, foto_url, bio, especialidad, logros, tarifa_base, whatsapp, visible_en_directorio
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(usuario_id) DO UPDATE SET
              foto_url = excluded.foto_url,
              bio = excluded.bio,
              especialidad = excluded.especialidad,
              logros = excluded.logros,
              tarifa_base = excluded.tarifa_base,
              whatsapp = excluded.whatsapp,
              visible_en_directorio = excluded.visible_en_directorio`,
      args: [
        usuario_id,
        foto_url || '',
        bio || '',
        especialidad || '',
        logros || '',
        tarifa_base != null && tarifa_base !== '' ? parseFloat(tarifa_base) : null,
        whatsapp || '',
        visible_en_directorio === false || visible_en_directorio === 0 ? 0 : 1
      ]
    });
    const perfilGuardado = await db.execute({
      sql: `SELECT foto_url, bio, especialidad, logros, tarifa_base, whatsapp, visible_en_directorio, verificado
            FROM perfiles_coach_publicos WHERE usuario_id = ?`,
      args: [usuario_id]
    });
    res.json({
      mensaje: "Perfil público guardado. Aparecerás en el catálogo cuando MétodoG verifique tu cuenta.",
      perfil: perfilGuardado.rows[0] || null
    });
  } catch (err) {
    console.error("Error guardar perfil coach:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** SUPERADMIN — revisión manual de coaches para el directorio público (§15 paso 4). */
function mapCoachRevisionRow(row) {
  const bio = String(row.bio ?? "").trim();
  const especialidad = String(row.especialidad ?? "").trim();
  const logros = String(row.logros ?? "").trim();
  const whatsapp = String(row.whatsapp ?? "").trim();
  const fotoUrl = String(row.foto_url ?? "").trim();
  const tarifaBase = row.tarifa_base != null && row.tarifa_base !== "" ? Number(row.tarifa_base) : null;
  const perfilPublicado = !!(bio || especialidad || logros || whatsapp || fotoUrl || tarifaBase != null);

  return {
    id: Number(row.id),
    nombre: row.nombre,
    email: row.email,
    calificacion: row.calificacion,
    codigo_invitacion: row.codigo_invitacion,
    foto_url: fotoUrl,
    bio,
    especialidad,
    logros,
    tarifa_base: tarifaBase,
    whatsapp,
    verificado: !!Number(row.verificado),
    visible_en_directorio: !!Number(row.visible_en_directorio ?? 1),
    sub_status: row.sub_status || null,
    sub_plan: row.sub_plan || null,
    perfil_publicado: perfilPublicado
  };
}

app.get("/api/directorio/admin/revision", async (req, res) => {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const result = await db.execute(`
      SELECT u.id, u.nombre, u.email, u.calificacion, u.codigo_invitacion,
        p.foto_url, p.bio, p.especialidad, p.logros, p.tarifa_base, p.whatsapp,
        COALESCE(p.verificado, 0) AS verificado,
        COALESCE(p.visible_en_directorio, 1) AS visible_en_directorio,
        s.status AS sub_status, s.plan AS sub_plan
      FROM usuarios u
      LEFT JOIN perfiles_coach_publicos p ON p.usuario_id = u.id
      LEFT JOIN suscripciones_coach s ON s.usuario_id = u.id
      WHERE u.rol = 'COACH'
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
  const rol = esEmailSuperAdmin(emailLimpio) ? 'SUPERADMIN' : 'CLIENTE';
  const query = `INSERT INTO usuarios (nombre, email, password, rol, codigo_invitacion, coach_id) VALUES (?, ?, ?, ?, ?, ?)`;
  
  try {
    const codigoRegistro = normalizarCodigoInvitacion(codigoIngresado);
    if (codigoRegistro) {
      const coachRes = await db.execute({
        sql: "SELECT id FROM usuarios WHERE codigo_invitacion = ?",
        args: [codigoRegistro]
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
    let user = userRes.rows[0];
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    user = await asegurarRolSuperAdminPorEmail(db, user);
    let usuario = sanitizeUsuario(user);
    usuario = await enrichUsuarioConSuscripcion(db, usuario);
    usuario = await enrichUsuarioVinculo(db, usuario);
    const token = signToken(usuario);
    try {
      await upsertAccesoApp(db, usuario.id, "login");
    } catch (e) {
      console.warn("login acceso:", e.message);
    }
    res.json({ usuario, token });
  } catch (err) {
    console.error("login:", err.message);
    res.status(503).json({ error: mensajeErrorDb(err), codigo: "db_temporal" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const userRes = await db.execute({ sql: "SELECT * FROM usuarios WHERE id = ?", args: [req.user.id] });
    if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    let row = userRes.rows[0];
    row = await asegurarRolSuperAdminPorEmail(db, row);
    let usuario = sanitizeUsuario(row);
    usuario = await enrichUsuarioConSuscripcion(db, usuario);
    usuario = await enrichUsuarioVinculo(db, usuario);
    const payload = { usuario };
    if (usuario.rol !== req.user.rol) {
      payload.token = signToken(usuario);
    }
    res.json(payload);
  } catch (err) {
    console.error("auth/me:", err.message);
    res.status(503).json({ error: mensajeErrorDb(err), codigo: "db_temporal" });
  }
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
    /** Refrescar fecha en cada solicitud (si no, ON CONFLICT deja fecha vieja → “caducado” al instante). */
    await db.execute({
      sql: `INSERT INTO recuperacion (email, codigo, fecha) VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email) DO UPDATE SET codigo = excluded.codigo, fecha = CURRENT_TIMESTAMP`,
      args: [emailLimpio, codigo]
    });

    const { data, error } = await resend.emails.send({
      from: remiteResend(),
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
  const emailLimpio = String(email || "").toLowerCase().trim();
  const codigoLimpio = String(codigo || "").trim();
  try {
    const rec = await db.execute({
      sql: "SELECT * FROM recuperacion WHERE email = ? AND codigo = ?",
      args: [emailLimpio, codigoLimpio]
    });
    if (rec.rows.length === 0) return res.status(400).json({ error: "Código incorrecto o caducado" });

    const rawFecha = rec.rows[0].fecha;
    let creado = NaN;
    if (typeof rawFecha === "number") {
      creado = rawFecha < 1e12 ? rawFecha * 1000 : rawFecha;
    } else if (rawFecha != null) {
      const s = String(rawFecha).trim();
      /** SQLite CURRENT_TIMESTAMP = UTC sin zona → forzar Z para no interpretar como local. */
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
        creado = new Date(s.replace(" ", "T") + "Z").getTime();
      } else {
        creado = new Date(s).getTime();
      }
    }
    if (Number.isNaN(creado) || Date.now() - creado > 15 * 60 * 1000) {
      console.warn("[recuperacion] caducado", { email: emailLimpio, rawFecha, creado, now: Date.now() });
      return res.status(400).json({ error: "Código caducado. Solicita uno nuevo." });
    }

    if (!nuevaPassword || String(nuevaPassword).length < 4) {
      return res.status(400).json({ error: "La nueva contraseña es demasiado corta." });
    }

    const hash = bcrypt.hashSync(nuevaPassword, 10);
    await db.execute({ sql: "UPDATE usuarios SET password = ? WHERE email = ?", args: [hash, emailLimpio] });
    await db.execute({ sql: "DELETE FROM recuperacion WHERE email = ?", args: [emailLimpio] });
    
    res.json({ mensaje: "Contraseña actualizada con éxito" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Cron Render: recordatorios trial coach (campanita + email). Header x-cron-secret = CRON_SECRET */
app.post("/api/cron/trial-recordatorios", async (req, res) => {
  const secret = (req.headers["x-cron-secret"] || req.query.secret || "").trim();
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected || secret !== expected) {
    return res.status(401).json({ error: "No autorizado" });
  }
  try {
    const stats = await procesarRecordatoriosTrialCoach(db, resend);
    console.log("✓ Cron trial-recordatorios:", stats);
    res.json({ ok: true, ...stats });
  } catch (err) {
    console.error("Cron trial-recordatorios:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 MOTOR EN PUERTO ${PORT}`));