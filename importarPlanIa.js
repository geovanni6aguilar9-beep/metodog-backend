/**
 * IA Gemini — parsear texto caótico de dieta coach → JSON estructurado.
 * PDF móvil: siempre vía IA (texto aplanado ilegible para regex).
 */

const MODELOS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const MAX_TEXTO = 18000;

function apiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function esNombreAlimentoValido(nombre) {
  const s = String(nombre || '').trim();
  if (s.length < 2) return false;
  if (/^\d+([.,]\d+)?$/.test(s)) return false;
  if (!/[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/.test(s)) return false;
  return true;
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

function promptPdf(texto) {
  return `Eres un nutricionista experto. Lee este texto caótico extraído de un PDF de dieta de coach.
Tu tarea:
- Sepáralo en comidas distintas (Desayuno, Comida 1, Comida 2, Comida, Cena, Snack, Colación, Post-entreno, etc.).
- Extrae SOLO el NOMBRE LIMPIO del alimento (sin calorías ni macros pegados).
- Extrae la CANTIDAD numérica real y la unidad (g, gr, ml, unidad, cucharada, taza).
- Ignora filas Total/subtotal y columnas sueltas de kcal, proteína, carbohidratos, grasas.
- Si ves "DE POLLO 152 0 24", el alimento es "Pechuga de pollo" (o similar), NO incluyas los números de macros.
- Si ves "MAIZ (2 104 22 2 1", el alimento es "Maíz" con su porción real en gramos/unidades, NO copies los macros al nombre.
- Nunca uses un número solo como nombre de alimento.

Responde SOLO JSON válido:
{"comidas":[{"nombre":"Desayuno","alimentos":[{"nombre":"Avena","cantidad":40,"unidad":"g"}]}],"avisos":[]}

TEXTO PDF:
${String(texto || '').slice(0, MAX_TEXTO)}`;
}

function promptTexto(texto) {
  return `Eres un parser de dietas para coaches fitness en México.
Del texto siguiente, extrae comidas (Desayuno, Comida, Cena, Snacks) y alimentos con cantidad y unidad.
Reglas:
- Cantidad puede estar en paréntesis: "Avena (40 gr)" → alimento Avena, 40, g
- Unidades: g, gr, ml, kg, unidad, cucharada, taza, pieza, rebanada
- Ignora filas Total/subtotal y columnas de kcal/macros sueltas
- Nunca uses un número solo como nombre de alimento
- Responde SOLO JSON:
{"comidas":[{"nombre":"Desayuno","alimentos":[{"nombre":"Avena","cantidad":40,"unidad":"g"}]}],"avisos":[]}

TEXTO:
${String(texto || '').slice(0, MAX_TEXTO)}`;
}

function normalizarSalidaGemini(json, esPdf) {
  const comidas = (json?.comidas || []).map((c) => ({
    nombre: String(c.nombre || 'Desayuno').trim(),
    alimentos: (c.alimentos || [])
      .map((a) => ({
        nombre: String(a.nombre || '').trim(),
        cantidadSeleccionada: parseFloat(a.cantidad) || 0,
        porcion_base: 100,
        unidad: String(a.unidad || 'g').trim() || 'g'
      }))
      .filter((a) => esNombreAlimentoValido(a.nombre) && a.cantidadSeleccionada > 0)
  })).filter((c) => c.alimentos.length);

  const total = comidas.reduce((n, c) => n + c.alimentos.length, 0);
  if (total < 1) return { ok: false, error: 'La IA no detectó alimentos válidos en el texto.' };

  return {
    ok: true,
    tipo: 'dieta',
    parser: esPdf ? 'pdf-ia' : 'ia',
    datos_dieta: comidas,
    resumen: { alimentos: total, comidas: comidas.map((c) => c.nombre) },
    muestra: comidas.flatMap((c) => c.alimentos.slice(0, 2).map((a) => ({
      comida: c.nombre,
      nombre: a.nombre,
      detalle: `${a.cantidadSeleccionada} ${a.unidad}`
    }))).slice(0, 5),
    avisos: Array.isArray(json.avisos)
      ? json.avisos
      : [esPdf ? 'PDF interpretado con IA — revisa comidas y porciones.' : 'Interpretado con IA — revisa porciones.']
  };
}

/**
 * @param {string} texto
 * @param {{ origen?: 'pdf'|'texto' }} opts
 */
async function previewImportDietaIa(texto, opts = {}) {
  const esPdf = opts.origen === 'pdf';
  const prompt = esPdf ? promptPdf(texto) : promptTexto(texto);
  const json = await llamarGemini(prompt);
  return normalizarSalidaGemini(json, esPdf);
}

module.exports = { previewImportDietaIa, esNombreAlimentoValido };
