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
  assertCoachOAdmin,
  assertComunidadSelf
} = require("./auth");
const {
  crearCheckoutAtleta,
  crearCheckoutCoach,
  crearPortalCoach,
  handleStripeWebhook,
  enrichUsuarioConSuscripcion
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
  cancelarSolicitudesPendientesCliente,
  notificarClientePlanActualizado
} = require("./notificaciones");
const { buildMeso2Payload, PROGRAMA_MESO2 } = require("./data/programa-meso2-geovanni");
const { buildCorsOptions, isProduction } = require("./corsConfig");
const { generarOpinionInformeMensual } = require("./aiInforme");
const {
  fingerprintGrupos,
  leerInformeCache,
  guardarInformeCache
} = require("./informeIaCache");

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
    ts: new Date().toISOString()
  });
}

app.get("/", (req, res) => {
  if (req.method === "HEAD") return res.status(200).end();
  res.status(200).json({ ok: true, service: "metodog-backend" });
});
app.head("/", (req, res) => res.status(200).end());
app.all("/api/ping", responderPing);

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
      gustos TEXT,
      disgustos TEXT,
      enfermedades TEXT,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS perfiles_coach_publicos (
      usuario_id INTEGER PRIMARY KEY,
      foto_url TEXT,
      bio TEXT,
      especialidad TEXT,
      logros TEXT,
      tarifa_base REAL,
      whatsapp TEXT,
      visible_en_directorio INTEGER DEFAULT 1,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);

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

    await db.execute(`CREATE TABLE IF NOT EXISTS suscripciones_coach (
      usuario_id INTEGER PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'pro',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      limite_clientes INTEGER DEFAULT 25,
      current_period_end TEXT,
      cancel_at_period_end INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    try {
      await db.execute(
        "ALTER TABLE suscripciones_coach ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0"
      );
    } catch (_) { /* columna ya existe */ }

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
      fingerprint TEXT NOT NULL,
      opinion TEXT NOT NULL,
      siguiente_paso TEXT NOT NULL DEFAULT '[]',
      recomendaciones TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (usuario_id, mes),
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);

    const countRes = await db.execute("SELECT COUNT(*) as count FROM alimentos");
    if (countRes.rows[0].count === 0) {
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Pechuga de Pollo", "Carnes", 100, "g", 165, 31, 0, 3.6, 74] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Carne de Res Magra", "Carnes", 100, "g", 250, 26, 0, 15, 72] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Atún en Agua", "Carnes", 100, "g", 116, 26, 0, 1, 338] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Leche Entera", "Lácteos", 250, "ml", 150, 8, 12, 8, 105] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Yogur Griego Sin Azúcar", "Lácteos", 200, "g", 120, 20, 8, 0, 70] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Lentejas Cocidas", "Leguminosas", 100, "g", 116, 9, 20, 0.4, 2] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Frijoles Cocidos", "Leguminosas", 100, "g", 130, 8.8, 23, 0.5, 2] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Arroz Blanco Cocido", "Cereales", 100, "g", 130, 2.7, 28, 0.3, 1] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Avena en Hojuelas", "Cereales", 3, "cucharadas", 116, 4, 20, 2.5, 2] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Tortilla de Maíz", "Cereales", 1, "pieza", 52, 1.4, 11, 0.5, 11] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Almendras", "Grasas", 30, "g", 173, 6, 6, 15, 0] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Aceite de Oliva", "Grasas", 1, "cucharada", 119, 0, 0, 13.5, 0] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Aguacate", "Grasas", 50, "g", 80, 1, 4, 7.5, 7] });
    }
    console.log("✅ Base de datos conectada y lista (historial_fuerza + paquete_6_dias).");
  } catch (error) {
    console.error("❌ Error al conectar con la base de datos:", error.message);
    if (process.env.USE_LOCAL_DB !== "true") {
      console.error("💡 Si estás en local y falla la red a Turso, añade USE_LOCAL_DB=true en backend/.env");
    }
  }
}
inicializarBD();

// 🚀 RUTAS GENERALES DE LA APP
app.get("/api/alimentos", async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM alimentos ORDER BY grupo, nombre ASC");
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  if (!(await assertAccesoUsuario(db, req, res, usuario_id))) return;
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
  if (!(await assertAccesoUsuario(db, req, res, usuario_id))) return;
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
  if (!(await assertAccesoUsuario(db, req, res, usuario_id))) return;
  if (!usuario_id || !ejercicio || peso == null || peso === "") {
    return res.status(400).json({ error: "usuario_id, ejercicio y peso son obligatorios" });
  }
  const pesoNum = parseFloat(peso);
  if (Number.isNaN(pesoNum)) return res.status(400).json({ error: "Peso inválido" });
  try {
    const result = await db.execute({
      sql: `INSERT INTO historial_fuerza (usuario_id, ejercicio, peso, reps, numero_serie, dia_rutina) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        usuario_id,
        String(ejercicio).trim(),
        pesoNum,
        parseInt(reps, 10) || 0,
        numero_serie != null ? parseInt(numero_serie, 10) : null,
        dia_rutina || null
      ]
    });
    res.json({ mensaje: "Ok", id: Number(result.lastInsertRowid) });
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
    res.json({ historial: result.rows });
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
    const ejercicios = [...new Set(result.rows.map(r => r.ejercicio))];
    res.json({ historial: result.rows, ejercicios });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Opinión IA para informe mensual (OpenAI + caché Turso por mes). ?regenerar=1 fuerza nueva llamada. */
