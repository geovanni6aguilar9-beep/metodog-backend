/**
 * §6.6 Fase 2 — PDF → texto (Gemini) → previewImportPlan / texto para parser local.
 */

const pdfParse = require('pdf-parse');
const { previewImportPlan } = require('./importarPlan');

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_TEXTO_PDF = 18000;
const MODELOS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

function apiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function limpiarSalidaGemini(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:csv|text)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t.replace(/^\uFEFF/, '').trim();
}

async function llamarGeminiTexto(prompt) {
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
          generationConfig: { temperature: 0.1 }
        })
      });
      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
        continue;
      }
      const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (out?.trim()) return limpiarSalidaGemini(out);
      lastErr = new Error('Gemini no devolvió texto.');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Gemini no disponible.');
}

function promptGemini(textoPdf, tipo) {
  const base = String(textoPdf || '').slice(0, MAX_TEXTO_PDF);
  if (tipo === 'rutina') {
    return `Eres un extractor de datos fitness. Lee el texto del PDF y conviértelo SOLO a CSV con columnas:
dia,grupo,nombre,series,reps,rir
Días: Lunes–Sábado. Sin explicaciones ni markdown.

TEXTO PDF:
${base}`;
  }
  return `Eres un extractor de datos fitness. Lee el PDF de dieta y devuelve SOLO texto plano listo para pegar en Excel:
- Una fila por alimento (cantidad en el nombre o en columnas).
- Separa comidas con línea en blanco o títulos: Desayuno, Comida 1, Comida 2, Cena, Snack, Colación, Post-entreno.
- Ignora totales y macros sueltos si no son alimentos.
Sin explicaciones ni markdown.

TEXTO PDF:
${base}`;
}

async function extraerTextoPdf(buffer) {
  const data = await pdfParse(buffer);
  return String(data?.text || '').replace(/\uFEFF/g, '').trim();
}

/**
 * @param {Buffer} buffer
 * @param {{ tipo?: 'dieta'|'rutina' }} opts
 */
async function importarPdfPreview(buffer, opts = {}) {
  if (!buffer?.length) return { ok: false, error: 'PDF vacío.' };
  if (buffer.length > MAX_PDF_BYTES) {
    return { ok: false, error: 'PDF demasiado grande (máx. 5 MB).' };
  }

  const tipo = opts.tipo === 'rutina' ? 'rutina' : 'dieta';
  const textoPdf = await extraerTextoPdf(buffer);
  if (!textoPdf || textoPdf.length < 8) {
    return { ok: false, error: 'El PDF no tiene texto legible (escaneado/imagen). Prueba Excel o pegado manual.' };
  }

  const textoImport = await llamarGeminiTexto(promptGemini(textoPdf, tipo));
  if (!textoImport) {
    return { ok: false, error: 'La IA no pudo estructurar el PDF.' };
  }

  const preview = previewImportPlan(textoImport, { tipo });
  const avisos = ['Extraído desde PDF con IA — revisa la vista previa.'];

  if (preview.ok) {
    return {
      ...preview,
      ok: true,
      tipo,
      texto: textoImport,
      parser: 'pdf',
      avisos: [...(preview.avisos || []), ...avisos]
    };
  }

  return {
    ok: true,
    tipo,
    texto: textoImport,
    parser: 'pdf',
    preview_parcial: true,
    avisos: [
      ...avisos,
      'Usa la vista previa local — el formato flexible se completará en el cliente.'
    ]
  };
}

module.exports = { importarPdfPreview, extraerTextoPdf };
