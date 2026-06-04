/**
 * Opinión IA para informe mensual de anatomía (OpenAI).
 * Requiere OPENAI_API_KEY en Render. Sin key → null (frontend usa reglas).
 */

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

  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const {
    mes,
    grupos,
    balanceScore,
    fuenteGrupos,
    reglasBase,
    resumenRutina,
    corteParcial,
    diaMes,
    pctMes
  } = payload || {};
  const tienePlan = resumenRutina?.tiene_rutina && resumenRutina?.resumen_texto;
  const esParcial = !!corteParcial;

  const system = `Eres un asistente analítico de MétodoG (México). El plan de entrenamiento lo define el COACH del usuario.
Analiza el volumen REAL registrado este mes (series con peso×reps) vs el contexto del plan asignado.
Responde SOLO JSON válido (sin markdown):
{
  "opinion": "máximo 2 frases cortas (≤220 caracteres total)",
  "siguiente_paso": ["exactamente 3 acciones para la PRÓXIMA semana; cada una ≤90 caracteres; alinea con el plan del coach"],
  "recomendaciones": ["2 bullets máximo; cada uno ≤80 caracteres"]
}
Reglas: español México, directo y motivador; NO inventes datos.
${esParcial ? `CORTE PARCIAL DEL MES (aún no termina): NO evalúes el mes como final ni hables de "fracaso". Es seguimiento en curso (${pctMes ?? "?"}% del mes). Prioriza registrar series y cumplir los días que vienen.` : ""}
${tienePlan ? `PLAN ASIGNADO — reglas absolutas:
- Lee grupo_a_dia: cada grupo muscular tiene UN solo día. NUNCA pongas un grupo en un día distinto al de grupo_a_dia (ej. si Espalda→Lunes, JAMÁS digas espalda el Miércoles aunque Pectoral sí esté el Miércoles).
- PROHIBIDO juntar dos grupos en un paso si no comparten el mismo día en grupo_a_dia.
- Si falta volumen: "en tu [día según grupo_a_dia]" o "registra cuando hagas ese día".
- Muchos ceros con poco volumen total = probable falta de registro en la app, dilo primero.` : "Sin rutina asignada: usa solo volumen registrado."}
NUNCA sugieras ejercicios nuevos fuera del plan. Texto para móvil.`;

  const user = JSON.stringify({
    mes: mes || '—',
    corte_parcial: esParcial,
    dia_mes: diaMes ?? null,
    pct_mes: pctMes ?? null,
    balance_score: balanceScore ?? 0,
    fuente_grupos: fuenteGrupos || 'nombre',
    plan_coach: tienePlan
      ? {
          resumen: resumenRutina.resumen_texto,
          calendario_dias: resumenRutina.calendario_dias,
          grupo_a_dia: resumenRutina.grupo_a_dia,
          series_planeadas_por_grupo: resumenRutina.grupos_planeados
        }
      : null,
    volumen_real_mes: (grupos || []).map((g) => ({
      grupo: g.grupo,
      series: g.series || 0,
      tonelaje_kg: Math.round(g.tonelaje || 0)
    })),
    notas_reglas: reglasBase || []
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 320,
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
