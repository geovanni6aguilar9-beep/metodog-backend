/**
 * Planificador de combos por comida — Google Gemini.
 * Selecciona alimentos SOLO del catálogo enviado y calcula porciones para cubrir macros.
 * Env: GEMINI_API_KEY · opcional GEMINI_MODEL
 */

const MODELOS_FALLBACK = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash"
];

function resolverGeminiApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  ).trim();
}

function parseJsonSeguro(text) {
  if (!text) return null;
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

function redondear(n) {
  return Math.round(n * 10) / 10;
}

function normalizarCatalogo(catalogo) {
  if (!Array.isArray(catalogo)) return [];
  const map = new Map();
  for (const a of catalogo) {
    const id = parseInt(a?.id, 10);
    if (!id || id <= 0) continue;
    const nombre = String(a?.nombre || "").trim();
    if (!nombre) continue;
    const porcion = num(a?.porcion_base, 1) || 1;
    map.set(id, {
      id,
      nombre,
      porcion_base: porcion,
      unidad: String(a?.unidad || "g").trim() || "g",
      calorias: num(a?.calorias ?? a?.kcal),
      proteinas: num(a?.proteinas ?? a?.prot),
      carbohidratos: num(a?.carbohidratos ?? a?.carb),
      grasas: num(a?.grasas ?? a?.gras),
      sodio: num(a?.sodio)
    });
  }
  return Array.from(map.values());
}

function macrosDesdeCatalogo(item, cantidad) {
  const base = num(item?.porcion_base, 1) || 1;
  const factor = num(cantidad, 0) / base;
  return {
    calorias: redondear(num(item.calorias) * factor),
    proteinas: redondear(num(item.proteinas) * factor),
    carbohidratos: redondear(num(item.carbohidratos) * factor),
    grasas: redondear(num(item.grasas) * factor),
    sodio: redondear(num(item.sodio) * factor)
  };
}

function sumarMacrosLista(items) {
  return items.reduce(
    (t, m) => ({
      calorias: t.calorias + num(m.calorias),
      proteinas: t.proteinas + num(m.proteinas),
      carbohidratos: t.carbohidratos + num(m.carbohidratos),
      grasas: t.grasas + num(m.grasas),
      sodio: t.sodio + num(m.sodio)
    }),
    { calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, sodio: 0 }
  );
}

function normalizarCombo(obj, catalogoMap) {
  if (!obj || typeof obj !== "object") return null;
  const nombre = String(obj.nombre || obj.titulo || "").trim();
  const consejo = String(obj.consejo || obj.nota || "").trim() || null;

  const rawItems = Array.isArray(obj.alimentos_sugeridos)
    ? obj.alimentos_sugeridos
    : Array.isArray(obj.alimentos)
      ? obj.alimentos
      : [];

  const alimentos_sugeridos = [];
  for (const row of rawItems.slice(0, 12)) {
    const id = parseInt(row?.id_alimento ?? row?.id ?? row?.idAlimento, 10);
    const cantidad = num(row?.cantidad_sugerida ?? row?.cantidad, 0);
    if (!id || cantidad <= 0) continue;
    const cat = catalogoMap.get(id);
    if (!cat) continue;
    const cantidadOk = Math.round(cantidad * 10) / 10;
    const macros = macrosDesdeCatalogo(cat, cantidadOk);
    alimentos_sugeridos.push({
      id_alimento: id,
      nombre: cat.nombre,
      cantidad_sugerida: cantidadOk,
      unidad: cat.unidad,
      porcion_base: cat.porcion_base,
      ...macros
    });
  }

  if (!alimentos_sugeridos.length) return null;

  const macros_combo = sumarMacrosLista(alimentos_sugeridos);
  Object.keys(macros_combo).forEach((k) => {
    macros_combo[k] = redondear(macros_combo[k]);
  });

  return {
    nombre: nombre || "Combo sugerido",
    consejo,
    alimentos_sugeridos,
    macros_combo
  };
}

function mensajeErrorAmigable(motivo, esAdmin = false, detalle = "") {
  if (motivo === "sin_api_key") {
    return esAdmin
      ? "Falta GEMINI_API_KEY en Render (Google AI Studio → API key)."
      : "El planificador IA está descansando. Intenta más tarde.";
  }
  if (motivo === "cuota" || motivo === "429") {
    return "El planificador IA está descansando. Intenta más tarde.";
  }
  if (motivo === "sin_catalogo") {
    return "No hay alimentos en tu biblioteca. Recarga la app o contacta a tu coach.";
  }
  if (motivo === "sin_objetivo") {
    return "Primero ejecuta la calculadora metabólica para definir tus macros del día.";
  }
  if (motivo === "formato_key") {
    return detalle || "La clave de Gemini parece incompleta. Revisa GEMINI_API_KEY en Render.";
  }
  if (esAdmin && detalle) {
    return `Gemini: ${detalle.slice(0, 180)}`;
  }
  return "El planificador IA está descansando. Intenta más tarde.";
}

function extraerTextoGemini(data) {
  const cand = data?.candidates?.[0];
  if (!cand) {
    const block = data?.promptFeedback?.blockReason;
    return { text: "", blockReason: block || "sin_candidatos" };
  }
  const text = (cand.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (cand.finishReason === "SAFETY") {
    return { text, blockReason: "safety" };
  }
  return { text, blockReason: null };
}

async function llamarGemini(apiKey, model, system, user, usarJsonMode) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.45,
      maxOutputTokens: 2048
    }
  };
  if (usarJsonMode) {
    body.generationConfig.responseMimeType = "application/json";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function generarRecetaComida(payload) {
  const apiKey = resolverGeminiApiKey();
  if (!apiKey) return { ok: false, motivo: "sin_api_key" };

  const comida = String(payload?.comida || "Comida").trim() || "Comida";
  const catalogo = normalizarCatalogo(payload?.catalogo);
  if (!catalogo.length) return { ok: false, motivo: "sin_catalogo" };

  const plan = payload?.plan || null;
  const macrosObjetivo =
    payload?.macros_objetivo_comida ||
    plan?.referencia_comida_equilibrada ||
    plan?.macros_faltantes_comida ||
    null;

  if (!macrosObjetivo || num(macrosObjetivo.calorias) <= 0) {
    return { ok: false, motivo: "sin_objetivo" };
  }

  const catalogoMap = new Map(catalogo.map((c) => [c.id, c]));
  const envModel = (process.env.GEMINI_MODEL || "").trim();
  const modelos = envModel
    ? [envModel, ...MODELOS_FALLBACK.filter((m) => m !== envModel)]
    : MODELOS_FALLBACK;

  const system = `Eres un Planificador Nutricional Deportivo de MétodoG (México).
Tu trabajo NO es dar recetas de cocina ni pasos de preparación.

OBJETIVO: Armar un COMBO de alimentos para una comida (desayuno, comida, cena, etc.) que se acerque a los macros objetivo indicados.

REGLA DE ORO — CATÁLOGO CERRADO:
- SOLO puedes elegir alimentos del arreglo "catalogo" usando su "id" exacto como id_alimento.
- PROHIBIDO inventar alimentos, marcas genéricas o ítems que no estén en el catálogo.
- Las cantidades deben expresarse en la unidad del catálogo (g, ml, pieza, cucharada).
- Los macros del catálogo son POR porcion_base: calcula cantidad_sugerida para acercarte al objetivo.
- Usa entre 2 y 6 alimentos por combo. Variedad realista (proteína + carb + grasa/fruta según objetivo).

CONTEXTO DEL PLAN (si viene):
- objetivo "definir" = déficit — combos ligeros, proteína alta, grasas controladas.
- objetivo "subir" = volumen — combos saciantes, más carbohidratos y calorías.
- objetivo "mantener" = equilibrio.

Si hay macros_actuales_comida, los alimentos que sugieras deben COMPLEMENTAR lo ya puesto (no duplicar el mismo id salvo que tenga sentido sumar porción).

Responde SOLO JSON válido (sin markdown):
{
  "nombre": "nombre creativo del combo (máx. 60 caracteres, ej. Yogur con manzana y avena)",
  "consejo": "1 frase corta: qué cubre este combo y por qué encaja con el objetivo",
  "alimentos_sugeridos": [
    { "id_alimento": número_id_del_catalogo, "cantidad_sugerida": número }
  ]
}`;

  const catalogoLite = catalogo.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    porcion_base: c.porcion_base,
    unidad: c.unidad,
    kcal: c.calorias,
    prot: c.proteinas,
    carb: c.carbohidratos,
    gras: c.grasas,
    sodio: c.sodio
  }));

  const user = JSON.stringify({
    comida,
    macros_objetivo_comida: {
      calorias: redondear(num(macrosObjetivo.calorias)),
      proteinas: redondear(num(macrosObjetivo.proteinas)),
      carbohidratos: redondear(num(macrosObjetivo.carbohidratos)),
      grasas: redondear(num(macrosObjetivo.grasas)),
      sodio: redondear(num(macrosObjetivo.sodio))
    },
    macros_actuales_comida: payload?.macros_actuales_comida || plan?.macros_esta_comida || null,
    macros_faltantes_comida: payload?.macros_faltantes_comida || null,
    plan: plan
      ? {
          objetivo: plan.objetivo,
          etiqueta: plan.etiqueta,
          objetivo_dia: plan.objetivo_dia,
          restante_dia: plan.restante_dia
        }
      : null,
    catalogo: catalogoLite
  });

  let ultimoError = "api_error";
  let ultimoDetalle = "";

  for (const model of modelos) {
    for (const usarJson of [true, false]) {
      try {
        const { res, data } = await llamarGemini(apiKey, model, system, user, usarJson);

        if (res.status === 429) {
          return { ok: false, motivo: "cuota", detalle: "Cuota Gemini agotada (429)" };
        }

        if (!res.ok) {
          const errMsg = data?.error?.message || JSON.stringify(data).slice(0, 300);
          console.warn(`[recetaIaGemini] ${model} json=${usarJson} HTTP ${res.status}:`, errMsg);
          ultimoError = res.status === 404 ? "modelo_no_disponible" : "api_error";
          ultimoDetalle = errMsg;
          continue;
        }

        const { text, blockReason } = extraerTextoGemini(data);
        if (blockReason) {
          console.warn(`[recetaIaGemini] ${model} bloqueado:`, blockReason);
          ultimoError = "bloqueado";
          ultimoDetalle = String(blockReason);
          continue;
        }

        const combo = normalizarCombo(parseJsonSeguro(text), catalogoMap);
        if (combo) {
          return { ok: true, receta: combo, combo, ia: true, comida, modelo: model };
        }

        console.warn(`[recetaIaGemini] ${model} parse vacío:`, text.slice(0, 200));
        ultimoError = "parse_error";
        ultimoDetalle = text.slice(0, 120) || "respuesta vacía";
      } catch (err) {
        console.warn(`[recetaIaGemini] ${model}:`, err?.message || err);
        ultimoError = "red";
        ultimoDetalle = err?.message || String(err);
      }
    }
  }

  return { ok: false, motivo: ultimoError, detalle: ultimoDetalle };
}

