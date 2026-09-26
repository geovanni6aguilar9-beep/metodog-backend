/**
 * Alta presencial coach → código de reclamo → cuenta cliente vinculada.
 */

const bcrypt = require("bcryptjs");

const DIAS_EXPIRA = 14;

function normalizarCodigoReclamo(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function generarCodigoReclamo() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i += 1) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function telefonoLimpio(raw) {
  const d = String(raw || "").replace(/[^\d+]/g, "").trim();
  return d.length >= 8 ? d : "";
}

/** Solo claves numéricas válidas (pliegues / perímetros). */
function limpiarMapaMedidas(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

function construirDatosExtraMedicion(datosMed) {
  const pliegues = limpiarMapaMedidas(datosMed?.pliegues) || {};
  const perimetros = limpiarMapaMedidas(datosMed?.perimetros) || {};
  const sumaPliegues = Object.values(pliegues).reduce((a, n) => a + n, 0);
  return {
    formula: datosMed?.formula || null,
    ...pliegues,
    ...perimetros,
    pliegues: Object.keys(pliegues).length ? pliegues : null,
    perimetros: Object.keys(perimetros).length ? perimetros : null,
    _resultado: {
      grasa: datosMed?.grasa ?? null,
      masaMagra: datosMed?.masa_magra ?? null,
      masaGrasa: datosMed?.masa_grasa ?? null,
      tmbKatch: datosMed?.tmb_katch ?? null,
      densidad: datosMed?.densidad ?? null,
      sumaPliegues: sumaPliegues > 0 ? Math.round(sumaPliegues * 10) / 10 : null
    },
    origen: "consulta_presencial"
  };
}

async function asegurarTablaInvitacionesPresenciales(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS invitaciones_presenciales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coach_id INTEGER NOT NULL,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    email TEXT,
    telefono TEXT,
    objetivo TEXT,
    genero TEXT,
    edad INTEGER,
    estatura REAL,
    peso_kg REAL,
    datos_medicion TEXT,
    gustos TEXT,
    disgustos TEXT,
    enfermedades TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    cliente_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY(coach_id) REFERENCES usuarios(id)
  )`);
  for (const sql of [
    "ALTER TABLE perfiles_clientes ADD COLUMN telefono TEXT",
    "ALTER TABLE invitaciones_presenciales ADD COLUMN gustos TEXT",
    "ALTER TABLE invitaciones_presenciales ADD COLUMN disgustos TEXT",
    "ALTER TABLE invitaciones_presenciales ADD COLUMN enfermedades TEXT"
  ]) {
    try {
      await db.execute(sql);
    } catch {
      /* ya existe */
    }
  }
}

async function codigoUnico(db) {
  for (let i = 0; i < 12; i += 1) {
    const codigo = generarCodigoReclamo();
    const hit = await db.execute({
      sql: "SELECT id FROM invitaciones_presenciales WHERE codigo = ? LIMIT 1",
      args: [codigo]
    });
    if (!hit.rows?.length) return codigo;
  }
  throw new Error("No se pudo generar código único");
}

/**
 * Coach crea borrador + código.
 * Body: nombre, email?, telefono?, objetivo?, genero?, edad?, estatura?, peso_kg?,
 *       gustos?, disgustos?, enfermedades?,
 *       formula?, pliegues{}, perimetros{}, grasa?, masa_magra?, tmb_katch?
 */
async function crearInvitacionPresencial(db, coachUser, body, evaluarSuscripcionCoach) {
  const coachId = Number(coachUser?.id);
  if (!coachId || !["COACH", "SUPERADMIN"].includes(coachUser?.rol)) {
    return { ok: false, status: 403, error: "Solo coaches pueden registrar consultas." };
  }

  const nombre = String(body?.nombre || "").trim();
  if (nombre.length < 2) {
    return { ok: false, status: 400, error: "Indica el nombre del atleta." };
  }

  if (coachUser.rol === "COACH" && typeof evaluarSuscripcionCoach === "function") {
    const sub = await evaluarSuscripcionCoach(db, coachId);
    if (!sub) {
      return { ok: false, status: 403, error: "Necesitas suscripción activa para dar de alta alumnos." };
    }
    const countRes = await db.execute({
      sql: "SELECT COUNT(*) as c FROM usuarios WHERE coach_id = ?",
      args: [coachId]
    });
    const pendingRes = await db.execute({
      sql: "SELECT COUNT(*) as c FROM invitaciones_presenciales WHERE coach_id = ? AND status = 'pending'",
      args: [coachId]
    });
    const ocupados =
      Number(countRes.rows[0]?.c || 0) + Number(pendingRes.rows[0]?.c || 0);
    if (sub.limite_efectivo && ocupados >= Number(sub.limite_efectivo)) {
      return { ok: false, status: 400, error: "Alcanzaste el límite de alumnos de tu plan." };
    }
  }

  const email = String(body?.email || "").toLowerCase().trim() || null;
  const telefono = telefonoLimpio(body?.telefono) || null;
  const objetivo = String(body?.objetivo || "").trim() || null;
  const genero = body?.genero === "F" ? "F" : body?.genero === "M" ? "M" : null;
  const edad = Number(body?.edad) || null;
  const estatura = Number(body?.estatura) || null;
  const peso_kg = Number(body?.peso_kg) || null;
  const gustos = String(body?.gustos || "").trim() || null;
  const disgustos = String(body?.disgustos || "").trim() || null;
  const enfermedades = String(body?.enfermedades || "").trim() || null;

  const datosMedicion = {
    formula: body?.formula || null,
    pliegues: limpiarMapaMedidas(body?.pliegues),
    perimetros: limpiarMapaMedidas(body?.perimetros),
    grasa: body?.grasa != null ? Number(body.grasa) : null,
    masa_magra: body?.masa_magra != null ? Number(body.masa_magra) : null,
    masa_grasa: body?.masa_grasa != null ? Number(body.masa_grasa) : null,
    tmb_katch: body?.tmb_katch != null ? Number(body.tmb_katch) : null,
    densidad: body?.densidad != null ? Number(body.densidad) : null
  };

  const codigo = await codigoUnico(db);
  const expiresAt = new Date(Date.now() + DIAS_EXPIRA * 24 * 60 * 60 * 1000).toISOString();

  const ins = await db.execute({
    sql: `INSERT INTO invitaciones_presenciales
      (coach_id, codigo, nombre, email, telefono, objetivo, genero, edad, estatura, peso_kg,
       datos_medicion, gustos, disgustos, enfermedades, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [
      coachId,
      codigo,
      nombre,
      email,
      telefono,
      objetivo,
      genero,
      edad,
      estatura,
      peso_kg,
      JSON.stringify(datosMedicion),
      gustos,
      disgustos,
      enfermedades,
      expiresAt
    ]
  });

  const id = Number(ins.lastInsertRowid || ins.meta?.last_insert_rowid || 0);
  if (!id) {
    return { ok: false, status: 500, error: "No se guardó la invitación." };
  }

  return {
    ok: true,
    invitacion: {
      id,
      codigo,
      nombre,
      email,
      telefono,
      status: "pending",
      expires_at: expiresAt,
      grasa: datosMedicion.grasa,
      peso_kg
    }
  };
}

