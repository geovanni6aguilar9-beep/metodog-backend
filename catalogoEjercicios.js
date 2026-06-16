/** Catálogo overrides ejercicio → grupo (Turso). Sync con frontend exerciseCatalog.js */

const GRUPOS_VALIDOS = new Set([
  "Pectoral", "Espalda", "Hombro", "Bíceps", "Tríceps",
  "Cuádriceps", "Isquiosurales", "Glúteo", "Pantorrilla", "Otros"
]);

function normalizarNombreEjercicio(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function filasAMapa(filas = []) {
  const out = {};
  for (const row of filas) {
    const norm = row.nombre_norm || normalizarNombreEjercicio(row.nombre_display);
    const grupo = String(row.grupo || "").trim();
    if (norm && GRUPOS_VALIDOS.has(grupo)) out[norm] = grupo;
  }
  return out;
}

async function obtenerCoachIdDeUsuario(db, usuarioId) {
  const r = await db.execute({
    sql: "SELECT coach_id FROM usuarios WHERE id = ? LIMIT 1",
    args: [usuarioId]
  });
  const cid = r.rows?.[0]?.coach_id;
  return cid != null ? Number(cid) : null;
}

async function listarOverridesScope(db, ownerId, scope) {
  if (!ownerId) return [];
  const r = await db.execute({
    sql: `SELECT nombre_norm, nombre_display, grupo FROM catalogo_ejercicios_grupo
          WHERE owner_id = ? AND scope = ?`,
    args: [ownerId, scope]
  });
  return r.rows || [];
}

/** Coach + cliente del atleta; cliente gana sobre coach en merged. */
async function obtenerOverridesParaUsuario(db, usuarioId) {
  const coachId = await obtenerCoachIdDeUsuario(db, usuarioId);
  const coachFilas = coachId
    ? await listarOverridesScope(db, coachId, "coach")
    : [];
  const clienteFilas = await listarOverridesScope(db, usuarioId, "cliente");

  const coach = filasAMapa(coachFilas);
  const cliente = filasAMapa(clienteFilas);
  const merged = { ...coach, ...cliente };

  return { coach, cliente, merged, coach_id: coachId };
}

async function upsertOverride(db, { ownerId, scope, nombre, grupo }) {
  const nombreDisplay = String(nombre || "").trim();
  const nombreNorm = normalizarNombreEjercicio(nombreDisplay);
  const grupoStr = String(grupo || "").trim();
  if (!ownerId || !nombreNorm || !GRUPOS_VALIDOS.has(grupoStr)) {
    return { ok: false, error: "owner_id, nombre y grupo válido son obligatorios" };
  }

  await db.execute({
    sql: `INSERT INTO catalogo_ejercicios_grupo (owner_id, scope, nombre_norm, nombre_display, grupo, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(owner_id, scope, nombre_norm) DO UPDATE SET
            nombre_display = excluded.nombre_display,
            grupo = excluded.grupo,
            updated_at = CURRENT_TIMESTAMP`,
    args: [ownerId, scope, nombreNorm, nombreDisplay, grupoStr]
  });

  return { ok: true, nombre_norm: nombreNorm, grupo: grupoStr };
}

module.exports = {
  GRUPOS_VALIDOS,
  normalizarNombreEjercicio,
  obtenerOverridesParaUsuario,
  upsertOverride
};
