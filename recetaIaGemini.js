/**
 * Recetas creativas por comida — Google Gemini.
 * Requiere GEMINI_API_KEY en Render. Sin key → error amigable al cliente.
 */

function parseJsonSeguro(text) {
  if (!text) return null;
  const raw = String(text).trim();
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

function mensajeErrorAmigable(motivo) {
  if (motivo === "sin_api_key") {
    return "El chef de IA está descansando en este momento. Intenta más tarde.";
  }
  if (motivo === "cuota" || motivo === "429") {
    return "El chef de IA está descansando en este momento. Intenta más tarde.";
  }
  if (motivo === "sin_ingredientes") {
    return "Agrega al menos un alimento a esta comida para generar una receta.";
  }
  return "El chef de IA está descansando en este momento. Intenta más tarde.";
}

async function generarRecetaComida(payload) {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return { ok: false, motivo: "sin_api_key" };

  const comida = String(payload?.comida || "Comida").trim() || "Comida";
  const ingredientes = normalizarIngredientes(payload?.alimentos);
  if (!ingredientes.length) return { ok: false, motivo: "sin_ingredientes" };

  const macros = payload?.macros_totales || {};
  const model = (process.env.GEMINI_MODEL || "gemini-2.0-flash").trim();

  const system = `Eres un Chef Nutricional Deportivo de MétodoG (México).
Tu trabajo es convertir la lista EXACTA de ingredientes del atleta en una receta creativa y práctica.

REGLAS ABSOLUTAS:
- Usa ÚNICAMENTE los ingredientes y cantidades enviados. PROHIBIDO agregar aceites, mantequilla, salsas, azúcar, harina u otros ingredientes no listados.
- Sal, pimienta, ajo en polvo o especias secas en cantidad mínima están permitidos SOLO si no alteran macros de forma relevante.
- NO sustituyas ni omitas ingredientes del plan.
- NO inventes porciones distintas a las indicadas.
- La receta debe respetar el perfil de macros del plan (proteína/carbos/grasas del día de esa comida).
- Tono: directo, motivador, para atleta en preparación. Español México.
- Pasos cortos y accionables (cocina real, no poesía).

Responde SOLO JSON válido (sin markdown ni texto extra):
{
  "nombre": "nombre creativo del platillo (máx. 60 caracteres)",
  "tiempo_minutos": número entero estimado de preparación,
  "pasos": ["paso 1", "paso 2", "... máximo 8 pasos, cada uno máx. 120 caracteres"]
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.65,
          maxOutputTokens: 900,
          responseMimeType: "application/json"
        }
      })
    });

    if (res.status === 429) return { ok: false, motivo: "cuota" };

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("[recetaIaGemini] HTTP", res.status, JSON.stringify(data).slice(0, 300));
      return { ok: false, motivo: res.status === 429 ? "cuota" : "api_error" };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    const parsed = parseJsonSeguro(text);
    const receta = normalizarReceta(parsed);
    if (!receta) return { ok: false, motivo: "parse_error" };

    return { ok: true, receta, ia: true, comida };
  } catch (err) {
    console.warn("[recetaIaGemini]", err?.message || err);
    return { ok: false, motivo: "red" };
  }
}

module.exports = {
  generarRecetaComida,
  normalizarIngredientes,
  mensajeErrorAmigable
};
