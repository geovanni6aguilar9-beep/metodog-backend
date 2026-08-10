const crypto = require("crypto");

/** Sube cuando cambia la lógica/prompt del informe → invalida caché Turso sin tocar volumen. */
const INFORME_IA_VERSION = "v4-recom-seguimiento";
const VEREDICTO_MEDIDAS_IA_VERSION = "v1-humano-estructurado";

function fingerprintGrupos(grupos = [], balanceScore = 0, rutinaFingerprint = "") {
  const lista = (grupos || [])
    .map((g) => ({
      g: String(g.grupo || ""),
      s: Number(g.series || 0),
      t: Math.round(Number(g.tonelaje || 0))
    }))
    .sort((a, b) => a.g.localeCompare(b.g));
  const raw = JSON.stringify({
    b: balanceScore,
    lista,
    r: rutinaFingerprint || "",
    pv: INFORME_IA_VERSION
  });
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function fingerprintMedidasVeredicto(payload = {}) {
  const raw = JSON.stringify({
    v: VEREDICTO_MEDIDAS_IA_VERSION,
    a: payload.actual || null,
    d1: payload.dia1 || null,
    ant: payload.anterior || null,
    d: payload.deltas || {}
  });
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

async function leerInformeCache(db, usuarioId, mes) {
  const uid = parseInt(usuarioId, 10);
  if (!uid || !mes) return null;
  try {
    const r = await db.execute({
      sql: `SELECT fingerprint, opinion, siguiente_paso, recomendaciones, created_at
            FROM informes_anatomia_ia WHERE usuario_id = ? AND mes = ?`,
      args: [uid, String(mes)]
    });
    const row = r.rows[0];
    if (!row) return null;
    return {
      fingerprint: row.fingerprint,
      opinion: row.opinion,
      siguiente_paso: JSON.parse(row.siguiente_paso || "[]"),
      recomendaciones: JSON.parse(row.recomendaciones || "[]"),
      created_at: row.created_at
    };
  } catch (err) {
    console.warn("[informeIaCache] leer:", err?.message);
    return null;
  }
}

async function guardarInformeCache(db, usuarioId, mes, fingerprint, resultado) {
  const uid = parseInt(usuarioId, 10);
  if (!uid || !mes || !resultado?.ok) return;
  try {
    await db.execute({
      sql: `INSERT INTO informes_anatomia_ia (
              usuario_id, mes, fingerprint, opinion, siguiente_paso, recomendaciones, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(usuario_id, mes) DO UPDATE SET
              fingerprint = excluded.fingerprint,
              opinion = excluded.opinion,
              siguiente_paso = excluded.siguiente_paso,
              recomendaciones = excluded.recomendaciones,
              updated_at = datetime('now')`,
      args: [
        uid,
        String(mes),
        fingerprint,
        resultado.opinion || "",
        JSON.stringify(resultado.siguiente_paso || []),
        JSON.stringify(resultado.recomendaciones || [])
      ]
    });
  } catch (err) {
    console.warn("[informeIaCache] guardar:", err?.message);
  }
}

async function ensureTablaVeredictosMedidasIa(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS veredictos_medidas_ia (
    usuario_id INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    titulo TEXT NOT NULL DEFAULT '',
    tono TEXT NOT NULL DEFAULT 'ok',
    resumen TEXT NOT NULL DEFAULT '',
    lo_bueno TEXT NOT NULL DEFAULT '[]',
    cuidado TEXT NOT NULL DEFAULT '[]',
    que_hacer TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id, fingerprint),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
}

async function leerVeredictoMedidasCache(db, usuarioId, fingerprint) {
  const uid = parseInt(usuarioId, 10);
  if (!uid || !fingerprint) return null;
  try {
    const r = await db.execute({
      sql: `SELECT titulo, tono, resumen, lo_bueno, cuidado, que_hacer, created_at
            FROM veredictos_medidas_ia WHERE usuario_id = ? AND fingerprint = ?`,
      args: [uid, String(fingerprint)]
    });
    const row = r.rows[0];
    if (!row) return null;
    return {
      titulo: row.titulo,
      tono: row.tono,
      resumen: row.resumen,
      lo_bueno: JSON.parse(row.lo_bueno || "[]"),
      cuidado: JSON.parse(row.cuidado || "[]"),
      que_hacer: JSON.parse(row.que_hacer || "[]"),
      created_at: row.created_at
    };
  } catch (err) {
    console.warn("[informeIaCache] leer medidas:", err?.message);
    return null;
  }
}

async function guardarVeredictoMedidasCache(db, usuarioId, fingerprint, resultado) {
  const uid = parseInt(usuarioId, 10);
  if (!uid || !fingerprint || !resultado?.ok) return;
  try {
    await db.execute({
      sql: `INSERT INTO veredictos_medidas_ia (
              usuario_id, fingerprint, titulo, tono, resumen, lo_bueno, cuidado, que_hacer, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(usuario_id, fingerprint) DO UPDATE SET
              titulo = excluded.titulo,
              tono = excluded.tono,
              resumen = excluded.resumen,
              lo_bueno = excluded.lo_bueno,
              cuidado = excluded.cuidado,
              que_hacer = excluded.que_hacer,
              updated_at = datetime('now')`,
      args: [
        uid,
        String(fingerprint),
        resultado.titulo || "",
        resultado.tono || "ok",
        resultado.resumen || "",
        JSON.stringify(resultado.lo_bueno || []),
        JSON.stringify(resultado.cuidado || []),
        JSON.stringify(resultado.que_hacer || [])
      ]
    });
  } catch (err) {
    console.warn("[informeIaCache] guardar medidas:", err?.message);
  }
}

module.exports = {
  fingerprintGrupos,
  leerInformeCache,
  guardarInformeCache,
  fingerprintMedidasVeredicto,
  ensureTablaVeredictosMedidasIa,
  leerVeredictoMedidasCache,
  guardarVeredictoMedidasCache
};