app.post("/api/rendimiento/informe-ia", async (req, res) => {
  const { usuario_id, mes, grupos, balance_score, fuente_grupos, reglas_base } = req.body || {};
  if (!(await assertAccesoUsuario(db, req, res, usuario_id))) return;
  if (!mes || !Array.isArray(grupos)) {
    return res.status(400).json({ error: "mes y grupos son obligatorios" });
  }
  const forzarRegenerar = req.query.regenerar === "1" || req.body?.regenerar === true;
  const fp = fingerprintGrupos(grupos, balance_score ?? 0);

  try {
    if (!forzarRegenerar) {
      const cached = await leerInformeCache(db, usuario_id, mes);
      if (cached && cached.fingerprint === fp) {
        return res.json({
          ok: true,
          ia: true,
          cached: true,
          opinion: cached.opinion,
          siguiente_paso: cached.siguiente_paso,
          recomendaciones: cached.recomendaciones
        });
      }
    }

    const resultado = await generarOpinionInformeMensual({
      mes,
      grupos,
      balanceScore: balance_score,
      fuenteGrupos: fuente_grupos,
      reglasBase: reglas_base
    });
    if (!resultado.ok) return res.json({ ok: false, motivo: resultado.motivo || "sin_ia", detalle: resultado.detalle || null });
    await guardarInformeCache(db, usuario_id, mes, fp, resultado);
    return res.json({ ...resultado, cached: false });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/pagos/crear-checkout-atleta", async (req, res) => {
  return crearCheckoutAtleta(req, res, db);
});

app.post("/api/pagos/crear-checkout-coach", async (req, res) => {
  return crearCheckoutCoach(req, res, db);
});

app.post("/api/pagos/portal-coach", async (req, res) => {
  return crearPortalCoach(req, res, db);
});

app.delete("/api/usuarios/me", async (req, res) => {
  const userId = parseInt(req.user.id, 10);
  if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: "Usuario inválido" });

  try {
    // 0) Si hay suscripción Stripe ligada, intentamos cancelarla para evitar cobros futuros.
    try {
      const subRes = await db.execute({
        sql: "SELECT stripe_subscription_id FROM suscripciones_coach WHERE usuario_id = ?",
        args: [userId]
      });
      const subId = subRes.rows[0]?.stripe_subscription_id;
      if (subId) {
        const Stripe = require("stripe");
        const key = (process.env.STRIPE_SECRET_KEY || "").trim();
        if (key) {
          const stripe = new Stripe(key);
          await stripe.subscriptions.cancel(subId);
        }
      }
    } catch (_) { /* si falla Stripe, seguimos con borrado local */ }

    // 1) Si es coach, desvincular clientes para no dejar coach_id apuntando a un usuario borrado.
    await db.execute({
      sql: "UPDATE usuarios SET coach_id = NULL WHERE coach_id = ?",
      args: [userId]
    });

    // 2) Borrar datos dependientes del usuario.
    await db.execute({ sql: "DELETE FROM rutinas WHERE usuario_id = ?", args: [userId] });
    await db.execute({ sql: "DELETE FROM dietas WHERE usuario_id = ?", args: [userId] });
    await db.execute({ sql: "DELETE FROM mediciones WHERE usuario_id = ?", args: [userId] });
    await db.execute({ sql: "DELETE FROM historial_fuerza WHERE usuario_id = ?", args: [userId] });
    await db.execute({ sql: "DELETE FROM perfiles_clientes WHERE usuario_id = ?", args: [userId] });
    await db.execute({ sql: "DELETE FROM perfiles_coach_publicos WHERE usuario_id = ?", args: [userId] });
    await db.execute({ sql: "DELETE FROM suscripciones_coach WHERE usuario_id = ?", args: [userId] });
    await db.execute({ sql: "DELETE FROM planes_archivados WHERE coach_id = ? OR cliente_id = ?", args: [userId, userId] });
    await db.execute({ sql: "DELETE FROM valoraciones WHERE coach_id = ? OR cliente_id = ?", args: [userId, userId] });
    await db.execute({ sql: "DELETE FROM recuperacion WHERE email = (SELECT email FROM usuarios WHERE id = ?)", args: [userId] });

    // 3) Borrar el usuario.
    const del = await db.execute({ sql: "DELETE FROM usuarios WHERE id = ?", args: [userId] });
    const affected = del.rowsAffected ?? 0;
    if (affected === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    res.json({ deleted: true });
  } catch (err) {
    console.error("Error eliminar cuenta:", err.message);
    res.status(500).json({ error: "No se pudo eliminar la cuenta" });
  }
});

