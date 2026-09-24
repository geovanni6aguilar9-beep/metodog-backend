/**
 * Timeline de planes (Fase C): fecha_asignacion ≠ última edición.
 * Se setea en el primer INSERT; no se pisa en updates normales.
 */

async function ensureColumnasFechaAsignacionPlanes(db) {
  for (const sql of [
    'ALTER TABLE rutinas ADD COLUMN fecha_asignacion TEXT',
    'ALTER TABLE dietas ADD COLUMN fecha_asignacion TEXT'
  ]) {
    try {
      await db.execute(sql);
    } catch {
      /* ya existe */
    }
  }
  try {
    await db.execute(`
      UPDATE rutinas
      SET fecha_asignacion = COALESCE(fecha_asignacion, ultima_actualizacion, datetime('now'))
      WHERE fecha_asignacion IS NULL OR TRIM(fecha_asignacion) = ''
    `);
  } catch {
    /* ignore */
  }
  try {
    await db.execute(`
      UPDATE dietas
      SET fecha_asignacion = COALESCE(fecha_asignacion, ultima_actualizacion, datetime('now'))
      WHERE fecha_asignacion IS NULL OR TRIM(fecha_asignacion) = ''
    `);
  } catch {
    /* ignore */
  }
}

/**
 * Reinicia el conteo del ciclo (nuevo meso / nueva dieta).
 * @param {'rutina'|'dieta'} tipo
 */
async function reiniciarFechaAsignacionPlan(db, { usuarioId, tipo }) {
  const uid = parseInt(usuarioId, 10);
  if (!uid) return { ok: false, status: 400, error: 'Usuario inválido.' };
  const t = String(tipo || '').toLowerCase();
  if (t !== 'rutina' && t !== 'dieta') {
    return { ok: false, status: 400, error: 'Tipo debe ser rutina o dieta.' };
  }
  const tabla = t === 'rutina' ? 'rutinas' : 'dietas';
  const upd = await db.execute({
    sql: `UPDATE ${tabla}
          SET fecha_asignacion = datetime('now'),
              ultima_actualizacion = datetime('now')
          WHERE usuario_id = ?`,
    args: [uid]
  });
  if ((upd.rowsAffected ?? 0) === 0) {
    return { ok: false, status: 404, error: `No hay ${t} asignada para reiniciar.` };
  }
  const row = await db.execute({
    sql: `SELECT fecha_asignacion, ultima_actualizacion FROM ${tabla} WHERE usuario_id = ?`,
    args: [uid]
  });
  return {
    ok: true,
    tipo: t,
    fecha_asignacion: row.rows[0]?.fecha_asignacion || null,
    ultima_actualizacion: row.rows[0]?.ultima_actualizacion || null
  };
}

module.exports = {
  ensureColumnasFechaAsignacionPlanes,
  reiniciarFechaAsignacionPlan
};
