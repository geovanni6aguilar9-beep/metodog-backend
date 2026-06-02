/** CORS: en producción restringir a FRONTEND_URL / CORS_ORIGINS (coma-separado). */

function parseOrigins() {
  const raw = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "").trim();
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

function isProduction() {
  return (
    process.env.NODE_ENV === "production" ||
    !!process.env.RENDER ||
    !!(process.env.TURSO_DATABASE_URL || "").startsWith("https://")
  );
}

function buildCorsOptions() {
  const allowed = parseOrigins();

  if (!isProduction() || allowed.length === 0) {
    if (isProduction() && allowed.length === 0) {
      console.warn(
        "⚠️ CORS: define FRONTEND_URL o CORS_ORIGINS en Render (ej. https://tu-app.vercel.app). Aceptando cualquier origen por ahora."
      );
    }
    return {};
  }

  console.log(`🔒 CORS: orígenes permitidos → ${allowed.join(", ")}`);

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error(`CORS bloqueado: ${origin}`));
    },
    credentials: true
  };
}

module.exports = { buildCorsOptions, parseOrigins, isProduction };