async function listarInvitacionesCoach(db, coachUser) {
  const coachId = Number(coachUser?.id);
  if (!coachId) return { ok: false, status: 403, error: "No autorizado." };

  const res = await db.execute({
    sql: `SELECT id, codigo, nombre, email, telefono, status, created_at, expires_at, cliente_id, peso_kg, datos_medicion
          FROM invitaciones_presenciales
          WHERE coach_id = ?
          ORDER BY datetime(created_at) DESC
          LIMIT 40`,
    args: [coachId]
  });

  const items = (res.rows || []).map((r) => {
    let grasa = null;
    try {
      const d = JSON.parse(r.datos_medicion || "{}");
      grasa = d.grasa ?? null;
    } catch {
      /* ignore */
    }
    return {
      id: Number(r.id),
      codigo: r.codigo,
      nombre: r.nombre,
      email: r.email,
      telefono: r.telefono,
      status: r.status,
      created_at: r.created_at,
      expires_at: r.expires_at,
      cliente_id: r.cliente_id != null ? Number(r.cliente_id) : null,
      peso_kg: r.peso_kg != null ? Number(r.peso_kg) : null,
      grasa
    };
  });

  return { ok: true, invitaciones: items };
}

async function previewInvitacion(db, codigoRaw) {
  const codigo = normalizarCodigoReclamo(codigoRaw);
  if (codigo.length < 4) {
    return { ok: false, status: 400, error: "Código inválido." };
  }

  const res = await db.execute({
    sql: `SELECT i.nombre, i.email, i.telefono, i.status, i.expires_at, u.nombre as coach_nombre
          FROM invitaciones_presenciales i
          JOIN usuarios u ON u.id = i.coach_id
          WHERE i.codigo = ?
          LIMIT 1`,
    args: [codigo]
  });

  if (!res.rows?.length) {
    return { ok: false, status: 404, error: "No encontramos ese código." };
  }

  const row = res.rows[0];
  if (row.status !== "pending") {
    return { ok: false, status: 400, error: "Este código ya fue usado." };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 400, error: "Este código expiró. Pide uno nuevo a tu coach." };
  }

  return {
    ok: true,
    preview: {
      nombre: row.nombre,
      email: row.email || "",
      telefono: row.telefono || "",
      coach_nombre: row.coach_nombre || "Tu coach"
    }
  };
}

