/** Cuota Combo IA freemium — Turso (no localStorage). */

const MAX_COMBOS_GRATIS = 2;

async function ensureTablaCuotaComboIa(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS cuota_combo_ia (
    usuario_id INTEGER PRIMARY KEY,
    usados INTEGER NOT NULL DEFAULT 0,
    max_gratis INTEGER NOT NULL DEFAULT ${MAX_COMBOS_GRATIS},
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
}

async function leerFilaCuota(db, userId) {
  const uid = parseInt(userId, 10);
  if (!uid || Number.isNaN(uid)) return null;
  await ensureTablaCuotaComboIa(db);
  let r = await db.execute({
    sql: "SELECT usuario_id, usados, max_gratis FROM cuota_combo_ia WHERE usuario_id = ?",
    args: [uid]
  });
  if (!r.rows?.length) {
    await db.execute({
      sql: `INSERT INTO cuota_combo_ia (usuario_id, usados, max_gratis) VALUES (?, 0, ?)
            ON CONFLICT(usuario_id) DO NOTHING`,
      args: [uid, MAX_COMBOS_GRATIS]
    });
    r = await db.execute({
      sql: "SELECT usuario_id, usados, max_gratis FROM cuota_combo_ia WHERE usuario_id = ?",
      args: [uid]
    });
  } else {
    const maxActual = parseInt(r.rows[0]?.max_gratis, 10) || 0;
    if (maxActual !== MAX_COMBOS_GRATIS) {
      await db.execute({
        sql: `UPDATE cuota_combo_ia SET max_gratis = ?, updated_at = datetime('now')
              WHERE usuario_id = ?`,
        args: [MAX_COMBOS_GRATIS, uid]
      });
      r = await db.execute({
        sql: "SELECT usuario_id, usados, max_gratis FROM cuota_combo_ia WHERE usuario_id = ?",
        args: [uid]
      });
    }
  }
  return r.rows?.[0] || null;
}

function restantesDesdeFila(fila) {
  if (!fila) return 0;
  const max = Math.max(0, parseInt(fila.max_gratis, 10) || MAX_COMBOS_GRATIS);
  const usados = Math.max(0, parseInt(fila.usados, 10) || 0);
  return Math.max(0, max - usados);
}

/** Estado de cuota (sin mutar). */
async function estadoCuotaComboIa(db, userId) {
  const fila = await leerFilaCuota(db, userId);
  const max = Math.max(0, parseInt(fila?.max_gratis, 10) || MAX_COMBOS_GRATIS);
  const usados = Math.max(0, parseInt(fila?.usados, 10) || 0);
  const restantes = Math.max(0, max - usados);
  return { ok: true, max, usados, restantes, ilimitado: false };
}

/**
 * Reserva 1 uso atómico. Si falla la IA, llamar liberarReservaCuotaComboIa.
 * @returns {{ ok: boolean, restantes?: number, motivo?: string }}
 */
async function reservarCuotaComboIa(db, userId) {
  const uid = parseInt(userId, 10);
  if (!uid || Number.isNaN(uid)) return { ok: false, motivo: "usuario_invalido" };
  await leerFilaCuota(db, uid);
  const upd = await db.execute({
    sql: `UPDATE cuota_combo_ia
          SET usados = usados + 1, updated_at = datetime('now')
          WHERE usuario_id = ? AND usados < max_gratis`,
    args: [uid]
  });
  const affected = Number(upd.rowsAffected || 0);
  if (!affected) {
    const est = await estadoCuotaComboIa(db, uid);
    return { ok: false, motivo: "sin_cuota", restantes: est.restantes, max: est.max };
  }
  const est = await estadoCuotaComboIa(db, uid);
  return { ok: true, restantes: est.restantes, max: est.max, usados: est.usados };
}

/** Devuelve 1 uso si Gemini falló tras reservar. */
async function liberarReservaCuotaComboIa(db, userId) {
  const uid = parseInt(userId, 10);
  if (!uid || Number.isNaN(uid)) return;
  try {
    await db.execute({
      sql: `UPDATE cuota_combo_ia
            SET usados = CASE WHEN usados > 0 THEN usados - 1 ELSE 0 END,
                updated_at = datetime('now')
            WHERE usuario_id = ?`,
      args: [uid]
    });
  } catch (err) {
    console.warn("[cuota-combo] liberar:", err?.message);
  }
}

module.exports = {
  MAX_COMBOS_GRATIS,
  ensureTablaCuotaComboIa,
  estadoCuotaComboIa,
  reservarCuotaComboIa,
  liberarReservaCuotaComboIa,
  restantesDesdeFila
};
