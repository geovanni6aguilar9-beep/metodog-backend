#!/usr/bin/env node
/**
 * Carga el programa Meso 2 en Turso SOLO para la cuenta SUPERADMIN.
 *
 * Uso (desde backend/):
 *   node seed-superadmin-rutina.js
 *
 * Requiere backend/.env con TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) o USE_LOCAL_DB=true
 */
require("dotenv").config({ quiet: true });
const path = require("path");
const { createClient } = require("@libsql/client");
const { SUPERADMIN_EMAIL, buildMeso2Payload, PROGRAMA_MESO2 } = require("./data/programa-meso2-geovanni");

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
    throw new Error("TURSO_DATABASE_URL vacío. Usa USE_LOCAL_DB=true o credenciales Turso.");
  }
  if (url.startsWith("libsql://")) url = url.replace("libsql://", "https://");
  console.log(`☁️ BD Turso: ${url.split("?")[0]}`);
  return createClient({ url, authToken });
}

async function main() {
  const db = crearClienteDB();
  const email = (process.env.SEED_SUPERADMIN_EMAIL || SUPERADMIN_EMAIL).toLowerCase().trim();

  const userRes = await db.execute({
    sql: "SELECT id, nombre, email, rol FROM usuarios WHERE LOWER(email) = ?",
    args: [email]
  });

  if (userRes.rows.length === 0) {
    console.error(`❌ No existe usuario con email: ${email}`);
    process.exit(1);
  }

  const user = userRes.rows[0];
  if (user.rol !== "SUPERADMIN") {
    console.error(`❌ ${email} tiene rol ${user.rol}, no SUPERADMIN. Abortado.`);
    process.exit(1);
  }

  const usuarioId = Number(user.id);
  const { datos_rutina, notas_generales } = buildMeso2Payload(PROGRAMA_MESO2);

  const totalEjercicios = Object.keys(datos_rutina)
    .filter((k) => !k.startsWith("_"))
    .reduce((acc, d) => acc + (datos_rutina[d]?.length || 0), 0);

  await db.execute({
    sql: `INSERT INTO rutinas (usuario_id, datos_rutina, notas_generales, ultima_actualizacion)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(usuario_id) DO UPDATE SET
            datos_rutina = excluded.datos_rutina,
            notas_generales = excluded.notas_generales,
            ultima_actualizacion = datetime('now')`,
    args: [usuarioId, JSON.stringify(datos_rutina), JSON.stringify(notas_generales)]
  });

  console.log("✅ Rutina Meso 2 cargada");
  console.log(`   Usuario: ${user.nombre} (${user.email}) id=${usuarioId}`);
  console.log(`   Programa: ${PROGRAMA_MESO2.nombre_rutina}`);
  console.log(`   Ejercicios: ${totalEjercicios} en 6 sesiones (Lun–Sáb)`);
  console.log(`   Check-in: ${PROGRAMA_MESO2.preguntas_checkin.length} preguntas en _meta`);
  console.log("\n📱 En la app: Rutinas → ENTRENAR (o EDITOR para ajustar). Check-in al final de la semana.");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