/**
 * Cliente reclama código: crea cuenta + perfil + medición + vínculo coach.
 */
async function reclamarInvitacion(db, body, deps = {}) {
  const { signToken, sanitizeUsuario, enrichUsuarioConSuscripcion, enrichUsuarioVinculo, evaluarSuscripcionCoach } =
    deps;

  const codigo = normalizarCodigoReclamo(body?.codigo);
  const email = String(body?.email || "").toLowerCase().trim();
  const password = String(body?.password || "");
  const telefono = telefonoLimpio(body?.telefono);
  const nombreBody = String(body?.nombre || "").trim();

  if (codigo.length < 4) return { ok: false, status: 400, error: "Código inválido." };
  if (!email || !email.includes("@")) return { ok: false, status: 400, error: "Correo inválido." };
  if (password.length < 6) return { ok: false, status: 400, error: "La contraseña debe tener al menos 6 caracteres." };
  if (!telefono) return { ok: false, status: 400, error: "Indica un teléfono de contacto." };

  const invRes = await db.execute({
    sql: "SELECT * FROM invitaciones_presenciales WHERE codigo = ? LIMIT 1",
    args: [codigo]
  });
  if (!invRes.rows?.length) {
    return { ok: false, status: 404, error: "No encontramos ese código." };
  }
  const inv = invRes.rows[0];
  if (inv.status !== "pending") {
    return { ok: false, status: 400, error: "Este código ya fue usado." };
  }
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 400, error: "Este código expiró. Pide uno nuevo a tu coach." };
  }

  const coachId = Number(inv.coach_id);
  if (typeof evaluarSuscripcionCoach === "function") {
    const sub = await evaluarSuscripcionCoach(db, coachId);
    if (!sub) {
      return { ok: false, status: 400, error: "Tu coach no tiene suscripción activa ahora." };
    }
    const countRes = await db.execute({
      sql: "SELECT COUNT(*) as count FROM usuarios WHERE coach_id = ?",
      args: [coachId]
    });
    const count = Number(countRes.rows[0]?.count || 0);
    if (sub.limite_efectivo && count >= Number(sub.limite_efectivo)) {
      return { ok: false, status: 400, error: "Tu coach alcanzó el límite de alumnos." };
    }
  }

  const exists = await db.execute({
    sql: "SELECT id FROM usuarios WHERE email = ? LIMIT 1",
    args: [email]
  });
  if (exists.rows?.length) {
    return {
      ok: false,
      status: 400,
      error: "Este correo ya está registrado. Inicia sesión y pide a tu coach que te vincule."
    };
  }

  const nombre = nombreBody || String(inv.nombre || "").trim() || "Atleta";
  const hash = bcrypt.hashSync(password, 10);

  const userIns = await db.execute({
    sql: `INSERT INTO usuarios (nombre, email, password, rol, codigo_invitacion, coach_id, onboarding_guia_vista, onboarding_quests)
          VALUES (?, ?, ?, 'CLIENTE', NULL, ?, 0, '{}')`,
    args: [nombre, email, hash, coachId]
  });
  const clienteId = Number(userIns.lastInsertRowid || userIns.meta?.last_insert_rowid || 0);
  if (!clienteId) {
    return { ok: false, status: 500, error: "No se pudo crear la cuenta." };
  }

  let datosMed = {};
  try {
    datosMed = JSON.parse(inv.datos_medicion || "{}");
  } catch {
    datosMed = {};
  }

  const gustosFinal = String(inv.gustos || "").trim() || String(inv.objetivo || "").trim() || "";
  const disgustosFinal = String(inv.disgustos || "").trim() || "";
  const enfermedadesFinal = String(inv.enfermedades || "").trim() || "";

  await db.execute({
    sql: `INSERT INTO perfiles_clientes (usuario_id, edad, estatura, peso_kg, genero, gustos, disgustos, enfermedades, intencion_atleta, telefono)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'coach', ?)
          ON CONFLICT(usuario_id) DO UPDATE SET
            edad = COALESCE(excluded.edad, perfiles_clientes.edad),
            estatura = COALESCE(excluded.estatura, perfiles_clientes.estatura),
            peso_kg = COALESCE(excluded.peso_kg, perfiles_clientes.peso_kg),
            genero = COALESCE(excluded.genero, perfiles_clientes.genero),
            gustos = COALESCE(NULLIF(excluded.gustos, ''), perfiles_clientes.gustos),
            disgustos = COALESCE(NULLIF(excluded.disgustos, ''), perfiles_clientes.disgustos),
            enfermedades = COALESCE(NULLIF(excluded.enfermedades, ''), perfiles_clientes.enfermedades),
            intencion_atleta = 'coach',
            telefono = COALESCE(excluded.telefono, perfiles_clientes.telefono)`,
    args: [
      clienteId,
      inv.edad != null ? Number(inv.edad) : null,
      inv.estatura != null ? Number(inv.estatura) : null,
      inv.peso_kg != null ? Number(inv.peso_kg) : null,
      inv.genero || null,
      gustosFinal,
      disgustosFinal,
      enfermedadesFinal,
      telefono
    ]
  });

  const hayPerimetros = !!(datosMed.perimetros && Object.keys(datosMed.perimetros).length);
  if (inv.peso_kg != null || datosMed.grasa != null || hayPerimetros) {
    const extra = JSON.stringify(construirDatosExtraMedicion(datosMed));
    await db.execute({
      sql: "INSERT INTO mediciones (usuario_id, peso, grasa, datos_extra) VALUES (?, ?, ?, ?)",
      args: [
        clienteId,
        inv.peso_kg != null ? Number(inv.peso_kg) : null,
        datosMed.grasa != null ? Number(datosMed.grasa) : null,
        extra
      ]
    });
  }

  const upd = await db.execute({
    sql: `UPDATE invitaciones_presenciales
          SET status = 'active', cliente_id = ?
          WHERE id = ? AND status = 'pending'`,
    args: [clienteId, Number(inv.id)]
  });
  if ((upd.rowsAffected ?? upd.meta?.rows_affected ?? 0) === 0) {
    return { ok: false, status: 409, error: "El código ya no está disponible." };
  }

  const userRes = await db.execute({
    sql: "SELECT * FROM usuarios WHERE id = ?",
    args: [clienteId]
  });
  let usuario = sanitizeUsuario(userRes.rows[0]);
  if (enrichUsuarioConSuscripcion) {
    usuario = await enrichUsuarioConSuscripcion(db, usuario);
  }
  if (enrichUsuarioVinculo) {
    usuario = await enrichUsuarioVinculo(db, usuario);
  }
  const token = signToken(usuario);

  return { ok: true, usuario, token };
}

module.exports = {
  asegurarTablaInvitacionesPresenciales,
  crearInvitacionPresencial,
  listarInvitacionesCoach,
  previewInvitacion,
  reclamarInvitacion,
  normalizarCodigoReclamo,
  DIAS_EXPIRA
};
