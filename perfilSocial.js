/**
 * Perfil social del atleta — separado del expediente clínico.
 * Lesiones, dieta, medidas y plan del coach NUNCA salen por estas rutas.
 */

const crypto = require("crypto");
const { crearNotificacion } = require("./notificaciones");
const { deduplicarFilasHistorialFuerza } = require("./fuerzaHistorial");

const MAX_FOTO_CHARS = 520_000;
const MAX_VITRINA = 24;
const MAX_MSG_CHARS = 400;
const MAX_HILO = 80;
const MAX_MSGS_HORA = 40;
const MAX_POST_CHARS = 280;
const MAX_POSTS_HORA = 15;
const MAX_FEED = 40;
const MAX_MURO = 50;
const MAX_BUSCAR = 12;
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
  try {
    await db.execute(
      "ALTER TABLE perfiles_sociales ADD COLUMN mostrar_ranking INTEGER DEFAULT 0"
    );
  } catch (_) { /* ya existe */ }
  try {
    await db.execute(
      "ALTER TABLE perfiles_sociales ADD COLUMN mostrar_feed INTEGER DEFAULT 0"
    );
  } catch (_) { /* ya existe */ }
  try {
    await db.execute(
      "ALTER TABLE perfiles_sociales ADD COLUMN mostrar_cuerpo INTEGER DEFAULT 0"
    );
  } catch (_) { /* ya existe */ }
  try {
    await db.execute(
      "ALTER TABLE perfiles_sociales ADD COLUMN mostrar_muro INTEGER DEFAULT 0"
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

  await db.execute(`CREATE TABLE IF NOT EXISTS social_mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    de_id INTEGER NOT NULL,
    para_id INTEGER NOT NULL,
    texto TEXT NOT NULL,
    leido INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(de_id) REFERENCES usuarios(id),
    FOREIGN KEY(para_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_mensajes_par
     ON social_mensajes(de_id, para_id, id DESC)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_mensajes_inbox
     ON social_mensajes(para_id, leido, id DESC)`
  );

  await db.execute(`CREATE TABLE IF NOT EXISTS social_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    texto TEXT,
    imagen TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_posts_created
     ON social_posts(id DESC)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_posts_user
     ON social_posts(usuario_id, id DESC)`
  );
  try {
    await db.execute(
      "ALTER TABLE social_posts ADD COLUMN publico INTEGER NOT NULL DEFAULT 0"
    );
  } catch (_) { /* ya existe */ }

  await db.execute(`CREATE TABLE IF NOT EXISTS social_post_likes (
    post_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, usuario_id),
    FOREIGN KEY(post_id) REFERENCES social_posts(id),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_likes_post ON social_post_likes(post_id)`
  );

  await db.execute(`CREATE TABLE IF NOT EXISTS social_post_comentarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    texto TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES social_posts(id),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_comentarios_post
     ON social_post_comentarios(post_id, id DESC)`
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
  const rolR = await db.execute({
    sql: "SELECT rol FROM usuarios WHERE id = ?",
    args: [userId]
  });
  const rol = String(rolR.rows?.[0]?.rol || "").toUpperCase();
  // Coach / admin: identidad social propia (no ficha de menor)
  if (rol === "COACH" || rol === "SUPERADMIN") return false;
  const edad = await edadUsuario(db, userId);
  if (edad == null) return true;
  return edad < 18;
}

/** Quién puede usar la red social (atleta o coach con perfil propio). */
async function rolEsCliente(db, userId) {
  const r = await db.execute({
    sql: "SELECT rol FROM usuarios WHERE id = ?",
    args: [userId]
  });
  const rol = String(r.rows?.[0]?.rol || "").toUpperCase();
  return rol === "CLIENTE" || rol === "COACH" || rol === "SUPERADMIN";
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
    sql: `SELECT * FROM perfiles_sociales WHERE usuario_id = ?`,
    args: [userId]
  });
  if (existing.rows?.[0]) return existing.rows[0];

  const alias = await generarAliasUnico(db, nombre, userId);
  const codigo = await generarCodigoUnico(db);
  await db.execute({
    sql: `INSERT INTO perfiles_sociales
          (usuario_id, alias, codigo, modo_entrada, mostrar_foto, mostrar_prs, mostrar_vitrina, mostrar_ranking, updated_at)
          VALUES (?, ?, ?, 'cerrado', 1, 1, 0, 0, datetime('now'))`,
    args: [userId, alias, codigo]
  });
  const fresh = await db.execute({
    sql: `SELECT * FROM perfiles_sociales WHERE usuario_id = ?`,
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

function parseExtra(raw) {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function snapshotMedicion(row) {
  if (!row) return null;
  const extra = parseExtra(row.datos_extra) || {};
  const res = extra._resultado || {};
  const pliegues = ["pecho", "abdominal", "muslo", "triceps", "suprailiaco", "axilar", "subescapular"];
  let sumaPliegues = numOrNull(res.sumaPliegues);
  if (sumaPliegues == null) {
    let s = 0;
    let n = 0;
    for (const k of pliegues) {
      const v = Number(extra[k]);
      if (Number.isFinite(v) && v > 0) {
        s += v;
        n += 1;
      }
    }
    if (n > 0) sumaPliegues = Math.round(s * 10) / 10;
  }
  const peri = (clave) => numOrNull(extra[clave]);
  return {
    fecha: String(row.fecha || "").slice(0, 10) || null,
    peso: numOrNull(row.peso),
    grasa: numOrNull(row.grasa != null ? row.grasa : res.grasa),
    masa_magra: numOrNull(res.masaMagra),
    suma_pliegues: sumaPliegues,
    brazo: peri("c_brazo") ?? peri("c_brazo_flex"),
    cintura: peri("c_cintura") ?? peri("c_abdomen"),
    pierna: peri("c_pierna")
  };
}

function deltaCampo(a, b) {
  if (a == null || b == null) return null;
  return Math.round((b - a) * 10) / 10;
}

async function progresoCorporal(db, userId) {
  const r = await db.execute({
    sql: `SELECT peso, grasa, datos_extra, fecha
          FROM mediciones WHERE usuario_id = ?
          ORDER BY fecha ASC, id ASC`,
    args: [userId]
  });
  const rows = r.rows || [];
  if (!rows.length) {
    return {
      disponible: false,
      mediciones: 0,
      inicio: null,
      hoy: null,
      deltas: null
    };
  }
  const inicio = snapshotMedicion(rows[0]);
  const hoy = snapshotMedicion(rows[rows.length - 1]);
  const deltas = {
    peso: deltaCampo(inicio.peso, hoy.peso),
    grasa: deltaCampo(inicio.grasa, hoy.grasa),
    masa_magra: deltaCampo(inicio.masa_magra, hoy.masa_magra),
    suma_pliegues: deltaCampo(inicio.suma_pliegues, hoy.suma_pliegues),
    brazo: deltaCampo(inicio.brazo, hoy.brazo),
    cintura: deltaCampo(inicio.cintura, hoy.cintura),
    pierna: deltaCampo(inicio.pierna, hoy.pierna)
  };
  return {
    disponible: true,
    mediciones: rows.length,
    inicio,
    hoy,
    deltas
  };
}

function filaAPerfilPropio(row, { menor, resumen, vitrina, progreso }) {
  return {
    usuario_id: toNum(row.usuario_id),
    alias: row.alias,
    codigo: row.codigo,
    foto: row.foto || null,
    modo_entrada: MODOS.has(row.modo_entrada) ? row.modo_entrada : "cerrado",
    mostrar_foto: Number(row.mostrar_foto) === 1,
    mostrar_prs: Number(row.mostrar_prs) === 1,
    mostrar_vitrina: Number(row.mostrar_vitrina) === 1,
    mostrar_ranking: Number(row.mostrar_ranking) === 1,
    mostrar_feed: Number(row.mostrar_feed) === 1,
    mostrar_cuerpo: Number(row.mostrar_cuerpo) === 1,
    mostrar_muro: Number(row.mostrar_muro) === 1,
    menor: !!menor,
    social_activa: !menor,
    resumen: resumen || { sesiones: 0, series: 0, mejores: [] },
    progreso: progreso || { disponible: false, mediciones: 0, inicio: null, hoy: null, deltas: null },
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
  const progreso = menor ? { disponible: false, mediciones: 0, inicio: null, hoy: null, deltas: null } : await progresoCorporal(db, user.id);
  return { ok: true, perfil: filaAPerfilPropio(row, { menor, resumen, vitrina, progreso }) };
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
  if (body.mostrar_ranking != null) {
    patch.push("mostrar_ranking = ?");
    args.push(body.mostrar_ranking ? 1 : 0);
  }
  if (body.mostrar_feed != null) {
    patch.push("mostrar_feed = ?");
    args.push(body.mostrar_feed ? 1 : 0);
  }
  if (body.mostrar_cuerpo != null) {
    patch.push("mostrar_cuerpo = ?");
    args.push(body.mostrar_cuerpo ? 1 : 0);
  }
  if (body.mostrar_muro != null) {
    patch.push("mostrar_muro = ?");
    args.push(body.mostrar_muro ? 1 : 0);
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
  await borrarMensajesEntre(db, user.id, oid);
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
  await borrarMensajesEntre(db, user.id, oid);
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

const RANK_NIVELES = ["Principiante", "Novato", "Intermedio", "Avanzado", "Élite"];
const RANK_LIFTS = {
  bench: {
    titulo: "Press de banca",
    aliases: ["press de banca", "press banca", "bench press", "bench", "banca plana", "banca plano"],
    male: [0.5, 0.75, 1.0, 1.25, 1.5],
    female: [0.25, 0.5, 0.65, 0.85, 1.0]
  },
  squat: {
    titulo: "Sentadilla",
    aliases: ["sentadilla", "hack squat", "sentadilla hack"],
    male: [0.75, 1.0, 1.25, 1.5, 1.75],
    female: [0.5, 0.75, 1.0, 1.25, 1.5]
  },
  deadlift: {
    titulo: "Peso muerto",
    aliases: ["peso muerto", "deadlift", "rdl", "rumano"],
    male: [1.0, 1.25, 1.5, 1.75, 2.0],
    female: [0.75, 1.0, 1.25, 1.5, 1.75]
  },
  ohp: {
    titulo: "Press militar",
    aliases: ["press militar", "press de hombro", "press hombro"],
    male: [0.35, 0.55, 0.75, 0.95, 1.15],
    female: [0.2, 0.35, 0.5, 0.65, 0.8]
  }
};

function normEj(nombre) {
  return String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function claveLift(nombre) {
  const n = normEj(nombre);
  if (!n) return null;
  let best = null;
  let len = 0;
  for (const [clave, cfg] of Object.entries(RANK_LIFTS)) {
    for (const alias of cfg.aliases) {
      const a = normEj(alias);
      if (n.includes(a) && a.length > len) {
        best = clave;
        len = a.length;
      }
    }
  }
  return best;
}

function e1rm(peso, reps) {
  const p = Number(peso);
  const r = parseInt(reps, 10) || 0;
  if (!(p > 0)) return 0;
  if (r <= 1) return p;
  return Math.round(p * (1 + r / 30) * 10) / 10;
}

function nivelPorRatio(clave, e1, pesoCorporal, genero) {
  if (!(e1 > 0) || !(pesoCorporal > 0)) return null;
  const cfg = RANK_LIFTS[clave];
  const umbrales = cfg[genero === "F" ? "female" : "male"];
  const ratio = e1 / pesoCorporal;
  let idx = 0;
  for (let i = 0; i < umbrales.length; i++) {
    if (ratio >= umbrales[i]) idx = i;
  }
  return RANK_NIVELES[idx];
}

async function contextoCorporal(db, userId) {
  const p = await db.execute({
    sql: "SELECT peso_kg, genero FROM perfiles_clientes WHERE usuario_id = ?",
    args: [userId]
  });
  let peso = Number(p.rows?.[0]?.peso_kg);
  let genero = String(p.rows?.[0]?.genero || "M").toUpperCase() === "F" ? "F" : "M";
  const m = await db.execute({
    sql: "SELECT peso FROM mediciones WHERE usuario_id = ? ORDER BY fecha DESC, id DESC LIMIT 1",
    args: [userId]
  });
  const pm = Number(m.rows?.[0]?.peso);
  if (pm > 0) peso = pm;
  return { peso: peso > 0 ? peso : null, genero };
}

async function mejoresPorLift(db, userId) {
  const result = await db.execute({
    sql: `SELECT ejercicio, peso, reps FROM historial_fuerza WHERE usuario_id = ? LIMIT 1000`,
    args: [userId]
  });
  const best = {};
  for (const row of result.rows || []) {
    const clave = claveLift(row.ejercicio);
    if (!clave) continue;
    const est = e1rm(row.peso, row.reps);
    if (!(est > 0)) continue;
    const prev = best[clave];
    if (!prev || est > prev.e1rm) {
      best[clave] = {
        peso: Math.round(Number(row.peso) * 10) / 10,
        reps: parseInt(row.reps, 10) || null,
        e1rm: est
      };
    }
  }
  return best;
}

async function rankingCirculo(db, user) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El ranking es para atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: false, status: 403, error: "El perfil social está cerrado hasta los 18 años." };
  }
  await asegurarPerfil(db, user.id, user.nombre);

  const amigos = await db.execute({
    sql: `SELECT CASE WHEN de_id = ? THEN para_id ELSE de_id END AS uid
          FROM social_solicitudes
          WHERE estado = 'aceptada' AND (de_id = ? OR para_id = ?)`,
    args: [user.id, user.id, user.id]
  });
  const ids = [user.id, ...(amigos.rows || []).map((r) => toNum(r.uid)).filter(Boolean)];
  const uniq = [...new Set(ids)];
  const placeholders = uniq.map(() => "?").join(",");

  const gente = await db.execute({
    sql: `SELECT p.usuario_id, p.alias, p.foto, p.mostrar_foto, p.mostrar_ranking
          FROM perfiles_sociales p
          JOIN perfiles_clientes c ON c.usuario_id = p.usuario_id
          WHERE p.usuario_id IN (${placeholders})
            AND p.mostrar_ranking = 1
            AND c.edad >= 18`,
    args: uniq
  });

  const yoRow = await db.execute({
    sql: "SELECT mostrar_ranking FROM perfiles_sociales WHERE usuario_id = ?",
    args: [user.id]
  });
  const yoEntro = Number(yoRow.rows?.[0]?.mostrar_ranking) === 1;

  const tablas = Object.entries(RANK_LIFTS).map(([clave, cfg]) => ({
    clave,
    titulo: cfg.titulo,
    filas: []
  }));

  for (const persona of gente.rows || []) {
    const uid = toNum(persona.usuario_id);
    const corporal = await contextoCorporal(db, uid);
    const lifts = await mejoresPorLift(db, uid);
    const soyYo = uid === user.id;
    const foto = soyYo || Number(persona.mostrar_foto) === 1 ? (persona.foto || null) : null;
    for (const tabla of tablas) {
      const lift = lifts[tabla.clave];
      if (!lift) continue;
      tabla.filas.push({
        user_id: uid,
        alias: persona.alias,
        soy_yo: soyYo,
        foto,
        peso: lift.peso,
        reps: lift.reps,
        e1rm: lift.e1rm,
        nivel: nivelPorRatio(tabla.clave, lift.e1rm, corporal.peso, corporal.genero)
      });
    }
  }

  for (const tabla of tablas) {
    tabla.filas.sort((a, b) => b.e1rm - a.e1rm);
    tabla.filas.forEach((f, i) => {
      f.puesto = i + 1;
    });
  }

  return { ok: true, yo_entro: yoEntro, tablas };
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
    sql: `SELECT * FROM perfiles_sociales WHERE usuario_id = ?`,
    args: [tid]
  });
  const row = r.rows?.[0];
  if (!row) return { ok: false, status: 404, error: "Perfil no disponible." };

  const propio = tid === viewer.id;
  const verFoto = propio || Number(row.mostrar_foto) === 1;
  const verPrs = propio || Number(row.mostrar_prs) === 1;
  const verVitrina = propio || Number(row.mostrar_vitrina) === 1;
  const verCuerpo = propio || Number(row.mostrar_cuerpo) === 1;
  const resumen = verPrs
    ? await resumenFuerzaPublicable(db, tid)
    : { sesiones: 0, series: 0, mejores: [] };
  const vitrina = verVitrina ? await listarVitrina(db, tid) : [];
  const progreso = verCuerpo
    ? await progresoCorporal(db, tid)
    : { disponible: false, mediciones: 0, inicio: null, hoy: null, deltas: null };

  return {
    ok: true,
    tarjeta: {
      user_id: tid,
      alias: row.alias,
      foto: verFoto ? (row.foto || null) : null,
      mostrar_prs: verPrs,
      mostrar_vitrina: verVitrina,
      mostrar_cuerpo: verCuerpo,
      resumen,
      progreso,
      vitrina
    }
  };
}

async function borrarMensajesEntre(db, a, b) {
  await db.execute({
    sql: `DELETE FROM social_mensajes
          WHERE (de_id = ? AND para_id = ?) OR (de_id = ? AND para_id = ?)`,
    args: [a, b, b, a]
  });
}

async function gateChat(db, user, otherId) {
  const oid = toNum(otherId);
  if (!oid || oid === user.id) {
    return { ok: false, status: 400, error: "Usuario inválido." };
  }
  if (!(await rolEsCliente(db, user.id)) || !(await rolEsCliente(db, oid))) {
    return { ok: false, status: 403, error: "Los mensajes son entre atletas." };
  }
  if (await esMenorOSinEdad(db, user.id) || await esMenorOSinEdad(db, oid)) {
    return { ok: false, status: 403, error: "Cerrado hasta los 18 años." };
  }
  if (await hayBloqueo(db, user.id, oid)) {
    return { ok: false, status: 403, error: "No puedes escribirle." };
  }
  if (!(await amistadAceptada(db, user.id, oid))) {
    return { ok: false, status: 403, error: "Solo entre compañeros aceptados." };
  }
  return { ok: true, oid };
}

function limpiarTextoMensaje(raw) {
  const s = String(raw || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { ok: false, error: "Escribe un mensaje." };
  if (s.length > MAX_MSG_CHARS) {
    return { ok: false, error: `Máximo ${MAX_MSG_CHARS} caracteres.` };
  }
  return { ok: true, texto: s };
}

async function aliasDe(db, userId) {
  const r = await db.execute({
    sql: "SELECT alias FROM perfiles_sociales WHERE usuario_id = ?",
    args: [userId]
  });
  return r.rows?.[0]?.alias || "Atleta";
}

async function listarChats(db, user) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "Los mensajes son para atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: true, chats: [] };
  }
  await asegurarPerfil(db, user.id, user.nombre);

  const last = await db.execute({
    sql: `SELECT m.id, m.de_id, m.para_id, m.texto, m.created_at, m.leido
          FROM social_mensajes m
          INNER JOIN (
            SELECT MAX(id) AS max_id
            FROM social_mensajes
            WHERE de_id = ? OR para_id = ?
            GROUP BY CASE WHEN de_id = ? THEN para_id ELSE de_id END
          ) t ON t.max_id = m.id
          ORDER BY m.id DESC
          LIMIT 40`,
    args: [user.id, user.id, user.id]
  });

  const unread = await db.execute({
    sql: `SELECT de_id, COUNT(*) AS n
          FROM social_mensajes
          WHERE para_id = ? AND leido = 0
          GROUP BY de_id`,
    args: [user.id]
  });
  const unreadMap = new Map(
    (unread.rows || []).map((r) => [toNum(r.de_id), Number(r.n) || 0])
  );

  const chats = [];
  for (const row of last.rows || []) {
    const peerId = toNum(row.de_id) === user.id ? toNum(row.para_id) : toNum(row.de_id);
    if (!peerId) continue;
    if (await hayBloqueo(db, user.id, peerId)) continue;
    chats.push({
      user_id: peerId,
      alias: await aliasDe(db, peerId),
      ultimo: String(row.texto || "").slice(0, 80),
      created_at: row.created_at,
      mio: toNum(row.de_id) === user.id,
      no_leidos: unreadMap.get(peerId) || 0
    });
  }
  return { ok: true, chats };
}

async function listarHilo(db, user, otherId) {
  const gate = await gateChat(db, user, otherId);
  if (!gate.ok) return gate;
  const oid = gate.oid;

  await db.execute({
    sql: `UPDATE social_mensajes SET leido = 1
          WHERE para_id = ? AND de_id = ? AND leido = 0`,
    args: [user.id, oid]
  });

  const r = await db.execute({
    sql: `SELECT id, de_id, texto, created_at
          FROM social_mensajes
          WHERE (de_id = ? AND para_id = ?) OR (de_id = ? AND para_id = ?)
          ORDER BY id DESC
          LIMIT ?`,
    args: [user.id, oid, oid, user.id, MAX_HILO]
  });

  const mensajes = (r.rows || [])
    .slice()
    .reverse()
    .map((row) => ({
      id: toNum(row.id),
      de_id: toNum(row.de_id),
      texto: row.texto,
      created_at: row.created_at,
      mio: toNum(row.de_id) === user.id
    }));

  return {
    ok: true,
    peer: { user_id: oid, alias: await aliasDe(db, oid) },
    mensajes
  };
}

async function enviarMensaje(db, user, otherId, textoRaw) {
  const gate = await gateChat(db, user, otherId);
  if (!gate.ok) return gate;
  const limpio = limpiarTextoMensaje(textoRaw);
  if (!limpio.ok) return { ok: false, status: 400, error: limpio.error };

  const hora = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM social_mensajes
          WHERE de_id = ? AND created_at >= datetime('now', '-1 hour')`,
    args: [user.id]
  });
  if (Number(hora.rows?.[0]?.n || 0) >= MAX_MSGS_HORA) {
    return { ok: false, status: 429, error: "Demasiados mensajes. Espera un rato." };
  }

  const ins = await db.execute({
    sql: `INSERT INTO social_mensajes (de_id, para_id, texto) VALUES (?, ?, ?)`,
    args: [user.id, gate.oid, limpio.texto]
  });
  if (!(ins.rowsAffected > 0)) {
    return { ok: false, status: 500, error: "No se pudo enviar." };
  }

  const miAlias = await aliasDe(db, user.id);
  try {
    await crearNotificacion(db, {
      usuarioId: gate.oid,
      tipo: "social_mensaje",
      titulo: `Mensaje de @${miAlias}`,
      cuerpo: limpio.texto.slice(0, 80),
      refTipo: "social_mensaje",
      refId: user.id
    });
  } catch (err) {
    console.warn("notif social_mensaje:", err.message);
  }

  return listarHilo(db, user, gate.oid);
}

async function idsCirculo(db, userId) {
  const amigos = await db.execute({
    sql: `SELECT CASE WHEN de_id = ? THEN para_id ELSE de_id END AS uid
          FROM social_solicitudes
          WHERE estado = 'aceptada' AND (de_id = ? OR para_id = ?)`,
    args: [userId, userId, userId]
  });
  const ids = [userId, ...(amigos.rows || []).map((r) => toNum(r.uid)).filter(Boolean)];
  return [...new Set(ids)];
}

async function listarFeed(db, user) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El feed es para atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: true, posts: [], yo_publico: false };
  }
  await asegurarPerfil(db, user.id, user.nombre);

  const uniq = await idsCirculo(db, user.id);
  const placeholders = uniq.map(() => "?").join(",");

  const r = await db.execute({
    sql: `SELECT p.id, p.usuario_id, p.texto, p.imagen, p.created_at,
                 s.alias, s.foto, s.mostrar_foto, s.mostrar_feed
          FROM social_posts p
          JOIN perfiles_sociales s ON s.usuario_id = p.usuario_id
          JOIN perfiles_clientes c ON c.usuario_id = p.usuario_id
          WHERE p.usuario_id IN (${placeholders})
            AND c.edad >= 18
            AND (p.usuario_id = ? OR s.mostrar_feed = 1)
          ORDER BY p.id DESC
          LIMIT ?`,
    args: [...uniq, user.id, MAX_FEED]
  });

  const yo = await db.execute({
    sql: "SELECT mostrar_feed FROM perfiles_sociales WHERE usuario_id = ?",
    args: [user.id]
  });
  const yoPublico = Number(yo.rows?.[0]?.mostrar_feed) === 1;

  const posts = [];
  for (const row of r.rows || []) {
    const uid = toNum(row.usuario_id);
    if (uid !== user.id && (await hayBloqueo(db, user.id, uid))) continue;
    const soyYo = uid === user.id;
    const verFoto = soyYo || Number(row.mostrar_foto) === 1;
    posts.push({
      id: toNum(row.id),
      user_id: uid,
      alias: row.alias,
      foto: verFoto ? (row.foto || null) : null,
      texto: row.texto || null,
      imagen: row.imagen || null,
      created_at: row.created_at,
      soy_yo: soyYo
    });
  }

  return { ok: true, yo_publico: yoPublico, posts };
}

async function crearPost(db, user, body) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El feed es para atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: false, status: 403, error: "Cerrado hasta los 18 años." };
  }
  await asegurarPerfil(db, user.id, user.nombre);

  const esPublico = !!body?.publico;
  const flag = await db.execute({
    sql: "SELECT mostrar_feed, mostrar_muro FROM perfiles_sociales WHERE usuario_id = ?",
    args: [user.id]
  });
  const rowFlag = flag.rows?.[0] || {};
  if (esPublico) {
    if (Number(rowFlag.mostrar_muro) !== 1) {
      return {
        ok: false,
        status: 403,
        error: "Activa «Publicar en el muro» en Privacidad."
      };
    }
  } else if (Number(rowFlag.mostrar_feed) !== 1) {
    return {
      ok: false,
      status: 403,
      error: "Activa «Publicar en el círculo» en Privacidad."
    };
  }

  const texto = String(body?.texto || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let imagen = null;
  if (body?.foto) {
    const v = validarFoto(body.foto);
    if (!v.ok) return { ok: false, status: 400, error: v.error };
    imagen = v.imagen;
  }
  if (!texto && !imagen) {
    return { ok: false, status: 400, error: "Escribe algo o sube una foto." };
  }
  if (texto.length > MAX_POST_CHARS) {
    return { ok: false, status: 400, error: `Máximo ${MAX_POST_CHARS} caracteres.` };
  }

  const hora = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM social_posts
          WHERE usuario_id = ? AND created_at >= datetime('now', '-1 hour')`,
    args: [user.id]
  });
  if (Number(hora.rows?.[0]?.n || 0) >= MAX_POSTS_HORA) {
    return { ok: false, status: 429, error: "Demasiadas publicaciones. Espera un rato." };
  }

  let cargas = null;
  if (esPublico || body?.incluir_cargas) {
    const resumen = await resumenFuerzaPublicable(db, user.id);
    cargas = (resumen.mejores || []).slice(0, 3);
  }

  const textoFinal =
    cargas && cargas.length
      ? `${texto ? `${texto} · ` : ""}${cargas
          .map((m) => `${m.ejercicio} ${m.peso}kg`)
          .join(" · ")}`.slice(0, MAX_POST_CHARS)
      : texto || null;

  const ins = await db.execute({
    sql: `INSERT INTO social_posts (usuario_id, texto, imagen, publico) VALUES (?, ?, ?, ?)`,
    args: [user.id, textoFinal, imagen, esPublico ? 1 : 0]
  });
  if (!(ins.rowsAffected > 0)) {
    return { ok: false, status: 500, error: "No se pudo publicar." };
  }
  if (esPublico) return listarMuro(db, user);
  return listarFeed(db, user);
}

