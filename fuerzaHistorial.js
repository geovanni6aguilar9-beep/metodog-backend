/** Utilidades historial_fuerza — deduplicación e idempotencia (sync con frontend deduplicarHistorialFuerza). */

function claveDuplicadoFuerza(row) {
  const usuarioId = row.usuario_id ?? row.usuarioId ?? "";
  const fecha = String(row.fecha || "").slice(0, 10);
  const nSerie = row.numero_serie != null ? Number(row.numero_serie) : 0;
  const ejercicio = String(row.ejercicio || "").trim();
  return `${usuarioId}|${fecha}|${ejercicio}|${nSerie}`;
}

/** Conserva la fila con id más bajo por clave lógica. */
function deduplicarFilasHistorialFuerza(filas = []) {
  const porClave = new Map();
  for (const row of filas) {
    const key = claveDuplicadoFuerza(row);
    const prev = porClave.get(key);
    if (!prev || Number(row.id) < Number(prev.id)) {
      porClave.set(key, row);
    }
  }
  return [...porClave.values()].sort(
    (a, b) => Number(a.id) - Number(b.id) || String(a.fecha).localeCompare(String(b.fecha))
  );
}

module.exports = {
  claveDuplicadoFuerza,
  deduplicarFilasHistorialFuerza
};
