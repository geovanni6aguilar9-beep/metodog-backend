/** Fotos de progreso corporal — data URL JPEG en Turso (sin Blob storage). */

const VISTAS = new Set(["frente", "lado", "espalda"]);
const MAX_FOTOS_POR_USUARIO = 36;
const MAX_IMAGEN_CHARS = 520_000; // ~390 KB data URL

async function ensureTablaFotosProgreso(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS fotos_progreso (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    vista TEXT NOT NULL DEFAULT 'frente',
    nota TEXT,
    fecha TEXT NOT NULL,
    imagen TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_fotos_progreso_usuario_fecha
     ON fotos_progreso(usuario_id, fecha DESC, id DESC)`
  );
}

function normalizarVista(raw) {
  const v = String(raw || "frente")
    .trim()
    .toLowerCase();
  return VISTAS.has(v) ? v : "frente";
}

function normalizarFechaFoto(raw) {
  const s = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s || Date.now());
  if (Number.isNaN(d.getTime())) {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = String(hoy.getMonth() + 1).padStart(2, "0");
    const day = String(hoy.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function validarImagenDataUrl(imagen) {
  const s = String(imagen || "").trim();
  if (!s.startsWith("data:image/")) {
    return { ok: false, error: "La foto debe ser una imagen válida." };
  }
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(s)) {
    return { ok: false, error: "Formato no soportado. Usa JPG o PNG." };
  }
  if (s.length > MAX_IMAGEN_CHARS) {
    return { ok: false, error: "La foto es muy pesada. Prueba otra más ligera." };
  }
  return { ok: true, imagen: s };
}

function filaPublica(row) {
  return {
    id: Number(row.id),
    usuario_id: Number(row.usuario_id),
    vista: row.vista || "frente",
    nota: row.nota || "",
    fecha: row.fecha,
    imagen: row.imagen,
    created_at: row.created_at || null
  };
}

async function listarFotosProgreso(db, usuarioId) {
  const r = await db.execute({
    sql: `SELECT id, usuario_id, vista, nota, fecha, imagen, created_at
          FROM fotos_progreso
          WHERE usuario_id = ?
          ORDER BY fecha DESC, id DESC
          LIMIT ?`,
    args: [usuarioId, MAX_FOTOS_POR_USUARIO]
  });
  return (r.rows || []).map(filaPublica);
}

async function contarFotosProgreso(db, usuarioId) {
  const r = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM fotos_progreso WHERE usuario_id = ?",
    args: [usuarioId]
  });
  return Number(r.rows[0]?.n || 0);
}

async function crearFotoProgreso(db, { usuarioId, vista, nota, fecha, imagen, createdBy }) {
  const n = await contarFotosProgreso(db, usuarioId);
  if (n >= MAX_FOTOS_POR_USUARIO) {
    return {
      ok: false,
      status: 400,
      error: `Límite de ${MAX_FOTOS_POR_USUARIO} fotos. Borra alguna para subir otra.`
    };
  }
  const check = validarImagenDataUrl(imagen);
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  const vistaN = normalizarVista(vista);
  const fechaN = normalizarFechaFoto(fecha);
  const notaN = String(nota || "").trim().slice(0, 120);

  const ins = await db.execute({
    sql: `INSERT INTO fotos_progreso (usuario_id, vista, nota, fecha, imagen, created_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [usuarioId, vistaN, notaN || null, fechaN, check.imagen, createdBy || null]
  });

  if ((ins.rowsAffected ?? 0) === 0) {
    return { ok: false, status: 500, error: "No se pudo guardar la foto." };
  }

  const last = await db.execute({
    sql: `SELECT id, usuario_id, vista, nota, fecha, imagen, created_at
          FROM fotos_progreso WHERE usuario_id = ?
          ORDER BY id DESC LIMIT 1`,
    args: [usuarioId]
  });
  if (!last.rows?.length) {
    return { ok: false, status: 500, error: "Foto guardada pero no se pudo leer." };
  }
  return { ok: true, foto: filaPublica(last.rows[0]) };
}

async function borrarFotoProgreso(db, { usuarioId, fotoId }) {
  const r = await db.execute({
    sql: "DELETE FROM fotos_progreso WHERE id = ? AND usuario_id = ?",
    args: [fotoId, usuarioId]
  });
  const affected = Number(r.rowsAffected ?? r.rows?.length ?? 0);
  if (!affected) {
    return { ok: false, status: 404, error: "Foto no encontrada." };
  }
  return { ok: true };
}

module.exports = {
  ensureTablaFotosProgreso,
  listarFotosProgreso,
  crearFotoProgreso,
  borrarFotoProgreso,
  MAX_FOTOS_POR_USUARIO,
  MAX_IMAGEN_CHARS
};
