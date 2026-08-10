/**
 * Plantillas de rutina reutilizables por coach (semana + notas).
 * No toca la fila `rutinas` del alumno — biblioteca aparte.
 */

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MAX_PLANTILLAS_COACH = 40;
const MAX_NOMBRE = 80;
const MAX_JSON_BYTES = 900 * 1024;

async function ensureTablaPlantillasRutinaCoach(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS plantillas_rutina_coach (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coach_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    datos_rutina TEXT NOT NULL,
    notas_generales TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(coach_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_plantillas_rutina_coach_owner
     ON plantillas_rutina_coach(coach_id)`
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

function ejercicioTieneNombre(ej) {
  return String(ej?.nombre || "").trim().length > 0;
}

function limpiarEjercicioPlantilla(ej) {
  if (!ej || typeof ej !== "object") return null;
  const nombre = String(ej.nombre || "").trim();
  if (!nombre) return null;
  const setsRaw = Array.isArray(ej.sets) ? ej.sets : null;
  const sets = setsRaw
    ? setsRaw.map((s) => ({
        kg: s?.kg != null ? String(s.kg) : "",
        reps: s?.reps != null ? String(s.reps) : "",
        completado: false
      }))
    : undefined;
  const out = {
    id: ej.id || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    grupo: ej.grupo || "Otros",
    nombre,
    nota: ej.nota != null ? String(ej.nota) : "",
    link: ej.link != null ? String(ej.link) : "",
    series: ej.series != null ? String(ej.series) : "3",
    reps: ej.reps != null ? String(ej.reps) : "10",
    rir: ej.rir != null ? String(ej.rir) : "",
    peso: ej.peso != null ? String(ej.peso) : "",
    bloque: ej.bloque ?? null,
    colorId: ej.colorId ?? null
  };
  if (ej.descansoSeg != null && Number.isFinite(Number(ej.descansoSeg))) {
    out.descansoSeg = Number(ej.descansoSeg);
  }
  if (sets) out.sets = sets;
  return out;
}

/** Normaliza semana: solo días válidos; ejercicios limpios (sin checks de sesión). */
function normalizarDatosRutinaPlantilla(datos) {
  const src = parseJsonSafe(datos, {});
  const out = {};
  let totalEj = 0;
  for (const dia of DIAS) {
    const lista = Array.isArray(src[dia]) ? src[dia] : [];
    out[dia] = lista.map(limpiarEjercicioPlantilla).filter(Boolean);
    totalEj += out[dia].length;
  }
  if (src._meta && typeof src._meta === "object") {
    out._meta = { ...src._meta };
  }
  return { datos: out, totalEj };
}

function normalizarNotasPlantilla(notas) {
  const src = parseJsonSafe(notas, {});
  const out = {};
  for (const dia of DIAS) {
    out[dia] = src[dia] != null ? String(src[dia]) : "";
  }
  return out;
}

function resumenDias(datos) {
  return DIAS.filter((d) => (datos[d] || []).some(ejercicioTieneNombre));
}

function filaADto(row) {
  const datos = parseJsonSafe(row.datos_rutina, {});
  const notas = parseJsonSafe(row.notas_generales, {});
  const dias = resumenDias(datos);
  let total = 0;
  for (const d of DIAS) total += (datos[d] || []).length;
  return {
    id: Number(row.id),
    coach_id: Number(row.coach_id),
    nombre: row.nombre,
    datos_rutina: datos,
    notas_generales: notas,
    dias,
    total_ejercicios: total,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function listarPlantillasRutinaCoach(db, coachId) {
  const r = await db.execute({
    sql: `SELECT id, coach_id, nombre, datos_rutina, notas_generales, created_at, updated_at
          FROM plantillas_rutina_coach
          WHERE coach_id = ?
          ORDER BY updated_at DESC, id DESC`,
    args: [coachId]
  });
  return (r.rows || []).map(filaADto);
}

async function obtenerPlantillaRutinaCoach(db, coachId, id) {
  const r = await db.execute({
    sql: `SELECT id, coach_id, nombre, datos_rutina, notas_generales, created_at, updated_at
          FROM plantillas_rutina_coach
          WHERE id = ? AND coach_id = ?`,
    args: [id, coachId]
  });
  if (!r.rows?.[0]) return null;
  return filaADto(r.rows[0]);
}

async function crearPlantillaRutinaCoach(db, coachId, body) {
  const nombre = String(body?.nombre || "").trim().slice(0, MAX_NOMBRE);
  if (nombre.length < 2) {
    return { ok: false, status: 400, error: "Pon un nombre a la plantilla (mín. 2 caracteres)." };
  }

  const { datos, totalEj } = normalizarDatosRutinaPlantilla(body?.datos_rutina);
  if (totalEj < 1) {
    return { ok: false, status: 400, error: "La plantilla necesita al menos un ejercicio." };
  }
  const notas = normalizarNotasPlantilla(body?.notas_generales);
  if (datos._meta) {
    datos._meta = { ...datos._meta, nombre_plantilla: nombre };
  } else {
    datos._meta = { nombre_plantilla: nombre };
  }

  const jsonDatos = JSON.stringify(datos);
  const jsonNotas = JSON.stringify(notas);
  if (jsonDatos.length + jsonNotas.length > MAX_JSON_BYTES) {
    return { ok: false, status: 400, error: "La rutina es demasiado grande para guardar como plantilla." };
  }

  const count = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM plantillas_rutina_coach WHERE coach_id = ?",
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
    sql: `INSERT INTO plantillas_rutina_coach (coach_id, nombre, datos_rutina, notas_generales, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    args: [coachId, nombre, jsonDatos, jsonNotas]
  });
  const newId = Number(ins.lastInsertRowid);
  if (!newId) {
    return { ok: false, status: 500, error: "No se pudo crear la plantilla." };
  }
  const created = await obtenerPlantillaRutinaCoach(db, coachId, newId);
  if (!created) {
    return { ok: false, status: 500, error: "Plantilla creada pero no legible." };
  }
  return { ok: true, plantilla: created };
}

async function renombrarPlantillaRutinaCoach(db, coachId, id, nombreRaw) {
  const nombre = String(nombreRaw || "").trim().slice(0, MAX_NOMBRE);
  if (nombre.length < 2) {
    return { ok: false, status: 400, error: "Nombre inválido." };
  }
  const upd = await db.execute({
    sql: `UPDATE plantillas_rutina_coach
          SET nombre = ?, updated_at = datetime('now')
          WHERE id = ? AND coach_id = ?`,
    args: [nombre, id, coachId]
  });
  if (!upd.rowsAffected) {
    return { ok: false, status: 404, error: "Plantilla no encontrada." };
  }
  const fresh = await obtenerPlantillaRutinaCoach(db, coachId, id);
  return { ok: true, plantilla: fresh };
}

async function borrarPlantillaRutinaCoach(db, coachId, id) {
  const del = await db.execute({
    sql: "DELETE FROM plantillas_rutina_coach WHERE id = ? AND coach_id = ?",
    args: [id, coachId]
  });
  if (!del.rowsAffected) {
    return { ok: false, status: 404, error: "Plantilla no encontrada." };
  }
  return { ok: true, id };
}

module.exports = {
  ensureTablaPlantillasRutinaCoach,
  listarPlantillasRutinaCoach,
  obtenerPlantillaRutinaCoach,
  crearPlantillaRutinaCoach,
  renombrarPlantillaRutinaCoach,
  borrarPlantillaRutinaCoach,
  MAX_PLANTILLAS_COACH,
  DIAS
};
