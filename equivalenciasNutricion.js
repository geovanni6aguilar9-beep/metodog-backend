/** Cálculo matemático de sustitutos (sin IA). Macros por porcion_base del alimento en Turso. */

const SIN_SUSTITUTO = new Set(["sin_sustituto", "condimento", "libre"]);

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

/** Macros totales para una cantidad (misma fórmula que frontend macrosNutricion.js). */
function macrosEnCantidad(alimento, cantidad) {
  const base = num(alimento?.porcion_base, 1) || 1;
  const f = num(cantidad, base) / base;
  return {
    cal: num(alimento?.calorias) * f,
    prot: num(alimento?.proteinas) * f,
    carb: num(alimento?.carbohidratos) * f,
    gras: num(alimento?.grasas) * f,
    sod: num(alimento?.sodio) * f
  };
}

function cantidadParaIgualarMacro(alimento, macro, valorObjetivo) {
  const base = num(alimento?.porcion_base, 1) || 1;
  const macroPorPorcion = num(alimento?.[macro]);
  if (macroPorPorcion <= 0 || valorObjetivo <= 0) return null;
  const cantidad = (valorObjetivo * base) / macroPorPorcion;
  if (!cantidad || cantidad <= 0 || cantidad > 5000) return null;
  return Math.round(cantidad * 10) / 10;
}

function scoreCandidato(origen, candidato, cantidadCand, prioridad = "prot") {
  const mO = origen;
  const mC = macrosEnCantidad(candidato, cantidadCand);
  const pesoProt = prioridad === "prot" ? 3 : 1;
  const pesoCarb = prioridad === "carb" ? 3 : 1;
  const pesoGras = prioridad === "gras" ? 3 : 1;
  const diff =
    Math.abs(mC.prot - mO.prot) * pesoProt +
    Math.abs(mC.carb - mO.carb) * pesoCarb +
    Math.abs(mC.gras - mO.gras) * pesoGras +
    Math.abs(mC.cal - mO.cal) * 0.5 +
    Math.abs(mC.sod - mO.sod) * 0.02;
  return diff;
}

/**
 * @param {object} alimentoOriginal - fila biblioteca Turso
 * @param {number} cantidad - cantidad que come el cliente (en unidad del alimento)
 * @param {object[]} biblioteca - todas las filas alimentos
 * @param {{ prioridad?: string, limite?: number }} opts
 */
function calcularSustitutos(alimentoOriginal, cantidad, biblioteca = [], opts = {}) {
  const prioridad = opts.prioridad || "prot";
  const limite = opts.limite ?? 3;
  const ge = String(alimentoOriginal?.grupo_equivalencia || "").trim();

  if (!ge || SIN_SUSTITUTO.has(ge)) {
    return { ok: false, motivo: "sin_equivalencia", sustitutos: [] };
  }

  const macroKey =
    prioridad === "carb" ? "carbohidratos" : prioridad === "gras" ? "grasas" : "proteinas";

  const objetivo = macrosEnCantidad(alimentoOriginal, cantidad);
  if (objetivo[ prioridad === "carb" ? "carb" : prioridad === "gras" ? "gras" : "prot"] <= 0) {
    return { ok: false, motivo: "macro_objetivo_cero", sustitutos: [] };
  }

  const valorObjetivo = objetivo[prioridad === "carb" ? "carb" : prioridad === "gras" ? "gras" : "prot"];

  const candidatos = (biblioteca || []).filter((a) => {
    if (String(a.grupo_equivalencia || "") !== ge) return false;
    if (a.id && alimentoOriginal.id && a.id === alimentoOriginal.id) return false;
    if (String(a.nombre || "").toLowerCase() === String(alimentoOriginal.nombre || "").toLowerCase()) {
      return false;
    }
    return num(a[macroKey]) > 0;
  });

  const resultados = [];

  for (const cand of candidatos) {
    const cantidadSug = cantidadParaIgualarMacro(cand, macroKey, valorObjetivo);
    if (!cantidadSug) continue;
    const macrosSug = macrosEnCantidad(cand, cantidadSug);
    resultados.push({
      id: cand.id,
      nombre: cand.nombre,
      grupo: cand.grupo,
      cantidad_sugerida: cantidadSug,
      unidad: cand.unidad,
      porcion_base: cand.porcion_base,
      macros: {
        cal: Math.round(macrosSug.cal),
        prot: Math.round(macrosSug.prot * 10) / 10,
        carb: Math.round(macrosSug.carb * 10) / 10,
        gras: Math.round(macrosSug.gras * 10) / 10,
        sod: Math.round(macrosSug.sod)
      },
      diff_score: scoreCandidato(objetivo, cand, cantidadSug, prioridad)
    });
  }

  resultados.sort((a, b) => a.diff_score - b.diff_score);

  return {
    ok: true,
    prioridad,
    objetivo: {
      cal: Math.round(objetivo.cal),
      prot: Math.round(objetivo.prot * 10) / 10,
      carb: Math.round(objetivo.carb * 10) / 10,
      gras: Math.round(objetivo.gras * 10) / 10,
      sod: Math.round(objetivo.sod)
    },
    sustitutos: resultados.slice(0, limite)
  };
}

module.exports = {
  macrosEnCantidad,
  calcularSustitutos,
  SIN_SUSTITUTO
};