app.put("/api/usuarios/paquete-6-dias", async (req, res) => {
  const { usuario_id, activo } = req.body;
  if (!usuario_id) return res.status(400).json({ error: "usuario_id requerido" });
  if (parseInt(usuario_id, 10) !== parseInt(req.user.id, 10) && req.user.rol !== "SUPERADMIN") {
    return res.status(403).json({ error: "Solo puedes activar tu propio paquete" });
  }
  try {
    const result = await db.execute({
      sql: "UPDATE usuarios SET paquete_rutina_6_dias = ? WHERE id = ?",
      args: [activo ? 1 : 0, usuario_id]
    });
    if ((result.rowsAffected ?? 0) === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ paquete_rutina_6_dias: !!activo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/mediciones/guardar", async (req, res) => {
  const { usuario_id, peso, grasa, datos_extra } = req.body;
  if (!(await assertAccesoUsuario(db, req, res, usuario_id))) return;
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
    if (!(await assertAccesoUsuario(db, req, res, owner.rows[0].usuario_id))) return;

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
  const { usuario_id, edad, estatura, gustos, disgustos, enfermedades } = req.body;
  if (!(await assertAccesoUsuario(db, req, res, usuario_id))) return;
  try {
    await db.execute({
      sql: `INSERT INTO perfiles_clientes (usuario_id, edad, estatura, gustos, disgustos, enfermedades) 
            VALUES (?, ?, ?, ?, ?, ?) 
            ON CONFLICT(usuario_id) 
            DO UPDATE SET edad = excluded.edad, estatura = excluded.estatura, gustos = excluded.gustos, disgustos = excluded.disgustos, enfermedades = excluded.enfermedades`,
      args: [
        usuario_id, 
        edad || null, 
        estatura || null, 
        gustos ? gustos.trim() : "", 
        disgustos ? disgustos.trim() : "", 
        enfermedades ? enfermedades.trim() : ""
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
    const perfilRes = await db.execute({ sql: "SELECT edad, estatura, gustos, disgustos, enfermedades FROM perfiles_clientes WHERE usuario_id = ?", args: [req.params.id] });
    const perfil = perfilRes.rows.length > 0 ? perfilRes.rows[0] : { edad: null, estatura: null, gustos: "", disgustos: "", enfermedades: "" };

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
        p.foto_url, p.bio, p.especialidad, p.logros, p.tarifa_base, p.whatsapp
      FROM usuarios u
      LEFT JOIN perfiles_coach_publicos p ON p.usuario_id = u.id
      LEFT JOIN suscripciones_coach s ON s.usuario_id = u.id
      WHERE u.rol IN ('COACH', 'SUPERADMIN')
        AND (p.visible_en_directorio IS NULL OR p.visible_en_directorio = 1)
        AND (
          u.rol = 'SUPERADMIN'
          OR s.usuario_id IS NULL
          OR s.status IN ('active', 'trialing')
        )
      ORDER BY u.calificacion DESC, u.nombre ASC
    `);
    res.json(result.rows || []);
  } catch (err) {
    console.error("Error directorio coaches:", err.message);
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
      sql: "SELECT foto_url, bio, especialidad, logros, tarifa_base, whatsapp, visible_en_directorio FROM perfiles_coach_publicos WHERE usuario_id = ?",
      args: [req.params.usuario_id]
    });
    const perfil = perfilRes.rows[0] || {
      foto_url: '', bio: '', especialidad: '', logros: '', tarifa_base: null, whatsapp: '', visible_en_directorio: 1
    };
    res.json({ usuario: user, perfil });
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
      sql: `INSERT INTO perfiles_coach_publicos (usuario_id, foto_url, bio, especialidad, logros, tarifa_base, whatsapp, visible_en_directorio)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    res.json({ mensaje: "Perfil público guardado" });
  } catch (err) {
    console.error("Error guardar perfil coach:", err.message);
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
      const coachRes = await db.execute({ sql: "SELECT id FROM usuarios WHERE codigo_invitacion = ?", args: [codigoIngresado.toUpperCase()] });
      if (coachRes.rows.length === 0) return res.status(400).json({ error: "El código de Coach que ingresaste no es válido." });
      await db.execute({ sql: query, args: [nombre, emailLimpio, hash, 'CLIENTE', null, coachRes.rows[0].id] });
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