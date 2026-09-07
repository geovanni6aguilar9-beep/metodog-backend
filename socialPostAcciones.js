/**
 * Carril independiente — acciones de publicación (editar / fijar / archivar / guardar / reportar).
 * No toca likes, comentarios ni notifs. Lazy-require de listarMuro para evitar ciclo.
 */

const MAX_POST_CHARS = 280;
const MAX_REPORTES_DIA = 15;
const MOTIVOS_OK = new Set([
  "spam",
  "acoso",
  "contenido_inapropiado",
  "suplantacion",
  "otro"
]);

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function limpiaTexto(raw) {
  return String(raw || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureTablasAccionesPost(db) {
  try {
    await db.execute(
      "ALTER TABLE social_posts ADD COLUMN fijado INTEGER NOT NULL DEFAULT 0"
    );
  } catch (_) { /* ya existe */ }
  try {
    await db.execute(
      "ALTER TABLE social_posts ADD COLUMN archivado INTEGER NOT NULL DEFAULT 0"
    );
  } catch (_) { /* ya existe */ }

  await db.execute(`CREATE TABLE IF NOT EXISTS social_posts_guardados (
    usuario_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id, post_id),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(post_id) REFERENCES social_posts(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_guardados_user
     ON social_posts_guardados(usuario_id, created_at DESC)`
  );

  await db.execute(`CREATE TABLE IF NOT EXISTS social_reportes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    motivo TEXT NOT NULL,
    detalle TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(reporter_id) REFERENCES usuarios(id),
    FOREIGN KEY(post_id) REFERENCES social_posts(id)
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_reportes_post
     ON social_reportes(post_id, created_at DESC)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_social_reportes_reporter_dia
     ON social_reportes(reporter_id, created_at DESC)`
  );
}

function listarMuroLazy() {
  return require("./perfilSocial").listarMuro;
}

async function postPropio(db, userId, postId) {
  const r = await db.execute({
    sql: `SELECT id, usuario_id, texto, publico,
                 COALESCE(fijado, 0) AS fijado,
                 COALESCE(archivado, 0) AS archivado
          FROM social_posts WHERE id = ? AND usuario_id = ?`,
    args: [postId, userId]
  });
  return r.rows?.[0] || null;
}

async function ensureReady(db) {
  await ensureTablasAccionesPost(db);
}

async function editarPost(db, user, postIdRaw, body) {
  await ensureReady(db);
  const postId = toNum(postIdRaw);
  const uid = toNum(user.id);
  if (!postId || !uid) return { ok: false, status: 400, error: "Publicación inválida." };

  const texto = limpiaTexto(body?.texto);
  if (!texto) return { ok: false, status: 400, error: "Escribe una descripción." };
  if (texto.length > MAX_POST_CHARS) {
    return { ok: false, status: 400, error: `Máximo ${MAX_POST_CHARS} caracteres.` };
  }

  const row = await postPropio(db, uid, postId);
  if (!row) return { ok: false, status: 404, error: "Solo el autor puede editar." };

  const upd = await db.execute({
    sql: `UPDATE social_posts SET texto = ? WHERE id = ? AND usuario_id = ?`,
    args: [texto, postId, uid]
  });
  if (!(upd.rowsAffected > 0) && upd.rowsAffected != null) {
    return { ok: false, status: 500, error: "No se pudo editar." };
  }
  return listarMuroLazy()(db, user);
}

async function fijarPost(db, user, postIdRaw, fijarRaw) {
  await ensureReady(db);
  const postId = toNum(postIdRaw);
  const uid = toNum(user.id);
  if (!postId || !uid) return { ok: false, status: 400, error: "Publicación inválida." };
  const fijar = fijarRaw === true || fijarRaw === 1 || fijarRaw === "1" ? 1 : 0;

  const row = await postPropio(db, uid, postId);
  if (!row) return { ok: false, status: 404, error: "Solo el autor puede fijar." };
  if (Number(row.archivado) === 1) {
    return { ok: false, status: 400, error: "Desarchiva antes de fijar." };
  }

  if (fijar) {
    await db.execute({
      sql: `UPDATE social_posts SET fijado = 0 WHERE usuario_id = ? AND COALESCE(fijado, 0) = 1`,
      args: [uid]
    });
  }
  const upd = await db.execute({
    sql: `UPDATE social_posts SET fijado = ? WHERE id = ? AND usuario_id = ?`,
    args: [fijar, postId, uid]
  });
  if (!(upd.rowsAffected > 0) && upd.rowsAffected != null) {
    return { ok: false, status: 500, error: "No se pudo fijar." };
  }
  return listarMuroLazy()(db, user);
}

async function archivarPost(db, user, postIdRaw, archivarRaw) {
  await ensureReady(db);
  const postId = toNum(postIdRaw);
  const uid = toNum(user.id);
  if (!postId || !uid) return { ok: false, status: 400, error: "Publicación inválida." };
  const archivar = archivarRaw === true || archivarRaw === 1 || archivarRaw === "1" ? 1 : 0;

  const row = await postPropio(db, uid, postId);
  if (!row) return { ok: false, status: 404, error: "Solo el autor puede archivar." };

  const upd = await db.execute({
    sql: `UPDATE social_posts
          SET archivado = ?, fijado = CASE WHEN ? = 1 THEN 0 ELSE COALESCE(fijado, 0) END
          WHERE id = ? AND usuario_id = ?`,
    args: [archivar, archivar, postId, uid]
  });
  if (!(upd.rowsAffected > 0) && upd.rowsAffected != null) {
    return { ok: false, status: 500, error: "No se pudo archivar." };
  }
  return listarMuroLazy()(db, user);
}

async function toggleGuardarPost(db, user, postIdRaw) {
  await ensureReady(db);
  const postId = toNum(postIdRaw);
  const uid = toNum(user.id);
  if (!postId || !uid) return { ok: false, status: 400, error: "Publicación inválida." };

  const post = await db.execute({
    sql: `SELECT id, usuario_id, publico, COALESCE(archivado, 0) AS archivado
          FROM social_posts WHERE id = ?`,
    args: [postId]
  });
  const row = post.rows?.[0];
  if (!row || Number(row.publico) !== 1 || Number(row.archivado) === 1) {
    return { ok: false, status: 404, error: "Publicación no disponible." };
  }
  if (toNum(row.usuario_id) === uid) {
    return { ok: false, status: 400, error: "No puedes guardar tu propia publicación." };
  }

  const prev = await db.execute({
    sql: `SELECT 1 FROM social_posts_guardados WHERE usuario_id = ? AND post_id = ? LIMIT 1`,
    args: [uid, postId]
  });
  let guardado = false;
  if ((prev.rows || []).length) {
    await db.execute({
      sql: `DELETE FROM social_posts_guardados WHERE usuario_id = ? AND post_id = ?`,
      args: [uid, postId]
    });
    guardado = false;
  } else {
    await db.execute({
      sql: `INSERT OR IGNORE INTO social_posts_guardados (usuario_id, post_id) VALUES (?, ?)`,
      args: [uid, postId]
    });
    guardado = true;
  }

  const muro = await listarMuroLazy()(db, user);
  return { ...muro, guardado, post_id: postId };
}

async function reportarPost(db, user, postIdRaw, body) {
  await ensureReady(db);
  const postId = toNum(postIdRaw);
  const uid = toNum(user.id);
  if (!postId || !uid) return { ok: false, status: 400, error: "Publicación inválida." };

  const motivo = String(body?.motivo || "otro").trim().toLowerCase();
  if (!MOTIVOS_OK.has(motivo)) {
    return { ok: false, status: 400, error: "Motivo inválido." };
  }
  const detalle = limpiaTexto(body?.detalle).slice(0, 280) || null;

  const post = await db.execute({
    sql: `SELECT id, usuario_id, publico FROM social_posts WHERE id = ?`,
    args: [postId]
  });
  const row = post.rows?.[0];
  if (!row || Number(row.publico) !== 1) {
    return { ok: false, status: 404, error: "Publicación no encontrada." };
  }
  if (toNum(row.usuario_id) === uid) {
    return { ok: false, status: 400, error: "No puedes reportar tu propia publicación." };
  }

  const hoy = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM social_reportes
          WHERE reporter_id = ? AND created_at >= datetime('now', '-1 day')`,
    args: [uid]
  });
  if (Number(hoy.rows?.[0]?.n || 0) >= MAX_REPORTES_DIA) {
    return { ok: false, status: 429, error: "Demasiados reportes hoy." };
  }

  const dup = await db.execute({
    sql: `SELECT 1 FROM social_reportes
          WHERE reporter_id = ? AND post_id = ?
            AND created_at >= datetime('now', '-1 day') LIMIT 1`,
    args: [uid, postId]
  });
  if ((dup.rows || []).length) {
    return { ok: true, ya_reportado: true, mensaje: "Ya lo reportaste." };
  }

  await db.execute({
    sql: `INSERT INTO social_reportes (reporter_id, post_id, motivo, detalle)
          VALUES (?, ?, ?, ?)`,
    args: [uid, postId, motivo, detalle]
  });
  return { ok: true, mensaje: "Reporte enviado. Gracias." };
}

/** Publicaciones de un perfil (estilo IG) — propias o de otro (solo públicas). */
async function listarPostsPerfil(db, user, targetIdRaw) {
  await ensureReady(db);
  const viewer = toNum(user.id);
  const tid = toNum(targetIdRaw) || viewer;
  if (!viewer || !tid) return { ok: false, status: 400, error: "Usuario inválido." };

  const propio = viewer === tid;
  let rows = [];
  try {
    const r = await db.execute({
      sql: `SELECT p.id, p.usuario_id, p.texto, p.imagen, p.created_at, p.publico,
                   COALESCE(p.fijado, 0) AS fijado,
                   COALESCE(p.archivado, 0) AS archivado,
                   COALESCE(p.comentarios_off, 0) AS comentarios_off,
                   COALESCE(p.quien_comenta, 'todos') AS quien_comenta,
                   COALESCE(p.reacciones_off, 0) AS reacciones_off,
                   s.alias, s.foto, s.mostrar_foto
            FROM social_posts p
            JOIN perfiles_sociales s ON s.usuario_id = p.usuario_id
            WHERE p.usuario_id = ?
              AND COALESCE(p.publico, 0) = 1
              AND COALESCE(p.archivado, 0) = 0
            ORDER BY COALESCE(p.fijado, 0) DESC, p.id DESC
            LIMIT 60`,
      args: [tid]
    });
    rows = r.rows || [];
  } catch (err) {
    console.warn("listarPostsPerfil full:", err.message);
    const r2 = await db.execute({
      sql: `SELECT p.id, p.usuario_id, p.texto, p.imagen, p.created_at, p.publico, s.alias
            FROM social_posts p
            JOIN perfiles_sociales s ON s.usuario_id = p.usuario_id
            WHERE p.usuario_id = ? AND COALESCE(p.publico, 0) = 1
            ORDER BY p.id DESC
            LIMIT 60`,
      args: [tid]
    });
    rows = r2.rows || [];
  }

  const posts = [];
  for (const row of rows) {
    const postId = toNum(row.id);
    let likesN = 0;
    let comsN = 0;
    try {
      const likes = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM social_post_likes WHERE post_id = ?`,
        args: [postId]
      });
      likesN = Number(likes.rows?.[0]?.n || 0);
      const coms = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM social_post_comentarios WHERE post_id = ?`,
        args: [postId]
      });
      comsN = Number(coms.rows?.[0]?.n || 0);
    } catch (_) { /* ignore */ }
    posts.push({
      id: postId,
      user_id: toNum(row.usuario_id),
      alias: row.alias,
      texto: row.texto || null,
      imagen: row.imagen || null,
      created_at: row.created_at,
      publico: true,
      soy_yo: propio,
      fijado: Number(row.fijado) === 1,
      likes: likesN,
      comentarios_n: comsN,
      quien_comenta: row.quien_comenta || "todos",
      comentarios_off: Number(row.comentarios_off) === 1 || row.quien_comenta === "off",
      reacciones_off: Number(row.reacciones_off) === 1
    });
  }
  return { ok: true, user_id: tid, propio, posts };
}

/** Posts que el usuario guardó (bookmark). */
async function listarPostsGuardados(db, user) {
  await ensureReady(db);
  const uid = toNum(user.id);
  if (!uid) return { ok: false, status: 400, error: "Usuario inválido." };

  let rows = [];
  try {
    const r = await db.execute({
      sql: `SELECT p.id, p.usuario_id, p.texto, p.imagen, p.created_at,
                   COALESCE(p.fijado, 0) AS fijado, s.alias
            FROM social_posts_guardados g
            JOIN social_posts p ON p.id = g.post_id
            JOIN perfiles_sociales s ON s.usuario_id = p.usuario_id
            WHERE g.usuario_id = ?
              AND COALESCE(p.publico, 0) = 1
              AND COALESCE(p.archivado, 0) = 0
            ORDER BY g.created_at DESC
            LIMIT 60`,
      args: [uid]
    });
    rows = r.rows || [];
  } catch (err) {
    console.warn("listarPostsGuardados:", err.message);
    return { ok: true, posts: [] };
  }

  const posts = rows.map((row) => ({
    id: toNum(row.id),
    user_id: toNum(row.usuario_id),
    alias: row.alias,
    texto: row.texto || null,
    imagen: row.imagen || null,
    created_at: row.created_at,
    publico: true,
    soy_yo: toNum(row.usuario_id) === uid,
    fijado: Number(row.fijado) === 1,
    yo_guardado: true
  }));
  return { ok: true, posts };
}

module.exports = {
  ensureTablasAccionesPost,
  editarPost,
  fijarPost,
  archivarPost,
  toggleGuardarPost,
  reportarPost,
  listarPostsPerfil,
  listarPostsGuardados,
  MOTIVOS_OK
};