async function borrarPost(db, user, postId) {
  const id = toNum(postId);
  if (!id) return { ok: false, status: 400, error: "Publicación inválida." };
  const prev = await db.execute({
    sql: "SELECT publico FROM social_posts WHERE id = ? AND usuario_id = ?",
    args: [id, user.id]
  });
  if (!prev.rows?.length) {
    return { ok: false, status: 404, error: "No se encontró esa publicación." };
  }
  const eraPublico = Number(prev.rows[0].publico) === 1;
  await db.execute({
    sql: "DELETE FROM social_posts WHERE id = ? AND usuario_id = ?",
    args: [id, user.id]
  });
  if (eraPublico) return listarMuro(db, user);
  return listarFeed(db, user);
}

async function listarMuro(db, user) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "El muro es para atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: true, posts: [], yo_publico: false };
  }
  await asegurarPerfil(db, user.id, user.nombre);

  const r = await db.execute({
    sql: `SELECT p.id, p.usuario_id, p.texto, p.imagen, p.created_at, p.publico,
                 s.alias, s.foto, s.mostrar_foto, s.mostrar_muro
          FROM social_posts p
          JOIN perfiles_sociales s ON s.usuario_id = p.usuario_id
          JOIN usuarios u ON u.id = p.usuario_id
          LEFT JOIN perfiles_clientes c ON c.usuario_id = p.usuario_id
          WHERE p.publico = 1
            AND s.mostrar_muro = 1
            AND (
              UPPER(u.rol) IN ('COACH', 'SUPERADMIN')
              OR (c.edad IS NOT NULL AND c.edad >= 18)
            )
          ORDER BY p.id DESC
          LIMIT ?`,
    args: [MAX_MURO]
  });

  const yo = await db.execute({
    sql: "SELECT mostrar_muro FROM perfiles_sociales WHERE usuario_id = ?",
    args: [user.id]
  });
  const yoPublico = Number(yo.rows?.[0]?.mostrar_muro) === 1;

  const posts = [];
  for (const row of r.rows || []) {
    const uid = toNum(row.usuario_id);
    if (uid !== user.id && (await hayBloqueo(db, user.id, uid))) continue;
    const soyYo = uid === user.id;
    const verFoto = soyYo || Number(row.mostrar_foto) === 1;
    const postId = toNum(row.id);
    const likes = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM social_post_likes WHERE post_id = ?`,
      args: [postId]
    });
    const yoLike = await db.execute({
      sql: `SELECT 1 FROM social_post_likes WHERE post_id = ? AND usuario_id = ? LIMIT 1`,
      args: [postId, user.id]
    });
    const coms = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM social_post_comentarios WHERE post_id = ?`,
      args: [postId]
    });
    const preview = await db.execute({
      sql: `SELECT c.id, c.texto, c.created_at, c.usuario_id, s.alias
            FROM social_post_comentarios c
            JOIN perfiles_sociales s ON s.usuario_id = c.usuario_id
            WHERE c.post_id = ?
            ORDER BY c.id DESC LIMIT 2`,
      args: [postId]
    });
    posts.push({
      id: postId,
      user_id: uid,
      alias: row.alias,
      foto: verFoto ? (row.foto || null) : null,
      texto: row.texto || null,
      imagen: row.imagen || null,
      created_at: row.created_at,
      publico: true,
      soy_yo: soyYo,
      likes: Number(likes.rows?.[0]?.n || 0),
      yo_like: !!(yoLike.rows || []).length,
      comentarios_n: Number(coms.rows?.[0]?.n || 0),
      comentarios: (preview.rows || [])
        .slice()
        .reverse()
        .map((c) => ({
          id: toNum(c.id),
          alias: c.alias,
          texto: c.texto,
          created_at: c.created_at,
          soy_yo: toNum(c.usuario_id) === user.id
        }))
    });
  }
  return { ok: true, yo_publico: yoPublico, posts };
}

