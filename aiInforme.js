/**
 * Opinión IA para informe mensual de anatomía (OpenAI).
 * Requiere OPENAI_API_KEY en Render. Sin key → null (frontend usa reglas).
 */

function getFetch() {
  if (typeof fetch === "function") return fetch;
  try {
    // Node 18+ suele exponer fetch o undici.
    // eslint-disable-next-line global-require
    const undici = require("undici");
    if (typeof undici?.fetch === "function") return undici.fetch;
  } catch (_) {
    // ignore
  }
  return null;
}

function parseJsonSeguro(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function normalizarSalida(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const opinion = String(obj.opinion || obj.resumen || '').trim();
  const siguiente = Array.isArray(obj.siguiente_paso)
    ? obj.siguiente_paso
    : Array.isArray(obj.siguientePaso)
      ? obj.siguientePaso
      : [];
  const recomendaciones = Array.isArray(obj.recomendaciones) ? obj.recomendaciones : [];

  const siguiente_paso = siguiente.map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
  const recs = recomendaciones.map((s) => String(s).trim()).filter(Boolean).slice(0, 6);

  if (!opinion && !siguiente_paso.length && !recs.length) return null;

  return {
    opinion: opinion || 'Análisis del mes listo.',
    siguiente_paso,
    recomendaciones: recs
  };
}

async function generarOpinionInformeMensual(payload) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return { ok: false, motivo: 'sin_api_key' };

  const fetchFn = getFetch();
  if (!fetchFn) return { ok: false, motivo: "no_fetch" };

  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const { mes, grupos, balanceScore, fuenteGrupos, reglasBase } = payload || {};

  const system = `Eres un coach de fuerza en la app MétodoG (México).
Analiza el volumen mensual por grupo muscular (series con peso×reps registradas).
Responde SOLO JSON válido (sin markdown):
{
  "opinion": "1-2 frases claras sobre el mes",
  "siguiente_paso": ["3 acciones concretas para la PRÓXIMA semana, con series aproximadas"],
  "recomendaciones": ["2-4 bullets de equilibrio o prioridad"]
}
Reglas: español, tono directo y motivador; NO inventes datos que no estén en el input; si hay grupos en 0, dilo; prioriza empuje/tirón y pierna si aplica.`;

  const user = JSON.stringify({
    mes: mes || '—',
    balance_score: balanceScore ?? 0,
    fuente_grupos: fuenteGrupos || 'nombre',
    grupos: (grupos || []).map((g) => ({
      grupo: g.grupo,
      series: g.series || 0,
      tonelaje_kg: Math.round(g.tonelaje || 0)
    })),
    notas_reglas: reglasBase || []
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[aiInforme] OpenAI HTTP', res.status, errText.slice(0, 200));
      return { ok: false, motivo: 'openai_error' };
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = normalizarSalida(parseJsonSeguro(content));
    if (!parsed) return { ok: false, motivo: 'parse_error' };

    return { ok: true, ia: true, ...parsed };
  } catch (err) {
    console.warn('[aiInforme]', err?.message || err);
    return { ok: false, motivo: 'request_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { generarOpinionInformeMensual };
