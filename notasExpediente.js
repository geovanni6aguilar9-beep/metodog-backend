/**
 * Bitácora clínica del coach sobre un alumno (expediente).
 * No es notas_dieta / notas_ejercicio — timeline de consulta.
 */

const MAX_TEXTO = 2000;
const MAX_NOTAS_LISTA = 80;

async function ensureTablaNotasExpediente(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS notas_expediente (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL,
    coach_id INTEGER NOT NULL,
    texto TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(cliente_id) REFERENCES usuarios(id),
    FOREIGN KEY(coach_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_notas_expediente_cliente
     ON notas_expediente(cliente_id, created_at DESC, id DESC)`
  );
}

function mapNota(row) {
  return {
    id: row.id,
    cliente_id: row.cliente_id,
    coach_id: row.coach_id,
    coach_nombre: row.coach_nombre || null,
    texto: row.texto || '',
    created_at: row.created_at || null
  };
}

async function listarNotasExpediente(db, clienteId) {
  const r = await db.execute({
    sql: `SELECT n.id, n.cliente_id, n.coach_id, n.texto, n.created_at,
                 u.nombre AS coach_nombre
          FROM notas_expediente n
          LEFT JOIN usuarios u ON u.id = n.coach_id
          WHERE n.cliente_id = ?
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT ?`,
    args: [clienteId, MAX_NOTAS_LISTA]
  });
  return (r.rows || []).map(mapNota);
}

async function crearNotaExpediente(db, { clienteId, coachId, texto }) {
  const t = String(texto || '').trim();
  if (t.length < 2) {
    return { ok: false, status: 400, error: 'Escribe una nota (mín. 2 caracteres).' };
  }
  if (t.length > MAX_TEXTO) {
    return { ok: false, status: 400, error: `Máximo ${MAX_TEXTO} caracteres.` };
  }
  const cid = parseInt(clienteId, 10);
  const aid = parseInt(coachId, 10);
  if (!cid || !aid) {
    return { ok: false, status: 400, error: 'Datos inválidos.' };
  }

  const ins = await db.execute({
    sql: `INSERT INTO notas_expediente (cliente_id, coach_id, texto)
          VALUES (?, ?, ?)`,
    args: [cid, aid, t]
  });
  if ((ins.rowsAffected ?? 0) === 0) {
    return { ok: false, status: 500, error: 'No se pudo guardar la nota.' };
  }
  const id = Number(ins.lastInsertRowid);
  const one = await db.execute({
    sql: `SELECT n.id, n.cliente_id, n.coach_id, n.texto, n.created_at,
                 u.nombre AS coach_nombre
          FROM notas_expediente n
          LEFT JOIN usuarios u ON u.id = n.coach_id
          WHERE n.id = ? AND n.cliente_id = ?`,
    args: [id, cid]
  });
  if (!one.rows?.length) {
    return { ok: false, status: 500, error: 'Nota guardada pero no se pudo leer.' };
  }
  return { ok: true, nota: mapNota(one.rows[0]) };
}

async function borrarNotaExpediente(db, { clienteId, notaId, coachId, esAdmin }) {
  const nid = parseInt(notaId, 10);
  const cid = parseInt(clienteId, 10);
  if (!nid || !cid) {
    return { ok: false, status: 400, error: 'ID inválido.' };
  }
  const hit = await db.execute({
    sql: 'SELECT id, coach_id FROM notas_expediente WHERE id = ? AND cliente_id = ?',
    args: [nid, cid]
  });
  if (!hit.rows?.length) {
    return { ok: false, status: 404, error: 'Nota no encontrada.' };
  }
  const author = Number(hit.rows[0].coach_id);
  if (!esAdmin && author !== Number(coachId)) {
    return { ok: false, status: 403, error: 'Solo puedes borrar tus propias notas.' };
  }
  const del = await db.execute({
    sql: 'DELETE FROM notas_expediente WHERE id = ? AND cliente_id = ?',
    args: [nid, cid]
  });
  if ((del.rowsAffected ?? 0) === 0) {
    return { ok: false, status: 500, error: 'No se pudo borrar.' };
  }
  return { ok: true };
}

module.exports = {
  ensureTablaNotasExpediente,
  listarNotasExpediente,
  crearNotaExpediente,
  borrarNotaExpediente
};
