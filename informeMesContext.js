/** Si el mes del informe aún está en curso (corte parcial, no evaluación final). */
function contextoMesInforme(mes) {
  const parts = String(mes || "").split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!y || !m) {
    return { corteParcial: false, diaMes: null, pctMes: null, diasEnMes: null };
  }
  const now = new Date();
  const esMesActual = y === now.getFullYear() && m === now.getMonth() + 1;
  const diasEnMes = new Date(y, m, 0).getDate();
  if (!esMesActual) {
    return { corteParcial: false, diaMes: diasEnMes, pctMes: 100, diasEnMes };
  }
  const diaMes = now.getDate();
  const pctMes = Math.round((diaMes / diasEnMes) * 100);
  return {
    corteParcial: diaMes < diasEnMes,
    diaMes,
    pctMes,
    diasEnMes
  };
}

module.exports = { contextoMesInforme };
