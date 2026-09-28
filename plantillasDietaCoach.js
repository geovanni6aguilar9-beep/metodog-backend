/**
 * Plantillas de dieta reutilizables por coach (comidas + macros objetivo + notas).
 * No toca la fila `dietas` del alumno — biblioteca aparte.
 */

const MAX_PLANTILLAS_COACH = 40;
const MAX_NOMBRE = 80;
const MAX_JSON_BYTES = 900 * 1024;

async function ensureTablaPlantillasDietaCoach(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS plantillas_dieta_coach (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coach_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    datos_dieta TEXT NOT NULL,
    macros_totales TEXT NOT NULL DEFAULT '{}',
    notas_dieta TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(coach_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_plantillas_dieta_coach_owner
     ON plantillas_dieta_coach(coach_id)`
  );
}

function parseJsonSafe(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function limpiarAlimentoPlantilla(a) {
  if (!a || typeof a !== "object") return null;
  const nombre = String(a.nombre || "").trim();
  if (!nombre) return null;
  const out = { ...a, nombre };
  delete out._importado;
  delete out._sinMacros;
  delete out._match_metodo;
  delete out._nombre_catalogo;
  return out;
}

function normalizarDatosDietaPlantilla(datos) {
  const src = Array.isArray(datos) ? datos : parseJsonSafe(datos, []);
  if (!Array.isArray(src)) return { comidas: [], totalAlimentos: 0 };
  let totalAlimentos = 0;
  const comidas = src
    .map((c, idx) => {
      if (!c || typeof c !== "object") return null;
      const alimentos = (Array.isArray(c.alimentos) ? c.alimentos : [])
        .map(limpiarAlimentoPlantilla)
        .filter(Boolean);
      totalAlimentos += alimentos.length;
      const nombre = String(c.nombre || "").trim() || `Comida ${idx + 1}`;
      return {
        id: c.id != null ? Number(c.id) || idx + 1 : idx + 1,
        nombre,
        alimentos
      };
    })
    .filter(Boolean);
  return { comidas, totalAlimentos };
}

function normalizarMacrosPlantilla(macros) {
  const src = parseJsonSafe(macros, {});
  if (!src || typeof src !== "object") return {};
  const objetivos =
    src.objetivos && typeof src.objetivos === "object" ? { ...src.objetivos } : null;
  return objetivos ? { objetivos } : {};
}

function normalizarNotasPlantilla(notas) {
  if (notas == null) return "";
  if (typeof notas === "string") return notas.slice(0, 4000);
  const parsed = parseJsonSafe(notas, null);
  if (typeof parsed === "string") return parsed.slice(0, 4000);
  if (parsed && typeof parsed === "object" && parsed.texto != null) {
    return String(parsed.texto).slice(0, 4000);
  }
  return String(notas).slice(0, 4000);
}

function filaADto(row) {
  const comidas = parseJsonSafe(row.datos_dieta, []);
  const macros = parseJsonSafe(row.macros_totales, {});
  let totalAlimentos = 0;
  if (Array.isArray(comidas)) {
    for (const c of comidas) totalAlimentos += (c?.alimentos || []).length;
  }
  return {
    id: Number(row.id),
    coach_id: Number(row.coach_id),
    nombre: row.nombre,
    datos_dieta: Array.isArray(comidas) ? comidas : [],
    macros_totales: macros && typeof macros === "object" ? macros : {},
    notas_dieta: row.notas_dieta != null ? String(row.notas_dieta) : "",
    num_comidas: Array.isArray(comidas) ? comidas.length : 0,
    total_alimentos: totalAlimentos,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function listarPlantillasDietaCoach(db, coachId) {
  const r = await db.execute({
    sql: `SELECT id, coach_id, nombre, datos_dieta, macros_totales, notas_dieta, created_at, updated_at
          FROM plantillas_dieta_coach
          WHERE coach_id = ?
          ORDER BY updated_at DESC, id DESC`,
    args: [coachId]
  });
  return (r.rows || []).map(filaADto);
}

async function obtenerPlantillaDietaCoach(db, coachId, id) {
  const r = await db.execute({
    sql: `SELECT id, coach_id, nombre, datos_dieta, macros_totales, notas_dieta, created_at, updated_at
          FROM plantillas_dieta_coach
          WHERE id = ? AND coach_id = ?`,
    args: [id, coachId]
  });
  if (!r.rows?.[0]) return null;
  return filaADto(r.rows[0]);
}

async function crearPlantillaDietaCoach(db, coachId, body) {
  const nombre = String(body?.nombre || "").trim().slice(0, MAX_NOMBRE);
  if (nombre.length < 2) {
    return { ok: false, status: 400, error: "Pon un nombre a la plantilla (mín. 2 caracteres)." };
  }

  const { comidas, totalAlimentos } = normalizarDatosDietaPlantilla(body?.datos_dieta);
  if (totalAlimentos < 1) {
    return { ok: false, status: 400, error: "La plantilla necesita al menos un alimento." };
  }
  const macros = normalizarMacrosPlantilla(body?.macros_totales);
  const notas = normalizarNotasPlantilla(body?.notas_dieta);

  const jsonDatos = JSON.stringify(comidas);
  const jsonMacros = JSON.stringify(macros);
  if (jsonDatos.length + jsonMacros.length + notas.length > MAX_JSON_BYTES) {
    return { ok: false, status: 400, error: "La dieta es demasiado grande para guardar como plantilla." };
  }

  const count = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM plantillas_dieta_coach WHERE coach_id = ?",
    args: [coachId]
  });
  const n = Number(count.rows?.[0]?.n || 0);
  if (n >= MAX_PLANTILLAS_COACH) {
    return {
      ok: false,
      status: 400,
      error: `Máximo ${MAX_PLANTILLAS_COACH} plantillas. Borra alguna para guardar otra.`
    };
  }

  const ins = await db.execute({
    sql: `INSERT INTO plantillas_dieta_coach
          (coach_id, nombre, datos_dieta, macros_totales, notas_dieta, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    args: [coachId, nombre, jsonDatos, jsonMacros, notas]
  });
  const newId = Number(ins.lastInsertRowid || ins.meta?.last_insert_rowid || 0);
  if (!newId) {
    return { ok: false, status: 500, error: "No se pudo crear la plantilla." };
  }
  const created = await obtenerPlantillaDietaCoach(db, coachId, newId);
  if (!created) {
    return { ok: false, status: 500, error: "Plantilla creada pero no legible." };
  }
  return { ok: true, plantilla: created };
}

async function renombrarPlantillaDietaCoach(db, coachId, id, nombreRaw) {
  const nombre = String(nombreRaw || "").trim().slice(0, MAX_NOMBRE);
  if (nombre.length < 2) {
    return { ok: false, status: 400, error: "Nombre inválido." };
  }
  const upd = await db.execute({
    sql: `UPDATE plantillas_dieta_coach
          SET nombre = ?, updated_at = datetime('now')
          WHERE id = ? AND coach_id = ?`,
    args: [nombre, id, coachId]
  });
  if (!(upd.rowsAffected ?? upd.meta?.rows_affected ?? 0)) {
    return { ok: false, status: 404, error: "Plantilla no encontrada." };
  }
  const fresh = await obtenerPlantillaDietaCoach(db, coachId, id);
  return { ok: true, plantilla: fresh };
}

async function borrarPlantillaDietaCoach(db, coachId, id) {
  const del = await db.execute({
    sql: "DELETE FROM plantillas_dieta_coach WHERE id = ? AND coach_id = ?",
    args: [id, coachId]
  });
  if (!(del.rowsAffected ?? del.meta?.rows_affected ?? 0)) {
    return { ok: false, status: 404, error: "Plantilla no encontrada." };
  }
  return { ok: true, id };
}

module.exports = {
  ensureTablaPlantillasDietaCoach,
  listarPlantillasDietaCoach,
  obtenerPlantillaDietaCoach,
  crearPlantillaDietaCoach,
  renombrarPlantillaDietaCoach,
  borrarPlantillaDietaCoach,
  MAX_PLANTILLAS_COACH
};
