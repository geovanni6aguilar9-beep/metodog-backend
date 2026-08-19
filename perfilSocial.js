/**
 * Perfil social del atleta — separado del expediente clínico.
 * Lesiones, dieta, medidas y plan del coach NUNCA salen por estas rutas.
 */

const crypto = require("crypto");
const { crearNotificacion } = require("./notificaciones");
const { deduplicarFilasHistorialFuerza } = require("./fuerzaHistorial");

const MAX_FOTO_CHARS = 520_000;
const MAX_VITRINA = 6;
const MODOS = new Set(["cerrado", "codigo", "alias"]);
const ALIAS_RE = /^[a-z0-9_]{3,20}$/;

async function ensureTablasPerfilSocial(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS perfiles_sociales (
    usuario_id INTEGER PRIMARY KEY,
    alias TEXT NOT NULL UNIQUE,
    codigo TEXT NOT NULL UNIQUE,
    foto TEXT,
    modo_entrada TEXT NOT NULL DEFAULT 'cerrado',
    mostrar_foto INTEGER NOT NULL DEFAULT 1,
    mostrar_prs INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_perfiles_sociales_alias ON perfiles_sociales(alias)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_perfiles_sociales_codigo ON perfiles_sociales(codigo)`
  );

  await db.execute(`CREATE TABLE IF NOT EXISTS social_solicitudes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    de_id INTEGER NOT NULL,
    para_id INTEGER NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(de_id, para_id),
    FOREIGN KEY(de_id) REFERENCES usuarios(id),
    FOREIGN KEY(para_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_solicitudes_para
     ON social_solicitudes(para_id, estado)`
  );

  await db.execute(`CREATE TABLE IF NOT EXISTS social_bloqueos (
    blocker_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_id, blocked_id),
    FOREIGN KEY(blocker_id) REFERENCES usuarios(id),
    FOREIGN KEY(blocked_id) REFERENCES usuarios(id)
  )`);

  try {
    await db.execute(
      "ALTER TABLE perfiles_sociales ADD COLUMN mostrar_vitrina INTEGER DEFAULT 0"
    );
  } catch (_) { /* ya existe */ }

  await db.execute(`CREATE TABLE IF NOT EXISTS social_vitrina (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    imagen TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_vitrina_user
     ON social_vitrina(usuario_id, id DESC)`
  );
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function slugAlias(raw, fallback) {
  const base = String(raw || fallback || "atleta")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
  if (base.length >= 3) return base;
  const fb = String(fallback || "atleta")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 16);
  return (fb.length >= 3 ? fb : "atleta").slice(0, 20);
}

function codigoNuevo() {
  return crypto.randomBytes(4).toString("hex").slice(0, 8).toUpperCase();
}

function validarFoto(imagen) {
  const s = String(imagen || "").trim();
  if (!s.startsWith("data:image/")) {
    return { ok: false, error: "La foto debe ser una imagen válida." };
  }
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(s)) {
    return { ok: false, error: "Formato no soportado. Usa JPG o PNG." };
  }
  if (s.length > MAX_FOTO_CHARS) {
    return { ok: false, error: "La foto es muy pesada. Prueba otra más ligera." };
  }
  return { ok: true, imagen: s };
}

async function edadUsuario(db, userId) {
  const r = await db.execute({
    sql: "SELECT edad FROM perfiles_clientes WHERE usuario_id = ?",
    args: [userId]
  });
  const edad = toNum(r.rows?.[0]?.edad);
  return edad != null && edad > 0 ? edad : null;
}

async function esMenorOSinEdad(db, userId) {
  const edad = await edadUsuario(db, userId);
  if (edad == null) return true;
  return edad < 18;
}

async function rolEsCliente(db, userId) {
  const r = await db.execute({
    sql: "SELECT rol FROM usuarios WHERE id = ?",
    args: [userId]
  });
  return String(r.rows?.[0]?.rol || "").toUpperCase() === "CLIENTE";
}

async function aliasLibre(db, alias, exceptUserId) {
  const r = await db.execute({
    sql: exceptUserId
      ? "SELECT usuario_id FROM perfiles_sociales WHERE alias = ? AND usuario_id != ?"
      : "SELECT usuario_id FROM perfiles_sociales WHERE alias = ?",
    args: exceptUserId ? [alias, exceptUserId] : [alias]
  });
  return !r.rows?.length;
}

async function generarAliasUnico(db, nombre, userId) {
  let alias = slugAlias(nombre, `atleta${userId}`);
  if (await aliasLibre(db, alias, userId)) return alias;
  for (let i = 2; i < 80; i++) {
    const cand = `${alias.slice(0, 16)}${i}`.slice(0, 20);
    if (await aliasLibre(db, cand, userId)) return cand;
  }
  return `atleta${userId}`.slice(0, 20);
}

async function generarCodigoUnico(db) {
  for (let i = 0; i < 12; i++) {
    const codigo = codigoNuevo();
    const r = await db.execute({
      sql: "SELECT usuario_id FROM perfiles_sociales WHERE codigo = ?",
      args: [codigo]
    });
    if (!r.rows?.length) return codigo;
  }
  return `${Date.now().toString(36)}`.slice(-8).toUpperCase();
}

async function asegurarPerfil(db, userId, nombre) {
  const existing = await db.execute({
    sql: `SELECT usuario_id, alias, codigo, foto, modo_entrada, mostrar_foto, mostrar_prs, mostrar_vitrina
          FROM perfiles_sociales WHERE usuario_id = ?`,
    args: [userId]
  });
  if (existing.rows?.[0]) return existing.rows[0];

  const alias = await generarAliasUnico(db, nombre, userId);
  const codigo = await generarCodigoUnico(db);
  await db.execute({
    sql: `INSERT INTO perfiles_sociales
          (usuario_id, alias, codigo, modo_entrada, mostrar_foto, mostrar_prs, mostrar_vitrina, updated_at)
          VALUES (?, ?, ?, 'cerrado', 1, 1, 0, datetime('now'))`,
    args: [userId, alias, codigo]
  });
  const fresh = await db.execute({
    sql: `SELECT usuario_id, alias, codigo, foto, modo_entrada, mostrar_foto, mostrar_prs, mostrar_vitrina
          FROM perfiles_sociales WHERE usuario_id = ?`,
    args: [userId]
  });
  return fresh.rows[0];
}

async function hayBloqueo(db, a, b) {
  const r = await db.execute({
    sql: `SELECT 1 FROM social_bloqueos
          WHERE (blocker_id = ? AND blocked_id = ?)
             OR (blocker_id = ? AND blocked_id = ?)
          LIMIT 1`,
    args: [a, b, b, a]
  });
  return !!r.rows?.length;
}

async function amistadAceptada(db, a, b) {
  const r = await db.execute({
    sql: `SELECT id FROM social_solicitudes
          WHERE estado = 'aceptada'
            AND ((de_id = ? AND para_id = ?) OR (de_id = ? AND para_id = ?))
          LIMIT 1`,
    args: [a, b, b, a]
  });
  return !!r.rows?.[0];
}

async function listarVitrina(db, userId) {
  const r = await db.execute({
    sql: `SELECT id, imagen, created_at FROM social_vitrina
          WHERE usuario_id = ? ORDER BY id DESC LIMIT ?`,
    args: [userId, MAX_VITRINA]
  });
  return (r.rows || []).map((row) => ({
    id: toNum(row.id),
    imagen: row.imagen,
    created_at: row.created_at
  }));
}

async function resumenFuerzaPublicable(db, userId) {
  const result = await db.execute({
    sql: `SELECT id, ejercicio, peso, reps, numero_serie, dia_rutina, fecha
          FROM historial_fuerza WHERE usuario_id = ? ORDER BY fecha ASC, id ASC LIMIT 1000`,
    args: [userId]
  });
  const historial = deduplicarFilasHistorialFuerza(
    (result.rows || []).map((row) => ({ ...row, usuario_id: userId }))
  );
  const dias = new Set(
    historial.map((h) => String(h.fecha || "").slice(0, 10)).filter(Boolean)
  );
  const porEj = new Map();
  for (const h of historial) {
    const nombre = String(h.ejercicio || "").trim();
    const peso = Number(h.peso);
    const reps = Number(h.reps);
    if (!nombre || !(peso > 0)) continue;
    const prev = porEj.get(nombre);
    const score = peso * (reps > 0 ? reps : 1);
    if (!prev || score > prev.score) {
      porEj.set(nombre, {
        ejercicio: nombre,
        peso: Math.round(peso * 10) / 10,
        reps: reps > 0 ? Math.round(reps) : null,
        score
      });
    }
  }
  const mejores = [...porEj.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ ejercicio, peso, reps }) => ({ ejercicio, peso, reps }));
  return {
    sesiones: dias.size,
    series: historial.length,
    mejores
  };
}

function filaAPerfilPropio(row, { menor, resumen, vitrina }) {
  return {
    usuario_id: toNum(row.usuario_id),
    alias: row.alias,
    codigo: row.codigo,
    foto: row.foto || null,
    modo_entrada: MODOS.has(row.modo_entrada) ? row.modo_entrada : "cerrado",
    mostrar_foto: Number(row.mostrar_foto) === 1,
    mostrar_prs: Number(row.mostrar_prs) === 1,
    mostrar_vitrina: Number(row.mostrar_vitrina) === 1,
    menor: !!menor,
    social_activa: !menor,
    resumen: resumen || { sesiones: 0, series: 0, mejores: [] },
    vitrina: vitrina || []
  };
}

async function obtenerYo(db, user, nombre) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El perfil social es para atletas." };
  }
  const menor = await esMenorOSinEdad(db, user.id);
  const row = await asegurarPerfil(db, user.id, nombre || user.nombre);
  const resumen = menor ? { sesiones: 0, series: 0, mejores: [] } : await resumenFuerzaPublicable(db, user.id);
  const vitrina = menor ? [] : await listarVitrina(db, user.id);
  return { ok: true, perfil: filaAPerfilPropio(row, { menor, resumen, vitrina }) };
}

async function guardarYo(db, user, body) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El perfil social es para atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: false, status: 403, error: "El perfil social está cerrado hasta los 18 años." };
  }
  await asegurarPerfil(db, user.id, user.nombre);

  const patch = [];
  const args = [];

  if (body.alias != null) {
    const alias = slugAlias(body.alias, "");
    if (!ALIAS_RE.test(alias)) {
      return { ok: false, status: 400, error: "Alias: 3–20 letras, números o _." };
    }
    if (!(await aliasLibre(db, alias, user.id))) {
      return { ok: false, status: 409, error: "Ese alias ya está tomado." };
    }
    patch.push("alias = ?");
    args.push(alias);
  }

  if (body.modo_entrada != null) {
    const modo = String(body.modo_entrada || "").trim();
    if (!MODOS.has(modo)) {
      return { ok: false, status: 400, error: "Modo de entrada inválido." };
    }
    patch.push("modo_entrada = ?");
    args.push(modo);
  }

  if (body.mostrar_foto != null) {
    patch.push("mostrar_foto = ?");
    args.push(body.mostrar_foto ? 1 : 0);
  }
  if (body.mostrar_prs != null) {
    patch.push("mostrar_prs = ?");
    args.push(body.mostrar_prs ? 1 : 0);
  }
  if (body.mostrar_vitrina != null) {
    patch.push("mostrar_vitrina = ?");
    args.push(body.mostrar_vitrina ? 1 : 0);
  }

  if (!patch.length) {
    return obtenerYo(db, user, user.nombre);
  }

  args.push(user.id);
  const upd = await db.execute({
    sql: `UPDATE perfiles_sociales SET ${patch.join(", ")}, updated_at = datetime('now')
          WHERE usuario_id = ?`,
    args
  });
  if (!(upd.rowsAffected > 0)) {
    return { ok: false, status: 500, error: "No se pudo guardar." };
  }
  return obtenerYo(db, user, user.nombre);
}

async function guardarFoto(db, user, imagen) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El perfil social es para atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: false, status: 403, error: "El perfil social está cerrado hasta los 18 años." };
  }
  const v = validarFoto(imagen);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  await asegurarPerfil(db, user.id, user.nombre);
  const upd = await db.execute({
    sql: `UPDATE perfiles_sociales SET foto = ?, updated_at = datetime('now') WHERE usuario_id = ?`,
    args: [v.imagen, user.id]
  });
  if (!(upd.rowsAffected > 0)) {
    return { ok: false, status: 500, error: "No se pudo guardar la foto." };
  }
  return obtenerYo(db, user, user.nombre);
}

async function borrarFoto(db, user) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El perfil social es para atletas." };
  }
  await db.execute({
    sql: `UPDATE perfiles_sociales SET foto = NULL, updated_at = datetime('now') WHERE usuario_id = ?`,
    args: [user.id]
  });
  return obtenerYo(db, user, user.nombre);
}

async function agregarVitrina(db, user, imagen) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El perfil social es para atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: false, status: 403, error: "El perfil social está cerrado hasta los 18 años." };
  }
  const v = validarFoto(imagen);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  await asegurarPerfil(db, user.id, user.nombre);
  const cnt = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM social_vitrina WHERE usuario_id = ?",
    args: [user.id]
  });
  if (Number(cnt.rows?.[0]?.n || 0) >= MAX_VITRINA) {
    return { ok: false, status: 400, error: `Máximo ${MAX_VITRINA} fotos en la vitrina.` };
  }
  const ins = await db.execute({
    sql: "INSERT INTO social_vitrina (usuario_id, imagen) VALUES (?, ?)",
    args: [user.id, v.imagen]
  });
  if (!(ins.rowsAffected > 0)) {
    return { ok: false, status: 500, error: "No se pudo subir." };
  }
  return obtenerYo(db, user, user.nombre);
}

async function borrarVitrina(db, user, fotoId) {
  const id = toNum(fotoId);
  if (!id) return { ok: false, status: 400, error: "Foto inválida." };
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El perfil social es para atletas." };
  }
  const del = await db.execute({
    sql: "DELETE FROM social_vitrina WHERE id = ? AND usuario_id = ?",
    args: [id, user.id]
  });
  if (!(del.rowsAffected > 0)) {
    return { ok: false, status: 404, error: "No se encontró esa foto." };
  }
  return obtenerYo(db, user, user.nombre);
}

async function listarEnlaces(db, userId) {
  const menor = await esMenorOSinEdad(db, userId);
  if (menor) {
    return { ok: true, pendientes: [], enviadas: [], companeros: [], bloqueados: [] };
  }

  const pend = await db.execute({
    sql: `SELECT s.id, s.de_id, p.alias, s.created_at
          FROM social_solicitudes s
          JOIN perfiles_sociales p ON p.usuario_id = s.de_id
          WHERE s.para_id = ? AND s.estado = 'pendiente'
          ORDER BY s.created_at DESC`,
    args: [userId]
  });
  const env = await db.execute({
    sql: `SELECT s.id, s.para_id, p.alias, s.created_at
          FROM social_solicitudes s
          JOIN perfiles_sociales p ON p.usuario_id = s.para_id
          WHERE s.de_id = ? AND s.estado = 'pendiente'
          ORDER BY s.created_at DESC`,
    args: [userId]
  });
  const amigos = await db.execute({
    sql: `SELECT s.id,
                 CASE WHEN s.de_id = ? THEN s.para_id ELSE s.de_id END AS user_id,
                 p.alias,
                 CASE WHEN p.mostrar_foto = 1 THEN p.foto ELSE NULL END AS foto
          FROM social_solicitudes s
          JOIN perfiles_sociales p
            ON p.usuario_id = CASE WHEN s.de_id = ? THEN s.para_id ELSE s.de_id END
          WHERE s.estado = 'aceptada' AND (s.de_id = ? OR s.para_id = ?)
          ORDER BY p.alias ASC`,
    args: [userId, userId, userId, userId]
  });
  const bloq = await db.execute({
    sql: `SELECT b.blocked_id AS user_id, p.alias
          FROM social_bloqueos b
          LEFT JOIN perfiles_sociales p ON p.usuario_id = b.blocked_id
          WHERE b.blocker_id = ?
          ORDER BY p.alias ASC`,
    args: [userId]
  });

  return {
    ok: true,
    pendientes: (pend.rows || []).map((r) => ({
      id: toNum(r.id),
      user_id: toNum(r.de_id),
      alias: r.alias
    })),
    enviadas: (env.rows || []).map((r) => ({
      id: toNum(r.id),
      user_id: toNum(r.para_id),
      alias: r.alias
    })),
    companeros: (amigos.rows || []).map((r) => ({
      id: toNum(r.id),
      user_id: toNum(r.user_id),
      alias: r.alias,
      foto: r.foto || null
    })),
    bloqueados: (bloq.rows || []).map((r) => ({
      user_id: toNum(r.user_id),
      alias: r.alias || "—"
    }))
  };
}

async function solicitar(db, user, { alias, codigo }) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El perfil social es para atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: false, status: 403, error: "El perfil social está cerrado hasta los 18 años." };
  }
  await asegurarPerfil(db, user.id, user.nombre);

  const clave = String(codigo || "").trim().toUpperCase();
  const ali = slugAlias(alias || "", "");
  if (!clave && !ALIAS_RE.test(ali)) {
    return { ok: false, status: 400, error: "Escribe un alias o un código." };
  }

  let target;
  if (clave) {
    const r = await db.execute({
      sql: `SELECT usuario_id, alias, modo_entrada FROM perfiles_sociales WHERE codigo = ?`,
      args: [clave]
    });
    target = r.rows?.[0];
  } else {
    const r = await db.execute({
      sql: `SELECT usuario_id, alias, modo_entrada FROM perfiles_sociales WHERE alias = ?`,
      args: [ali]
    });
    target = r.rows?.[0];
  }

  if (!target) {
    return { ok: false, status: 404, error: "No hay nadie con ese alias o código." };
  }
  const paraId = toNum(target.usuario_id);
  if (paraId === user.id) {
    return { ok: false, status: 400, error: "Ese es tu propio perfil." };
  }
  if (!(await rolEsCliente(db, paraId))) {
    return { ok: false, status: 404, error: "No hay nadie con ese alias o código." };
  }
  if (await esMenorOSinEdad(db, paraId)) {
    return { ok: false, status: 404, error: "No hay nadie con ese alias o código." };
  }
  if (await hayBloqueo(db, user.id, paraId)) {
    return { ok: false, status: 403, error: "No puedes agregar a esa persona." };
  }

  const modo = String(target.modo_entrada || "cerrado");
  if (modo === "cerrado") {
    return { ok: false, status: 403, error: "Esa persona no acepta solicitudes." };
  }
  if (modo === "codigo" && !clave) {
    return { ok: false, status: 403, error: "Esa persona solo se agrega con su código." };
  }
  if (modo === "alias" && !clave && !ALIAS_RE.test(ali)) {
    return { ok: false, status: 403, error: "Esa persona no acepta solicitudes." };
  }

  const prev = await db.execute({
    sql: `SELECT id, estado, de_id, para_id FROM social_solicitudes
          WHERE (de_id = ? AND para_id = ?) OR (de_id = ? AND para_id = ?)`,
    args: [user.id, paraId, paraId, user.id]
  });
  const existente = prev.rows?.[0];
  if (existente) {
    if (existente.estado === "aceptada") {
      return { ok: false, status: 409, error: "Ya son compañeros." };
    }
    if (existente.estado === "pendiente") {
      return { ok: false, status: 409, error: "Ya hay una solicitud en curso." };
    }
    await db.execute({
      sql: `UPDATE social_solicitudes
            SET de_id = ?, para_id = ?, estado = 'pendiente', updated_at = datetime('now')
            WHERE id = ?`,
      args: [user.id, paraId, existente.id]
    });
  } else {
    await db.execute({
      sql: `INSERT INTO social_solicitudes (de_id, para_id, estado, updated_at)
            VALUES (?, ?, 'pendiente', datetime('now'))`,
      args: [user.id, paraId]
    });
  }

  const yo = await db.execute({
    sql: "SELECT alias FROM perfiles_sociales WHERE usuario_id = ?",
    args: [user.id]
  });
  const miAlias = yo.rows?.[0]?.alias || "Alguien";
  try {
    await crearNotificacion(db, {
      usuarioId: paraId,
      tipo: "social_solicitud",
      titulo: "Solicitud de perfil",
      cuerpo: `${miAlias} quiere ver tu perfil.`,
      refTipo: "social_solicitud",
      refId: user.id
    });
  } catch (err) {
    console.warn("notif social_solicitud:", err.message);
  }

  return { ok: true };
}

async function responderSolicitud(db, user, solicitudId, aceptar) {
  const id = toNum(solicitudId);
  if (!id) return { ok: false, status: 400, error: "Solicitud inválida." };
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: false, status: 403, error: "El perfil social está cerrado hasta los 18 años." };
  }

  const r = await db.execute({
    sql: `SELECT id, de_id, para_id, estado FROM social_solicitudes WHERE id = ?`,
    args: [id]
  });
  const row = r.rows?.[0];
  if (!row || toNum(row.para_id) !== user.id) {
    return { ok: false, status: 404, error: "Solicitud no encontrada." };
  }
  if (row.estado !== "pendiente") {
    return { ok: false, status: 409, error: "Esa solicitud ya no está pendiente." };
  }
  const deId = toNum(row.de_id);
  if (await hayBloqueo(db, user.id, deId)) {
    return { ok: false, status: 403, error: "No puedes aceptar a esa persona." };
  }

  const estado = aceptar ? "aceptada" : "rechazada";
  const upd = await db.execute({
    sql: `UPDATE social_solicitudes SET estado = ?, updated_at = datetime('now') WHERE id = ? AND para_id = ?`,
    args: [estado, id, user.id]
  });
  if (!(upd.rowsAffected > 0)) {
    return { ok: false, status: 500, error: "No se pudo actualizar." };
  }

  if (aceptar) {
    const yo = await db.execute({
      sql: "SELECT alias FROM perfiles_sociales WHERE usuario_id = ?",
      args: [user.id]
    });
    try {
      await crearNotificacion(db, {
        usuarioId: deId,
        tipo: "social_aceptada",
        titulo: "Perfil aceptado",
        cuerpo: `${yo.rows?.[0]?.alias || "Alguien"} aceptó verte.`,
        refTipo: "social_aceptada",
        refId: user.id
      });
    } catch (err) {
      console.warn("notif social_aceptada:", err.message);
    }
  }
  return { ok: true };
}

async function quitarCompanero(db, user, otherId) {
  const oid = toNum(otherId);
  if (!oid || oid === user.id) return { ok: false, status: 400, error: "Usuario inválido." };
  const del = await db.execute({
    sql: `DELETE FROM social_solicitudes
          WHERE (de_id = ? AND para_id = ?) OR (de_id = ? AND para_id = ?)`,
    args: [user.id, oid, oid, user.id]
  });
  if (!(del.rowsAffected > 0)) {
    return { ok: false, status: 404, error: "No había vínculo." };
  }
  return { ok: true };
}

async function bloquearUsuario(db, user, otherId) {
  const oid = toNum(otherId);
  if (!oid || oid === user.id) return { ok: false, status: 400, error: "Usuario inválido." };
  await db.execute({
    sql: `DELETE FROM social_solicitudes
          WHERE (de_id = ? AND para_id = ?) OR (de_id = ? AND para_id = ?)`,
    args: [user.id, oid, oid, user.id]
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO social_bloqueos (blocker_id, blocked_id) VALUES (?, ?)`,
    args: [user.id, oid]
  });
  return { ok: true };
}

