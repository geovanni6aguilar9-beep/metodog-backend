/**
 * Biblioteca de platillos del coach.
 * Una comida (foto, línea, preparación, ingredientes). No pisa la dieta del alumno.
 * Al usarlo se copia: cambiar gramos en un atleta no mueve a los demás.
 */

const MAX_PLATILLOS = 40;
const MAX_NOMBRE = 60;
const MAX_JSON_BYTES = 420 * 1024;

async function ensureTablaPlatillosCoach(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS platillos_coach (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coach_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    preparacion TEXT NOT NULL DEFAULT '',
    foto TEXT NOT NULL DEFAULT '',
    alimentos TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(coach_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_platillos_coach_owner ON platillos_coach(coach_id)`
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

function limpiarAlimento(a) {
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

function normalizarPlatillo(body) {
  const nombre = String(body?.nombre || "").trim().slice(0, MAX_NOMBRE);
  const descripcion = String(body?.descripcion || "").trim().slice(0, 90);
  const preparacion = String(body?.preparacion || "").trim().slice(0, 500);
  const fotoRaw = String(body?.foto || "");
  const foto = fotoRaw.startsWith("data:image/") ? fotoRaw.slice(0, 300000) : "";
  const src = Array.isArray(body?.alimentos) ? body.alimentos : [];
  const alimentos = src.map(limpiarAlimento).filter(Boolean);
  return { nombre, descripcion, preparacion, foto, alimentos };
}

function kcalDe(alimentos) {
  let cal = 0;
  for (const a of alimentos || []) {
    const base = parseFloat(a?.porcion_base) || 1;
    const cant = parseFloat(a?.cantidadSeleccionada);
    const f = (Number.isFinite(cant) ? cant : base) / (base || 1);
    cal += (parseFloat(a?.calorias) || 0) * f;
  }
  return Math.round(cal);
}

function filaADto(row) {
  const alimentos = parseJsonSafe(row.alimentos, []);
  const lista = Array.isArray(alimentos) ? alimentos : [];
  return {
    id: Number(row.id),
    coach_id: Number(row.coach_id),
    nombre: row.nombre,
    descripcion: row.descripcion != null ? String(row.descripcion) : "",
    preparacion: row.preparacion != null ? String(row.preparacion) : "",
    foto: row.foto != null ? String(row.foto) : "",
    alimentos: lista,
    total_alimentos: lista.length,
    kcal: kcalDe(lista),
    updated_at: row.updated_at
  };
}

async function listarPlatillosCoach(db, coachId) {
  const r = await db.execute({
    sql: `SELECT id, coach_id, nombre, descripcion, preparacion, foto, alimentos, updated_at
          FROM platillos_coach
          WHERE coach_id = ?
          ORDER BY updated_at DESC, id DESC`,
    args: [coachId]
  });
  return (r.rows || []).map(filaADto);
}

async function obtenerPlatilloCoach(db, coachId, id) {
  const r = await db.execute({
    sql: `SELECT id, coach_id, nombre, descripcion, preparacion, foto, alimentos, updated_at
          FROM platillos_coach
          WHERE id = ? AND coach_id = ?`,
    args: [id, coachId]
  });
  if (!r.rows?.[0]) return null;
  return filaADto(r.rows[0]);
}

async function crearPlatilloCoach(db, coachId, body) {
  const platillo = normalizarPlatillo(body);
  if (platillo.nombre.length < 2) {
    return { ok: false, status: 400, error: "Pon un nombre al platillo." };
  }
  if (platillo.alimentos.length < 1) {
    return { ok: false, status: 400, error: "El platillo necesita al menos un alimento." };
  }
  const json = JSON.stringify(platillo.alimentos);
  if (json.length + platillo.foto.length > MAX_JSON_BYTES) {
    return { ok: false, status: 400, error: "El platillo pesa demasiado. Usa una foto más simple." };
  }

  const count = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM platillos_coach WHERE coach_id = ?",
    args: [coachId]
  });
  const n = Number(count.rows?.[0]?.n || 0);
  if (n >= MAX_PLATILLOS) {
    return {
      ok: false,
      status: 400,
      error: `Máximo ${MAX_PLATILLOS} platillos. Borra alguno para guardar otro.`
    };
  }

  const ins = await db.execute({
    sql: `INSERT INTO platillos_coach
          (coach_id, nombre, descripcion, preparacion, foto, alimentos, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    args: [
      coachId,
      platillo.nombre,
      platillo.descripcion,
      platillo.preparacion,
      platillo.foto,
      json
    ]
  });
  const newId = Number(ins.lastInsertRowid || ins.meta?.last_insert_rowid || 0);
  if (!newId) return { ok: false, status: 500, error: "No se pudo guardar el platillo." };
  const created = await obtenerPlatilloCoach(db, coachId, newId);
  if (!created) return { ok: false, status: 500, error: "Platillo guardado pero no legible." };
  return { ok: true, platillo: created };
}

async function borrarPlatilloCoach(db, coachId, id) {
  const del = await db.execute({
    sql: "DELETE FROM platillos_coach WHERE id = ? AND coach_id = ?",
    args: [id, coachId]
  });
  if (!(del.rowsAffected ?? del.meta?.rows_affected ?? 0)) {
    return { ok: false, status: 404, error: "Platillo no encontrado." };
  }
  return { ok: true, id };
}

module.exports = {
  ensureTablaPlatillosCoach,
  listarPlatillosCoach,
  obtenerPlatilloCoach,
  crearPlatilloCoach,
  borrarPlatilloCoach,
  MAX_PLATILLOS
};
