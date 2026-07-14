/** Cuota import PDF/plan con IA freemium — Turso (beta: 3 intentos). Carril import rutina.
 * Solo se descuenta al ÉXITO (Gemini OK). Fallos / red / multitarea no queman intentos.
 * Tabla v2: limpia quemas del bug reserva-al-iniciar.
 */

const MAX_IMPORT_PLAN_IA_GRATIS = 3;
const TABLA = "cuota_import_plan_ia_v2";

async function ensureTablaCuotaImportPlanIa(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS ${TABLA} (
    usuario_id INTEGER PRIMARY KEY,
    usados INTEGER NOT NULL DEFAULT 0,
    max_gratis INTEGER NOT NULL DEFAULT ${MAX_IMPORT_PLAN_IA_GRATIS},
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
}

async function leerFilaCuotaImportPlanIa(db, userId) {
  const uid = parseInt(userId, 10);
  if (!uid || Number.isNaN(uid)) return null;
  await ensureTablaCuotaImportPlanIa(db);
  let r = await db.execute({
    sql: `SELECT usuario_id, usados, max_gratis FROM ${TABLA} WHERE usuario_id = ?`,
    args: [uid]
  });
  if (!r.rows?.length) {
    await db.execute({
      sql: `INSERT INTO ${TABLA} (usuario_id, usados, max_gratis) VALUES (?, 0, ?)
            ON CONFLICT(usuario_id) DO NOTHING`,
      args: [uid, MAX_IMPORT_PLAN_IA_GRATIS]
    });
    r = await db.execute({
      sql: `SELECT usuario_id, usados, max_gratis FROM ${TABLA} WHERE usuario_id = ?`,
      args: [uid]
    });
  }
  return r.rows?.[0] || null;
}

async function estadoCuotaImportPlanIa(db, userId) {
  const fila = await leerFilaCuotaImportPlanIa(db, userId);
  const max = Math.max(0, parseInt(fila?.max_gratis, 10) || MAX_IMPORT_PLAN_IA_GRATIS);
  const usados = Math.max(0, parseInt(fila?.usados, 10) || 0);
  const restantes = Math.max(0, max - usados);
  return { ok: true, max, usados, restantes, ilimitado: false };
}

/** ¿Puede intentar? No muta. */
async function puedeIntentarImportPlanIa(db, userId) {
  const est = await estadoCuotaImportPlanIa(db, userId);
  if (est.restantes <= 0) {
    return { ok: false, motivo: "sin_cuota", restantes: 0, max: est.max };
  }
  return { ok: true, restantes: est.restantes, max: est.max };
}

/** Consume 1 intento solo tras Gemini OK (atómico). */
async function consumirCuotaImportPlanIa(db, userId) {
  const uid = parseInt(userId, 10);
  if (!uid || Number.isNaN(uid)) return { ok: false, motivo: "usuario_invalido" };
  await leerFilaCuotaImportPlanIa(db, uid);
  const upd = await db.execute({
    sql: `UPDATE ${TABLA}
          SET usados = usados + 1, updated_at = datetime('now')
          WHERE usuario_id = ? AND usados < max_gratis`,
    args: [uid]
  });
  const affected = Number(upd.rowsAffected || 0);
  if (!affected) {
    const est = await estadoCuotaImportPlanIa(db, uid);
    return { ok: false, motivo: "sin_cuota", restantes: est.restantes, max: est.max };
  }
  const est = await estadoCuotaImportPlanIa(db, uid);
  return { ok: true, restantes: est.restantes, max: est.max, usados: est.usados };
}

/** @deprecated alias — no reservar al inicio */
async function reservarCuotaImportPlanIa(db, userId) {
  return puedeIntentarImportPlanIa(db, userId);
}

/** @deprecated no-op: ya no hay reserva anticipada */
async function liberarReservaCuotaImportPlanIa() {
  /* no-op */
}

module.exports = {
  MAX_IMPORT_PLAN_IA_GRATIS,
  ensureTablaCuotaImportPlanIa,
  estadoCuotaImportPlanIa,
  puedeIntentarImportPlanIa,
  consumirCuotaImportPlanIa,
  reservarCuotaImportPlanIa,
  liberarReservaCuotaImportPlanIa
};