async function buscarPersonas(db, user, qRaw) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "Solo atletas." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: true, resultados: [] };
  }
  await asegurarPerfil(db, user.id, user.nombre);

  const q = slugAlias(String(qRaw || "").replace(/^@/, ""), "");
  if (q.length < 2) {
    return { ok: false, status: 400, error: "Escribe al menos 2 caracteres." };
  }

  const r = await db.execute({
    sql: `SELECT s.usuario_id, s.alias, s.foto, s.mostrar_foto, s.modo_entrada
          FROM perfiles_sociales s
          JOIN usuarios u ON u.id = s.usuario_id
          LEFT JOIN perfiles_clientes c ON c.usuario_id = s.usuario_id
          WHERE s.modo_entrada = 'alias'
            AND s.alias LIKE ?
            AND s.usuario_id != ?
            AND (
              UPPER(u.rol) IN ('COACH', 'SUPERADMIN')
              OR (c.edad IS NOT NULL AND c.edad >= 18)
            )
          ORDER BY s.alias ASC
          LIMIT ?`,
    args: [`${q}%`, user.id, MAX_BUSCAR]
  });

  const resultados = [];
  for (const row of r.rows || []) {
    const uid = toNum(row.usuario_id);
    if (await hayBloqueo(db, user.id, uid)) continue;
    const verFoto = Number(row.mostrar_foto) === 1;
    resultados.push({
      user_id: uid,
      alias: row.alias,
      foto: verFoto ? (row.foto || null) : null
    });
  }
  return { ok: true, resultados };
}

