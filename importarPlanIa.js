/**
 * IA Gemini — parsear texto caótico de dieta coach → JSON estructurado.
 * Fallback cuando el parser por reglas no alcanza.
 */

const MODELOS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

function apiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function parseJson(text) {
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

async function llamarGemini(prompt) {
  const key = apiKey();
  if (!key) throw new Error('GEMINI_API_KEY no configurada en Render.');

  let lastErr = null;
  for (const model of MODELOS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
        })
      });
      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
        continue;
      }
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      const json = parseJson(text);
      if (json) return json;
      lastErr = new Error('Gemini no devolvió JSON válido.');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Gemini no disponible.');
}

/**
 * @returns {Promise<{ ok, datos_dieta, resumen, muestra, avisos, parser: 'ia' }>}
 */
async function previewImportDietaIa(texto) {
  const prompt = `Eres un parser de dietas para coaches fitness en México.
Del texto siguiente, extrae comidas (Desayuno, Comida, Cena, Snacks) y alimentos con cantidad y unidad.
Reglas:
- Cantidad puede estar en paréntesis: "Avena (40 gr)" → alimento Avena, 40, g
- Unidades: g, gr, ml, kg, unidad, cucharada, taza, pieza, rebanada
- Ignora filas Total/subtotal y columnas de kcal/macros sueltas
- Si no hay título de comida, agrupa en Desayuno
- Responde SOLO JSON:
{"comidas":[{"nombre":"Desayuno","alimentos":[{"nombre":"Avena","cantidad":40,"unidad":"g"}]}],"avisos":[]}

TEXTO:
${String(texto || '').slice(0, 12000)}`;

  const json = await llamarGemini(prompt);
  const comidas = (json?.comidas || []).map((c) => ({
    nombre: String(c.nombre || 'Desayuno').trim(),
    alimentos: (c.alimentos || []).map((a) => ({
      nombre: String(a.nombre || '').trim(),
      cantidadSeleccionada: parseFloat(a.cantidad) || 100,
      porcion_base: 100,
      unidad: String(a.unidad || 'g').trim() || 'g'
    })).filter((a) => a.nombre)
  })).filter((c) => c.alimentos.length);

  const total = comidas.reduce((n, c) => n + c.alimentos.length, 0);
  if (total < 1) return { ok: false, error: 'La IA no detectó alimentos en el texto.' };

  return {
    ok: true,
    tipo: 'dieta',
    parser: 'ia',
    datos_dieta: comidas,
    resumen: { alimentos: total, comidas: comidas.map((c) => c.nombre) },
    muestra: comidas.flatMap((c) => c.alimentos.slice(0, 2).map((a) => ({
      comida: c.nombre,
      nombre: a.nombre,
      detalle: `${a.cantidadSeleccionada} ${a.unidad}`
    }))).slice(0, 5),
    avisos: Array.isArray(json.avisos) ? json.avisos : ['Interpretado con IA — revisa porciones.']
  };
}

module.exports = { previewImportDietaIa };
