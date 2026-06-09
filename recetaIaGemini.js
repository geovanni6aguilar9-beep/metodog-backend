/**
 * Recetas creativas por comida — Google Gemini.
 * Env: GEMINI_API_KEY (o GOOGLE_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY)
 * Opcional: GEMINI_MODEL (default gemini-2.5-flash)
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

function normalizarIngredientes(alimentos) {
  if (!Array.isArray(alimentos)) return [];
  return alimentos
    .map((a) => {
      const cantidad = num(a?.cantidad, 0);
      if (!cantidad || cantidad <= 0) return null;
      const nombre = String(a?.nombre || "").trim();
      if (!nombre) return null;
      return {
        nombre,
        cantidad: Math.round(cantidad * 10) / 10,
        unidad: String(a?.unidad || "g").trim() || "g",
        calorias: Math.round(num(a?.calorias) * 10) / 10,
        proteinas: Math.round(num(a?.proteinas) * 10) / 10,
        carbohidratos: Math.round(num(a?.carbohidratos) * 10) / 10,
        grasas: Math.round(num(a?.grasas) * 10) / 10
      };
    })
    .filter(Boolean);
}

function normalizarReceta(obj) {
  if (!obj || typeof obj !== "object") return null;
  const nombre = String(obj.nombre || obj.titulo || "").trim();
  const tiempo = parseInt(obj.tiempo_minutos ?? obj.tiempo ?? obj.tiempo_estimado, 10);
  const pasosRaw = Array.isArray(obj.pasos)
    ? obj.pasos
    : Array.isArray(obj.pasos_preparacion)
      ? obj.pasos_preparacion
      : [];
  const pasos = pasosRaw.map((p) => String(p).trim()).filter(Boolean).slice(0, 10);
  if (!nombre && !pasos.length) return null;
  return {
    nombre: nombre || "Platillo del plan",
    tiempo_minutos: Number.isNaN(tiempo) || tiempo <= 0 ? null : tiempo,
    pasos
  };
}

function recetaDesdeTextoLibre(text, comida) {
  const lineas = String(text || "")
    .split(/\n/)
    .map((l) => l.replace(/^\d+[\).\-\s]+/, "").trim())
    .filter((l) => l.length > 6);
  if (lineas.length === 0) return null;
  if (lineas.length === 1) {
    return {
      nombre: `Platillo ${comida}`.slice(0, 60),
      tiempo_minutos: null,
      pasos: [lineas[0]]
    };
  }
  return {
    nombre: `Platillo ${comida}`.slice(0, 60),
    tiempo_minutos: null,
    pasos: lineas.slice(0, 8)
  };
}

function mensajeErrorAmigable(motivo, esAdmin = false, detalle = "") {
  if (motivo === "sin_api_key") {
    return esAdmin
      ? "Falta GEMINI_API_KEY en Render (Google AI Studio → API key)."
      : "El chef de IA está descansando en este momento. Intenta más tarde.";
  }
  if (motivo === "cuota" || motivo === "429") {
    return "El chef de IA está descansando en este momento. Intenta más tarde.";
  }
  if (motivo === "sin_ingredientes") {
    return "Agrega al menos un alimento a esta comida para generar una receta.";
  }
  if (motivo === "formato_key") {
    return detalle || "La clave de Gemini no es válida. Crea una nueva en AI Studio (debe empezar con AIzaSy).";
  }
  if (esAdmin && detalle) {
    return `Gemini: ${detalle.slice(0, 180)}`;
  }
  return "El chef de IA está descansando en este momento. Intenta más tarde.";
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
      temperature: 0.65,
      maxOutputTokens: 1024
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
  const ingredientes = normalizarIngredientes(payload?.alimentos);
  if (!ingredientes.length) return { ok: false, motivo: "sin_ingredientes" };

  const macros = payload?.macros_totales || {};
  const envModel = (process.env.GEMINI_MODEL || "").trim();
  const modelos = envModel
    ? [envModel, ...MODELOS_FALLBACK.filter((m) => m !== envModel)]
    : MODELOS_FALLBACK;

  const system = `Eres un Chef Nutricional Deportivo de MétodoG (México).
Convierte la lista EXACTA de ingredientes del atleta en una receta creativa y práctica.

REGLAS ABSOLUTAS:
- Usa ÚNICAMENTE los ingredientes y cantidades enviados. PROHIBIDO agregar aceites, mantequilla, salsas, azúcar, harina u otros ingredientes no listados.
- Sal, pimienta o especias secas en pizca permitidas si no alteran macros.
- NO sustituyas ni omitas ingredientes del plan.
- Tono: directo, motivador, para atleta en preparación. Español México.

Responde SOLO JSON válido (sin markdown):
{
  "nombre": "nombre creativo del platillo (máx. 60 caracteres)",
  "tiempo_minutos": número entero,
  "pasos": ["paso 1", "paso 2", "máximo 8 pasos"]
}`;

  const user = JSON.stringify({
    comida,
    ingredientes,
    macros_totales: {
      calorias: Math.round(num(macros.calorias) * 10) / 10,
      proteinas: Math.round(num(macros.proteinas) * 10) / 10,
      carbohidratos: Math.round(num(macros.carbohidratos) * 10) / 10,
      grasas: Math.round(num(macros.grasas) * 10) / 10
    }
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

        let receta = normalizarReceta(parseJsonSeguro(text));
        if (!receta && text) receta = recetaDesdeTextoLibre(text, comida);
        if (receta) {
          return { ok: true, receta, ia: true, comida, modelo: model };
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
  return k.startsWith("AIza");
}

/** Prueba mínima de conexión (solo diagnóstico admin). */
async function probarConexionGemini() {
  const apiKey = resolverGeminiApiKey();
  if (!apiKey) {
    return { ok: false, motivo: "sin_api_key", detalle: "No hay GEMINI_API_KEY en Render." };
  }
  if (!formatoKeyPareceValido()) {
    return {
      ok: false,
      motivo: "formato_key",
      detalle: `La key empieza con "${apiKey.slice(0, 4)}…" — debe ser de AI Studio y comenzar con AIzaSy. Crea una nueva con «Crear clave de API».`
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
  normalizarIngredientes,
  mensajeErrorAmigable,
  geminiConfigurado,
  formatoKeyPareceValido,
  probarConexionGemini,
  resolverGeminiApiKey
};