const MAX_COMENTARIO = 200;
const MAX_COMS_HORA = 40;

async function toggleLikePost(db, user, postIdRaw) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "Solo red social." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: false, status: 403, error: "Cerrado hasta los 18 años." };
  }
  const postId = toNum(postIdRaw);
  if (!postId) return { ok: false, status: 400, error: "Post inválido." };

  const post = await db.execute({
    sql: `SELECT id, usuario_id, publico FROM social_posts WHERE id = ?`,
    args: [postId]
  });
  const row = post.rows?.[0];
  if (!row || Number(row.publico) !== 1) {
    return { ok: false, status: 404, error: "Publicación no encontrada." };
  }
  const autor = toNum(row.usuario_id);
  if (autor !== user.id && (await hayBloqueo(db, user.id, autor))) {
    return { ok: false, status: 403, error: "No disponible." };
  }

  const prev = await db.execute({
    sql: `SELECT 1 FROM social_post_likes WHERE post_id = ? AND usuario_id = ? LIMIT 1`,
    args: [postId, user.id]
  });
  if (prev.rows?.length) {
    await db.execute({
      sql: `DELETE FROM social_post_likes WHERE post_id = ? AND usuario_id = ?`,
      args: [postId, user.id]
    });
  } else {
    await db.execute({
      sql: `INSERT INTO social_post_likes (post_id, usuario_id) VALUES (?, ?)`,
      args: [postId, user.id]
    });
  }
  return listarMuro(db, user);
}

