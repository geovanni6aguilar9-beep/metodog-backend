/** Sustitución puntual de un alimento en la dieta del alumno (sin reescribir el plan completo desde el cliente). */

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

function parseDatosDieta(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function obtenerComidas(datos) {
  if (Array.isArray(datos)) return { comidas: datos, shape: "array" };
  if (datos && typeof datos === "object" && Array.isArray(datos.planDiario)) {
    return { comidas: datos.planDiario, shape: "modoLibre" };
  }
  return { comidas: null, shape: null };
}

function empaquetarComidas(datosOriginales, comidas, shape) {
  if (shape === "modoLibre" && datosOriginales && typeof datosOriginales === "object") {
    return { ...datosOriginales, planDiario: comidas };
  }
  return comidas;
}

/**
 * Reemplaza un alimento por idUnico con datos de biblioteca + cantidad validada.
 * @returns {{ ok: boolean, datos?: object, error?: string, motivo?: string }}
 */
function aplicarSustitutoEnDatosDieta(datosDieta, { comidaId, idUnico, alimentoNuevo }) {
  const parsed = parseDatosDieta(datosDieta);
  const { comidas, shape } = obtenerComidas(parsed);
  if (!comidas) {
    return { ok: false, motivo: "formato_dieta", error: "No hay un plan de comidas válido." };
  }
  const cid = comidaId;
  const uid = String(idUnico || "");
  if (cid == null || !uid) {
    return { ok: false, motivo: "payload", error: "comida_id e id_unico son obligatorios." };
  }

  let encontrado = false;
  const nuevas = comidas.map((c) => {
    if (String(c.id) !== String(cid) && Number(c.id) !== Number(cid)) return c;
    const alimentos = (c.alimentos || []).map((a) => {
      if (String(a.idUnico) !== uid) return a;
      encontrado = true;
      return {
        ...alimentoNuevo,
        idUnico: uid
      };
    });
    return { ...c, alimentos };
  });

  if (!encontrado) {
    return { ok: false, motivo: "no_encontrado", error: "No se encontró ese alimento en tu plan." };
  }

  return {
    ok: true,
    datos: empaquetarComidas(parsed, nuevas, shape),
    shape
  };
}

/**
 * Arma fila de alimento desde biblioteca Turso + cantidad sugerida del cálculo de equivalencias.
 */
function mapearAlimentoDesdeBiblioteca(filaBib, cantidad, idUnicoOriginal) {
  if (!filaBib) return null;
  const qty = num(cantidad);
  if (qty <= 0) return null;
  return {
    id: filaBib.id,
    idUnico: idUnicoOriginal,
    nombre: filaBib.nombre,
    grupo: filaBib.grupo,
    grupo_equivalencia: filaBib.grupo_equivalencia,
    porcion_base: filaBib.porcion_base,
    unidad: filaBib.unidad || "g",
    calorias: filaBib.calorias,
    proteinas: filaBib.proteinas,
    carbohidratos: filaBib.carbohidratos,
    grasas: filaBib.grasas,
    sodio: filaBib.sodio,
    cantidadSeleccionada: Math.round(qty * 10) / 10
  };
}

module.exports = {
  parseDatosDieta,
  aplicarSustitutoEnDatosDieta,
  mapearAlimentoDesdeBiblioteca
};