function geminiConfigurado() {
  return !!resolverGeminiApiKey();
}

function formatoKeyPareceValido() {
  const k = resolverGeminiApiKey();
  return k.length >= 15;
}

async function probarConexionGemini() {
  const apiKey = resolverGeminiApiKey();
  if (!apiKey) {
    return { ok: false, motivo: "sin_api_key", detalle: "No hay GEMINI_API_KEY en Render." };
  }
  if (!formatoKeyPareceValido()) {
    return {
      ok: false,
      motivo: "formato_key",
      detalle: "GEMINI_API_KEY demasiado corta o vacía en Render."
    };
  }

  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  const { res, data } = await llamarGemini(
    apiKey,
    model,
    "Responde solo: OK",
    '{"test":true}',
    false
  );

  if (!res.ok) {
    return {
      ok: false,
      motivo: "api_error",
      detalle: data?.error?.message || `HTTP ${res.status}`,
      modelo: model,
      http: res.status
    };
  }

  const { text } = extraerTextoGemini(data);
  return { ok: true, modelo: model, respuesta: (text || "OK").slice(0, 80) };
}

module.exports = {
  generarRecetaComida,
  normalizarCatalogo,
  mensajeErrorAmigable,
  geminiConfigurado,
  formatoKeyPareceValido,
  probarConexionGemini,
  resolverGeminiApiKey
};