async function desbloquearUsuario(db, user, otherId) {
  const oid = toNum(otherId);
  if (!oid) return { ok: false, status: 400, error: "Usuario inválido." };
  await db.execute({
    sql: `DELETE FROM social_bloqueos WHERE blocker_id = ? AND blocked_id = ?`,
    args: [user.id, oid]
  });
  return { ok: true };
}

async function tarjetaPublica(db, viewer, targetId) {
  const tid = toNum(targetId);
  if (!tid) return { ok: false, status: 400, error: "Usuario inválido." };
  if (!(await rolEsCliente(db, viewer.id)) || !(await rolEsCliente(db, tid))) {
    return { ok: false, status: 404, error: "Perfil no disponible." };
  }
  if (await esMenorOSinEdad(db, viewer.id) || await esMenorOSinEdad(db, tid)) {
    return { ok: false, status: 404, error: "Perfil no disponible." };
  }
  if (await hayBloqueo(db, viewer.id, tid)) {
    return { ok: false, status: 404, error: "Perfil no disponible." };
  }
  if (tid !== viewer.id && !(await amistadAceptada(db, viewer.id, tid))) {
    return { ok: false, status: 403, error: "Solo lo ves si te aceptaron." };
  }

  const r = await db.execute({
    sql: `SELECT usuario_id, alias, foto, mostrar_foto, mostrar_prs, mostrar_vitrina
          FROM perfiles_sociales WHERE usuario_id = ?`,
    args: [tid]
  });
  const row = r.rows?.[0];
  if (!row) return { ok: false, status: 404, error: "Perfil no disponible." };

  const propio = tid === viewer.id;
  const verFoto = propio || Number(row.mostrar_foto) === 1;
  const verPrs = propio || Number(row.mostrar_prs) === 1;
  const verVitrina = propio || Number(row.mostrar_vitrina) === 1;
  const resumen = verPrs
    ? await resumenFuerzaPublicable(db, tid)
    : { sesiones: 0, series: 0, mejores: [] };
  const vitrina = verVitrina ? await listarVitrina(db, tid) : [];

  return {
    ok: true,
    tarjeta: {
      user_id: tid,
      alias: row.alias,
      foto: verFoto ? (row.foto || null) : null,
      mostrar_prs: verPrs,
      mostrar_vitrina: verVitrina,
      resumen,
      vitrina
    }
  };
}

async function borrarDatosSocialesUsuario(db, userId) {
  await db.execute({
    sql: "DELETE FROM social_vitrina WHERE usuario_id = ?",
    args: [userId]
  });
  await db.execute({
    sql: "DELETE FROM social_solicitudes WHERE de_id = ? OR para_id = ?",
    args: [userId, userId]
  });
  await db.execute({
    sql: "DELETE FROM social_bloqueos WHERE blocker_id = ? OR blocked_id = ?",
    args: [userId, userId]
  });
  await db.execute({
    sql: "DELETE FROM perfiles_sociales WHERE usuario_id = ?",
    args: [userId]
  });
}

module.exports = {
  ensureTablasPerfilSocial,
  obtenerYo,
  guardarYo,
  guardarFoto,
  borrarFoto,
  agregarVitrina,
  borrarVitrina,
  listarEnlaces,
  solicitar,
  responderSolicitud,
  quitarCompanero,
  bloquearUsuario,
  desbloquearUsuario,
  tarjetaPublica,
  borrarDatosSocialesUsuario
};