async function comentarPost(db, user, postIdRaw, textoRaw) {
  if (!(await rolEsCliente(db, user.id))) {
    return { ok: false, status: 403, error: "Solo red social." };
  }
  if (await esMenorOSinEdad(db, user.id)) {
    return { ok: false, status: 403, error: "Cerrado hasta los 18 años." };
  }
  const postId = toNum(postIdRaw);
  if (!postId) return { ok: false, status: 400, error: "Post inválido." };

  const texto = String(textoRaw || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!texto) return { ok: false, status: 400, error: "Escribe un comentario." };
  if (texto.length > MAX_COMENTARIO) {
    return { ok: false, status: 400, error: `Máximo ${MAX_COMENTARIO} caracteres.` };
  }

  const post = await db.execute({
    sql: `SELECT id, usuario_id, publico FROM social_posts WHERE id = ?`,
    args: [postId]
  });
  const row = post.rows?.[0];
  if (!row || Number(row.publico) !== 1) {
    return { ok: false, status: 404, error: "Publicación no encontrada." };
  }
  const autor = toNum(row.usuario_id);
  if (autor !== user.id && (await hayBloqueo(db, user.id, autor))) {
    return { ok: false, status: 403, error: "No disponible." };
  }

  const hora = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM social_post_comentarios
          WHERE usuario_id = ? AND created_at >= datetime('now', '-1 hour')`,
    args: [user.id]
  });
  if (Number(hora.rows?.[0]?.n || 0) >= MAX_COMS_HORA) {
    return { ok: false, status: 429, error: "Demasiados comentarios. Espera un rato." };
  }

  const ins = await db.execute({
    sql: `INSERT INTO social_post_comentarios (post_id, usuario_id, texto) VALUES (?, ?, ?)`,
    args: [postId, user.id, texto]
  });
  if (!(ins.rowsAffected > 0)) {
    return { ok: false, status: 500, error: "No se pudo comentar." };
  }
  return listarMuro(db, user);
}

async function borrarComentario(db, user, comIdRaw) {
  const id = toNum(comIdRaw);
  if (!id) return { ok: false, status: 400, error: "Comentario inválido." };
  const del = await db.execute({
    sql: `DELETE FROM social_post_comentarios WHERE id = ? AND usuario_id = ?`,
    args: [id, user.id]
  });
  if (!(del.rowsAffected > 0)) {
    return { ok: false, status: 404, error: "No se encontró ese comentario." };
  }
  return listarMuro(db, user);
}

async function borrarDatosSocialesUsuario(db, userId) {
  await db.execute({
    sql: `DELETE FROM social_post_likes WHERE usuario_id = ? OR post_id IN
          (SELECT id FROM social_posts WHERE usuario_id = ?)`,
    args: [userId, userId]
  });
  await db.execute({
    sql: `DELETE FROM social_post_comentarios WHERE usuario_id = ? OR post_id IN
          (SELECT id FROM social_posts WHERE usuario_id = ?)`,
    args: [userId, userId]
  });
  await db.execute({
    sql: "DELETE FROM social_posts WHERE usuario_id = ?",
    args: [userId]
  });
  await db.execute({
    sql: "DELETE FROM social_mensajes WHERE de_id = ? OR para_id = ?",
    args: [userId, userId]
  });
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
  rankingCirculo,
  tarjetaPublica,
  listarChats,
  listarHilo,
  enviarMensaje,
  listarFeed,
  crearPost,
  borrarPost,
  listarMuro,
  buscarPersonas,
  toggleLikePost,
  comentarPost,
  borrarComentario,
  borrarDatosSocialesUsuario
};
