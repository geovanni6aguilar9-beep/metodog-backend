const jwt = require("jsonwebtoken");
const { coachPuedeEditarPerfilAjeno } = require("./coachSuscripcion");

const MSG_GRACIA_SOLO_LECTURA =
  "Tu acceso de edición está en pausa. Tus alumnos siguen viendo su plan actual; reactiva tu suscripción para actualizar rutinas, dietas y medidas.";

const JWT_SECRET = (process.env.JWT_SECRET || "metodog-dev-cambiar-en-produccion").trim();
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

function signToken(user) {
  return jwt.sign(
    { id: Number(user.id), rol: user.rol, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function toNum(v) {
  if (v == null) return null;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function sanitizeUsuario(row) {
  if (!row) return null;
  const { password: _pw, ...usuario } = row;
  usuario.id = toNum(usuario.id);
  if (usuario.coach_id != null && usuario.coach_id !== "") {
    usuario.coach_id = toNum(usuario.coach_id);
  } else if (usuario.coach_id === "" || usuario.coach_id === 0) {
    usuario.coach_id = null;
  }
  usuario.paquete_rutina_6_dias = !!usuario.paquete_rutina_6_dias;
  usuario.paquete_grandfathered = !!usuario.paquete_grandfathered;
  return usuario;
}

function isPublicApiRoute(req) {
  const method = req.method;
  const path = req.path;

  if (method === "POST" && [
    "/api/login",
    "/api/registro",
    "/api/solicitar-recuperacion",
    "/api/cambiar-password",
    "/api/pagos/webhook"
  ].includes(path)) {
    return true;
  }
  if (
    (method === "GET" || method === "HEAD") &&
    (path === "/api/ping" || path === "/api/health")
  ) {
    return true;
  }
  if (method === "GET" && path === "/api/alimentos") return true;
  if (method === "GET" && path === "/api/directorio/coaches") return true;
  if (method === "GET" && /^\/api\/coach\/\d+$/.test(path)) return true;
  return false;
}

function requireAuthMiddleware(req, res, next) {
  if (!req.path.startsWith("/api")) return next();
  if (isPublicApiRoute(req)) return next();

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: "Sesión requerida" });

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Sesión expirada. Vuelve a iniciar sesión." });
  }
}

async function puedeAccederUsuario(db, authUser, targetUserId) {
  const tid = parseInt(targetUserId, 10);
  const aid = parseInt(authUser.id, 10);
  if (!tid || Number.isNaN(tid)) return false;
  if (tid === aid) return true;
  if (authUser.rol === "SUPERADMIN") return true;
  if (authUser.rol === "COACH") {
    const r = await db.execute({
      sql: "SELECT coach_id FROM usuarios WHERE id = ?",
      args: [tid]
    });
    return r.rows[0]?.coach_id === aid;
  }
  return false;
}

async function assertAccesoUsuario(db, req, res, targetUserId) {
  if (!(await puedeAccederUsuario(db, req.user, targetUserId))) {
    res.status(403).json({ error: "No tienes permiso para este recurso" });
    return false;
  }
  return true;
}

/** Lectura permitida; escritura sobre alumnos bloqueada si el coach no tiene suscripción activa. */
async function assertAccesoUsuarioEdicion(db, req, res, targetUserId) {
  if (!(await assertAccesoUsuario(db, req, res, targetUserId))) return false;
  const tid = parseInt(targetUserId, 10);
  const aid = parseInt(req.user.id, 10);
  if (tid === aid) return true;
  if (!(await coachPuedeEditarPerfilAjeno(db, req.user, targetUserId))) {
    res.status(402).json({
      error: MSG_GRACIA_SOLO_LECTURA,
      coach_solo_lectura: true
    });
    return false;
  }
  return true;
}

async function assertCoachOAdmin(db, req, res) {
  if (req.user.rol === "COACH" || req.user.rol === "SUPERADMIN") return true;
  try {
    const r = await db.execute({
      sql: "SELECT rol FROM usuarios WHERE id = ?",
      args: [req.user.id]
    });
    const rolDb = r.rows[0]?.rol;
    if (rolDb === "COACH" || rolDb === "SUPERADMIN") return true;
  } catch (_) { /* fallback abajo */ }
  res.status(403).json({ error: "Solo coaches pueden usar esta función" });
  return false;
}

function assertSuperAdmin(req, res) {
  if (req.user.rol === "SUPERADMIN") return true;
  res.status(403).json({ error: "Solo SUPERADMIN puede usar esta función" });
  return false;
}

/** Comunidad: solo el propio id en la URL (no suplantar a otro coach/admin). */
function assertComunidadSelf(req, res) {
  if (parseInt(req.params.id, 10) !== parseInt(req.user.id, 10)) {
    res.status(403).json({ error: "Solo puedes ver tu propia cartera" });
    return false;
  }
  return true;
}

module.exports = {
  signToken,
  verifyToken,
  sanitizeUsuario,
  requireAuthMiddleware,
  puedeAccederUsuario,
  assertAccesoUsuario,
  assertAccesoUsuarioEdicion,
  assertCoachOAdmin,
  assertSuperAdmin,
  assertComunidadSelf,
  isPublicApiRoute
};
