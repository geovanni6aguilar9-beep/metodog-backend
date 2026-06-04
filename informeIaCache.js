const crypto = require("crypto");

/** Sube cuando cambia la lógica/prompt del informe → invalida caché Turso sin tocar volumen. */
const INFORME_IA_VERSION = "v3-corte-parcial";

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

module.exports = {
  fingerprintGrupos,
  leerInformeCache,
  guardarInformeCache
};
