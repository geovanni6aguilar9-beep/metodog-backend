/**
 * Resiliencia Turso: reintentos ante 502/503/429 y mensajes humanos.
 * Envuelve el cliente libsql sin cambiar firmas de db.execute.
 */

const RETRIES = 3;
const BASE_MS = 450;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientTursoError(err) {
  const msg = String(err?.message || err || "");
  const code = String(err?.code || "");
  if (code === "SERVER_ERROR") return true;
  if (/HTTP status\s*(502|503|429|504)/i.test(msg)) return true;
  if (/SERVER_ERROR|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|network/i.test(msg)) {
    return true;
  }
  return false;
}

async function withTursoRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const reintentar = isTransientTursoError(err) && attempt < RETRIES - 1;
      if (!reintentar) throw err;
      const waitMs = BASE_MS * 2 ** attempt;
      console.warn(
        `[turso-retry] intento ${attempt + 1}/${RETRIES} falló (${err.message}). Reintento en ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

/** Cliente con execute (y batch si existe) con reintentos. */
function wrapTursoClient(client) {
  if (!client || typeof client.execute !== "function") return client;

  const executeOrig = client.execute.bind(client);
  client.execute = (...args) => withTursoRetry(() => executeOrig(...args));

  if (typeof client.batch === "function") {
    const batchOrig = client.batch.bind(client);
    client.batch = (...args) => withTursoRetry(() => batchOrig(...args));
  }

  return client;
}

/** Mensaje para JSON de API — nunca LibsqlError crudo al cliente. */
function mensajeErrorDb(err, fallback = "No se pudo completar la operación.") {
  if (isTransientTursoError(err)) {
    return "La base de datos no responde en este momento. Intenta de nuevo en unos segundos.";
  }
  const msg = err?.message ? String(err.message) : "";
  if (/LibsqlError|SERVER_ERROR|HTTP status\s*50[0-9]/i.test(msg)) {
    return "La base de datos no responde en este momento. Intenta de nuevo en unos segundos.";
  }
  return msg || fallback;
}

module.exports = {
  wrapTursoClient,
  withTursoRetry,
  isTransientTursoError,
  mensajeErrorDb
};
