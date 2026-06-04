const crypto = require("crypto");

const GRUPOS = [
  "Pectoral", "Espalda", "Hombro", "Bíceps", "Tríceps",
  "Cuádriceps", "Isquiosurales", "Glúteo", "Pantorrilla", "Otros"
];

function normalizarTexto(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRutina(datos) {
  if (!datos) return null;
  if (typeof datos === "string") {
    try { return JSON.parse(datos); } catch { return null; }
  }
  return typeof datos === "object" ? datos : null;
}

/** Extrae lista de ejercicios por día desde datos_rutina (coach o modo libre). */
function ejerciciosPorDia(datosRutina) {
  const raw = parseRutina(datosRutina);
  if (!raw) return [];

  const salida = [];
  const dias = Object.keys(raw).filter((k) => !k.startsWith("_") && k !== "_meta");

  for (const dia of dias.sort()) {
    const bloque = raw[dia];
    const lista = Array.isArray(bloque) ? bloque : bloque?.ejercicios;
    if (!Array.isArray(lista)) continue;

    for (const ej of lista) {
      if (!ej?.nombre) continue;
      let grupo = String(ej.grupo || ej.musculo || "Otros").trim() || "Otros";
      if (/hombro/i.test(grupo)) grupo = "Hombro";
      if (!GRUPOS.includes(grupo)) grupo = "Otros";
      const seriesPlan = parseInt(ej.series, 10) || (Array.isArray(ej.sets) ? ej.sets.length : 0) || 0;
      salida.push({
        dia,
        grupo: GRUPOS.includes(grupo) ? grupo : "Otros",
        nombre: String(ej.nombre).trim().slice(0, 60),
        series_plan: seriesPlan
      });
    }
  }
  return salida;
}

function inferirEnfoque(diasResumen) {
  const textos = diasResumen.map((d) => `${d.dia} ${d.foco}`).join(" ").toLowerCase();
  if (/push|empuje|pecho/.test(textos) && /pull|tir[oó]n|espalda/.test(textos)) {
    return "Rutina tipo Push/Pull (o empuje + tirón)";
  }
  if (/pierna|leg|cu[aá]driceps|isquio/.test(textos)) {
    return "Incluye días de pierna en el plan";
  }
  if (diasResumen.length === 1) {
    return `Bloque concentrado (${diasResumen[0].foco})`;
  }
  return `Plan de ${diasResumen.length} días de entrenamiento`;
}

/**
 * Resumen compacto para el prompt de IA (pocos tokens).
 * @param {object|string|null} datosRutina
 */
function buildResumenRutina(datosRutina) {
  const filas = ejerciciosPorDia(datosRutina);
  if (!filas.length) {
    return { tiene_rutina: false, fingerprint: "", resumen_texto: null, dias: [], grupos_planeados: {} };
  }

  const porGrupo = {};
  for (const g of GRUPOS) porGrupo[g] = 0;
  const porDia = new Map();

  for (const f of filas) {
    porGrupo[f.grupo] = (porGrupo[f.grupo] || 0) + (f.series_plan || 1);
    if (!porDia.has(f.dia)) porDia.set(f.dia, { grupos: new Set(), nombres: [] });
    const slot = porDia.get(f.dia);
    slot.grupos.add(f.grupo);
    if (slot.nombres.length < 5) slot.nombres.push(f.nombre);
  }

  const dias = [...porDia.keys()].sort().map((dia) => {
    const slot = porDia.get(dia);
    const gruposDia = [...slot.grupos].filter((g) => g !== "Otros");
    const foco = gruposDia.join(", ") || "General";
    return { dia, foco, grupos: gruposDia, ejercicios: slot.nombres };
  });

  /** Qué día del plan corresponde a cada grupo (para no mezclar músculos). */
  const grupo_a_dia = {};
  for (const d of dias) {
    for (const g of d.grupos) {
      if (!grupo_a_dia[g]) grupo_a_dia[g] = d.dia;
    }
  }

  const calendario_dias = dias.map((d) => ({
    dia: d.dia,
    grupos_permitidos: d.grupos,
    ejercicios: d.ejercicios
  }));

  const compacto = filas
    .map((f) => `${f.dia}:${f.grupo}:${f.nombre}:${f.series_plan}`)
    .sort()
    .join("|");
  const fingerprint = crypto.createHash("sha256").update(compacto).digest("hex").slice(0, 16);

  const enfoque = inferirEnfoque(dias);
  const lineasDias = dias.slice(0, 6).map((d) => `${d.dia} (${d.foco}): ${d.ejercicios.join(", ")}`);
  const resumen_texto = `${enfoque}. ${lineasDias.join(" · ")}`.slice(0, 480);

  return {
    tiene_rutina: true,
    fingerprint,
    resumen_texto,
    dias: dias.map((d) => d.dia),
    calendario_dias,
    grupo_a_dia,
    grupos_planeados: porGrupo,
    total_ejercicios: filas.length
  };
}

module.exports = { buildResumenRutina, ejerciciosPorDia };
