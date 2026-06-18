/**
 * Planificador de combos por comida — Google Gemini.
 * Selecciona alimentos SOLO del catálogo enviado y calcula porciones para cubrir macros.
 * Env: GEMINI_API_KEY · opcional GEMINI_MODEL
 */

const MODELOS_FALLBACK = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const TIMEOUT_GEMINI_MS = 26000;
const TIMEOUT_GEMINI_PROBE_MS = 15000;
const MAX_CATALOGO_PROMPT = 96;

let optimizarCombo = (combo) => combo;
let optimizarDietaDia = (dieta) => dieta;
let OPTIMIZER_DISPONIBLE = false;
try {
  const mod = require("./comboMacroOptimizer");
  optimizarCombo = mod.optimizarCombo;
  optimizarDietaDia = mod.optimizarDietaDia;
  OPTIMIZER_DISPONIBLE = typeof mod.optimizarDietaDia === "function";
} catch (err) {
  console.warn("[recetaIaGemini] comboMacroOptimizer no cargado:", err.message);
}

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
      grupo: String(a?.grupo || "").trim() || null,
      grupo_equivalencia: String(a?.grupo_equivalencia || "").trim() || null,
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

/** Catálogo autoritativo desde Turso (evita biblioteca cacheada en el cliente). */
async function cargarCatalogoDesdeDb(db) {
  if (!db) return [];
  const result = await db.execute({
    sql: `SELECT id, nombre, grupo, grupo_equivalencia, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio
          FROM alimentos WHERE coach_id IS NULL ORDER BY grupo, nombre ASC`
  });
  return normalizarCatalogo(result.rows || []);
}

/** DB gana sobre payload del frontend (macros/unidades actualizados). */
function fusionarCatalogo(catalogoDb, catalogoPayload) {
  const map = new Map();
  for (const a of catalogoPayload || []) {
    if (a?.id) map.set(a.id, a);
  }
  for (const a of catalogoDb || []) {
    map.set(a.id, a);
  }
  return Array.from(map.values());
}

/** Catálogo más chico en el prompt = respuesta Gemini más rápida (optimizador usa el catálogo completo). */
function recortarCatalogoPrompt(catalogo, maxItems = MAX_CATALOGO_PROMPT) {
  if (!catalogo?.length || catalogo.length <= maxItems) return catalogo;
  const porGrupo = new Map();
  for (const c of catalogo) {
    const g = String(c.grupo_equivalencia || c.grupo || "otro").toLowerCase();
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g).push(c);
  }
  const grupos = [...porGrupo.keys()];
  const out = [];
  let gi = 0;
  while (out.length < maxItems && grupos.some((g) => (porGrupo.get(g) || []).length)) {
    const g = grupos[gi % grupos.length];
    const arr = porGrupo.get(g);
    if (arr?.length) out.push(arr.shift());
    gi++;
  }
  return out;
}

function catalogoLiteParaPrompt(catalogo) {
  return recortarCatalogoPrompt(catalogo).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    porcion_base: c.porcion_base,
    unidad: c.unidad,
    kcal: c.calorias,
    prot: c.proteinas,
    carb: c.carbohidratos,
    gras: c.grasas
  }));
}

async function resolverCatalogoIa(payload, db) {
  const catalogoPayload = normalizarCatalogo(payload?.catalogo);
  if (!db) return catalogoPayload;
  try {
    const catalogoDb = await cargarCatalogoDesdeDb(db);
    if (!catalogoDb.length) return catalogoPayload;
    return fusionarCatalogo(catalogoDb, catalogoPayload);
  } catch (err) {
    console.warn("[recetaIaGemini] resolverCatalogoIa:", err.message);
    return catalogoPayload;
  }
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

function normalizarCantidadSugerida(cantidad, cat) {
  const qty = num(cantidad, 0);
  if (qty <= 0) return 0;
  const base = num(cat?.porcion_base, 1) || 1;
  const unidad = String(cat?.unidad || "g").toLowerCase();
  const nombre = String(cat?.nombre || "").toLowerCase();
  const esPolvo =
    nombre.includes("whey") ||
    nombre.includes("caseína") ||
    nombre.includes("caseina") ||
    (nombre.includes("proteína") && nombre.includes("polvo")) ||
    (nombre.includes("proteina") && nombre.includes("polvo"));

  if (["scoop", "pieza", "cucharada"].includes(unidad)) {
    return Math.max(1, Math.round(qty));
  }
  if (esPolvo && qty >= 1 && qty <= 3) {
    if (unidad === "g" && base >= 10) return redondear(qty * base);
    return Math.max(1, Math.round(qty));
  }
  if ((unidad === "g" || unidad === "ml") && base >= 10 && qty < base * 0.6) {
    const esEnteroChico = qty >= 1 && qty <= 5 && Math.abs(qty - Math.round(qty)) < 0.01;
    if (esEnteroChico) return redondear(qty * base);
  }
  return redondear(qty);
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
    if (!id) continue;
    const cat = catalogoMap.get(id);
    if (!cat) continue;
    const cantidadOk = normalizarCantidadSugerida(
      num(row?.cantidad_sugerida ?? row?.cantidad, 0),
      cat
    );
    if (!cantidadOk) continue;
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
    return "Cuota de Google Gemini agotada. Entra a aistudio.google.com → API key → revisa uso/facturación, o espera 1 hora y reintenta.";
  }
  if (motivo === "parse_error") {
    return "La IA respondió pero no pudimos leer el combo. Toca Reintentar.";
  }
  if (motivo === "bloqueado") {
    return "La IA no pudo sugerir esta comida. Prueba otra comida o ajusta tus «evitar».";
  }
  if (motivo === "timeout") {
    const base = "La IA tardó demasiado. Intenta de nuevo (menos comidas vacías o en 1 min).";
    return esAdmin && detalle ? `${base} (${detalle.slice(0, 100)})` : base;
  }
  if (motivo === "api_error" || motivo === "modelo_no_disponible" || motivo === "red") {
    const base = "El servicio de IA no respondió. Espera 1 minuto y vuelve a intentar.";
    return esAdmin && detalle ? `${base} (${detalle.slice(0, 120)})` : base;
  }
  if (motivo === "sin_catalogo") {
    return "No hay alimentos en tu biblioteca. Recarga la app o contacta a tu coach.";
  }
  if (motivo === "sin_objetivo") {
    return "Primero ejecuta la calculadora metabólica para definir tus macros del día.";
  }
  if (motivo === "macros_cubiertos") {
    return detalle || "Ya cubriste tus macros del día en esta comida.";
  }
  if (motivo === "sin_comidas") {
    return detalle || "Todas tus comidas ya tienen alimentos. Desmarca «solo vacías» o vacía una comida.";
  }
  if (motivo === "comidas_incompletas") {
    return "La IA no armó todas las comidas del día. Toca Reintentar (a veces pasa en el primer intento).";
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

async function llamarGemini(apiKey, model, system, user, usarJsonMode, opts = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.45,
      maxOutputTokens: opts.maxOutputTokens ?? 2048
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
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_GEMINI_MS)
  });

  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function generarRecetaComida(payload, db = null) {
  const apiKey = resolverGeminiApiKey();
  if (!apiKey) return { ok: false, motivo: "sin_api_key" };

  const comida = String(payload?.comida || "Comida").trim() || "Comida";
  const catalogo = await resolverCatalogoIa(payload, db);
  if (!catalogo.length) return { ok: false, motivo: "sin_catalogo" };

  const plan = payload?.plan || null;
  const macrosObjetivo =
    payload?.macros_objetivo_comida ||
    plan?.macros_objetivo_combo ||
    plan?.referencia_comida_equilibrada ||
    null;

  if (!macrosObjetivo || num(macrosObjetivo.calorias) <= 0) {
    if (plan?.mensaje_objetivo) {
      return { ok: false, motivo: "macros_cubiertos", detalle: plan.mensaje_objetivo };
    }
    return { ok: false, motivo: "sin_objetivo" };
  }

  const catalogoMap = new Map(catalogo.map((c) => [c.id, c]));
  const envModel = (process.env.GEMINI_MODEL || "").trim();
  const modelos = envModel
    ? [envModel, ...MODELOS_FALLBACK.filter((m) => m !== envModel)]
    : MODELOS_FALLBACK;

  const system = `Eres un Planificador Nutricional Deportivo de MétodoG (México).
Tu trabajo NO es dar recetas de cocina ni pasos de preparación.

OBJETIVO: Armar un COMBO apetitoso y coherente para UNA comida del día que se acerque a los macros objetivo.

BALANCE DE MACROS (crítico — igual de importante que kcal y proteína):
- Debes acercarte a carbohidratos Y grasas del objetivo, no solo kcal/proteína.
- Tolerancia orientativa: ±30 kcal, ±5 g en proteína, carbohidratos y grasas (no busques perfección matemática).
- Si subes proteína con carnes/huevos/nueces/aguacate, COMPENSA con carbs limpios (arroz, avena, fruta, pan, papa) y MODERA grasas.
- Para llenar kcal restantes prioriza carbohidratos complejos antes que más grasa.
- Incluye al menos una fuente clara de carbohidratos en cada combo (no solo proteína + grasa).

GUSTO GASTRONÓMICO (muy importante):
- El combo debe sonar rico y lógico para un atleta mexicano: nombres creativos pero reales (ej. "Bowl de yogur con manzana y granola", "Tacos fitness de pollo con tortilla").
- Desayuno: prioriza opciones ligeras, lácteos, fruta, avena, huevo, pan — evita platos de comida fuerte (arroz con pollo a las 7am).
- Comida/Cena: puedes combinar proteína + carb complejo + verdura.
- Snacks: porciones pequeñas, prácticas (fruta, yogur, nueces, galletas de arroz).
- Mezcla texturas y colores; no repitas el mismo tipo 3 veces si hay alternativas en catálogo.

PREFERENCIAS DEL ATLETA (si vienen en preferencias):
- gustos_lista: PRIORIZA esos grupos al elegir (más variedad dentro de lo que le gusta).
- disgustos_lista: PROHIBIDO usar alimentos de esas categorías (el catálogo ya viene filtrado, respétalo).
- notas_medicas: ajústalas (ej. hipertensión → menos sodio; diabetes → carbs controlados).

REGLA DE ORO — CATÁLOGO CERRADO:
- SOLO alimentos del arreglo "catalogo" con su "id" exacto como id_alimento.
- PROHIBIDO inventar alimentos o marcas.
- Cantidades en la unidad del catálogo (g, ml, scoop, pieza). Macros son POR porcion_base.
- 1 scoop de whey, caseína o proteína vegetal = cantidad_sugerida: 1 (no confundir scoop con gramos).
- Entre 2 y 6 alimentos por combo.

CONTEXTO DEL PLAN:
- objetivo "definir" = déficit — ligero, proteína alta.
- objetivo "subir" = volumen — saciante, más carbs/kcal.
- objetivo "mantener" = equilibrio.

MODO OBJETIVO (campo plan.modo_objetivo):
- ultima_comida: el combo debe cubrir casi todo restante_dia (última comida vacía).
- repartir_restante: parte equitativa del restante entre comidas vacías.
- cerrar_dia: ajuste fino; prioriza restante_dia sobre referencia.
- llenar_comida: completa esta comida hacia referencia_comida_equilibrada.

Puedes incluir creatina, whey o BCAA del catálogo si ayudan a proteína sin pasarte de kcal.

Si hay macros_actuales_comida, COMPLEMENTA lo ya puesto (evita duplicar el mismo id).

Responde SOLO JSON válido (sin markdown):
{
  "nombre": "nombre apetitoso del combo (máx. 60 caracteres)",
  "consejo": "1-2 frases: qué cubre en macros, por qué encaja con su objetivo Y con sus gustos",
  "alimentos_sugeridos": [
    { "id_alimento": número_id_del_catalogo, "cantidad_sugerida": número }
  ]
}`;

  const catalogoLite = catalogoLiteParaPrompt(catalogo);

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
    preferencias: payload?.preferencias || null,
    plan: plan
      ? {
          objetivo: plan.objetivo,
          etiqueta: plan.etiqueta,
          objetivo_dia: plan.objetivo_dia,
          consumido_dia: plan.consumido_dia,
          restante_dia: plan.restante_dia,
          modo_objetivo: plan.modo_objetivo,
          comidas_vacias: plan.comidas_vacias
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

        const comboRaw = normalizarCombo(parseJsonSeguro(text), catalogoMap);
        if (comboRaw) {
          const targetCombo = {
            calorias: redondear(num(macrosObjetivo.calorias)),
            proteinas: redondear(num(macrosObjetivo.proteinas)),
            carbohidratos: redondear(num(macrosObjetivo.carbohidratos)),
            grasas: redondear(num(macrosObjetivo.grasas)),
            sodio: redondear(num(macrosObjetivo.sodio))
          };
          let combo = comboRaw;
          try {
            combo = optimizarCombo(comboRaw, catalogoMap, targetCombo);
          } catch (optErr) {
            console.warn("[recetaIaGemini] optimizarCombo:", optErr.message);
          }
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

function normalizarDietaDia(obj, catalogoMap, nombresEsperados) {
  if (!obj || typeof obj !== "object") return null;
  const nombrePlan = String(obj.nombre_plan || obj.nombre || "Plan del día").trim();
  const consejoGeneral = String(obj.consejo_general || obj.consejo || "").trim() || null;
  const rawComidas = Array.isArray(obj.comidas) ? obj.comidas : [];

  const comidas = [];
  for (const row of rawComidas.slice(0, 8)) {
    const nombreComida = String(row?.comida || row?.nombre_comida || "").trim();
    if (!nombreComida) continue;
    const combo = normalizarCombo(
      {
        nombre: row.nombre || row.nombre_combo,
        consejo: row.consejo,
        alimentos_sugeridos: row.alimentos_sugeridos || row.alimentos
      },
      catalogoMap
    );
    if (!combo) continue;
    comidas.push({
      comida: nombreComida,
      nombre_comida: nombreComida,
      nombre: combo.nombre,
      consejo: combo.consejo,
      alimentos_sugeridos: combo.alimentos_sugeridos,
      macros_combo: combo.macros_combo
    });
  }

  if (!comidas.length) return null;
  return { nombre_plan: nombrePlan, consejo_general: consejoGeneral, comidas };
}

async function generarDietaDiaCompleta(payload, db = null) {
  const apiKey = resolverGeminiApiKey();
  if (!apiKey) return { ok: false, motivo: "sin_api_key" };

  const catalogo = await resolverCatalogoIa(payload, db);
  if (!catalogo.length) return { ok: false, motivo: "sin_catalogo" };

  const plan = payload?.plan || null;
  if (!plan?.objetivo_dia) return { ok: false, motivo: "sin_objetivo" };

  const comidasInput = Array.isArray(payload?.comidas) ? payload.comidas : [];
  const soloVacias = !!payload?.solo_vacias;
  const comidasTarget = soloVacias
    ? comidasInput.filter((c) => c?.vacia)
    : comidasInput;

  if (!comidasTarget.length) {
    return { ok: false, motivo: "sin_comidas", detalle: "Todas las comidas ya tienen alimentos." };
  }

  const catalogoMap = new Map(catalogo.map((c) => [c.id, c]));
  const envModel = (process.env.GEMINI_MODEL || "").trim();
  const modelos = envModel
    ? [envModel, ...MODELOS_FALLBACK.filter((m) => m !== envModel)]
    : MODELOS_FALLBACK;

  const system = `Eres un Planificador Nutricional Deportivo de MétodoG (México).
Arma un PLAN DE DÍA COMPLETO: un combo por cada comida indicada en "comidas_a_planear".

REGLAS:
- SOLO alimentos del catálogo (id_alimento exacto).
- La SUMA de todos los combos debe acercarse a restante_dia u objetivo_dia (kcal, P, C, G, sodio).
- BALANCE CRÍTICO: acércate a carbohidratos y grasas del día (±5 g y ±30 kcal). No armes un día hiperproteico.
- PROTEÍNA: máximo 2 fuentes proteicas fuertes en TODO el día (ej. pollo + whey, o pescado + huevo). NO combines whey + yogur griego + leche + almendras + pollo en el mismo día.
- CARBOHIDRATOS: si objetivo_dia pide muchos carbos (~250g+), incluye arroz, avena, papa, tortilla o pan en varias comidas desde el inicio. No dependas solo de frutas/verduras para carbos.
- Verduras: porción normal 80–150 g por comida (nunca 300–400 g). Frutos secos: máx. 30 g en snacks.
- Reparte carbs complejos entre comidas; grasas con moderación (aceite, aguacate, nueces).
- Respeta preferencias (gustos/disgustos/notas_medicas).
- Gusto gastronómico: desayuno ligero, comida/cena completas, colaciones prácticas.
- Variedad: no repitas el mismo plato en todas las comidas.
- Whey/caseína: opcional, máx. 1 scoop por día si lo usas. No es obligatorio en cada comida.
- OBLIGATORIO: el array "comidas" debe tener EXACTAMENTE ${comidasTarget.length} elementos — uno por cada fila de comidas_a_planear, con el mismo texto en "comida".
- Proteína en polvo (whey/caseína/vegetal): cantidad_sugerida = número de scoops (1 scoop ≈ 1 porción), NUNCA gramos.

Responde SOLO JSON válido:
{
  "nombre_plan": "título del día (máx. 60 caracteres)",
  "consejo_general": "1-2 frases del enfoque del día",
  "comidas": [
    {
      "comida": "nombre exacto de la comida (ej. Desayuno)",
      "nombre": "nombre del combo",
      "consejo": "frase corta",
      "alimentos_sugeridos": [{ "id_alimento": id, "cantidad_sugerida": n }]
    }
  ]
}`;

  const catalogoLite = catalogoLiteParaPrompt(catalogo);

  const user = JSON.stringify({
    comidas_a_planear: comidasTarget.map((c) => ({
      nombre: c.nombre,
      vacia: c.vacia,
      macros_actuales: c.macros
    })),
    objetivo_dia: plan.objetivo_dia,
    restante_dia: plan.restante_dia,
    referencia_por_comida: plan.referencia_comida_equilibrada,
    macros_objetivo_por_comida: payload?.macros_objetivo_por_comida || null,
    num_comidas_obligatorias: comidasTarget.length,
    preferencias: payload?.preferencias || null,
    catalogo: catalogoLite
  });

  let ultimoError = "api_error";
  let ultimoDetalle = "";
  const intentos = [
    { model: modelos[0], usarJson: true },
    { model: modelos[1] || modelos[0], usarJson: true },
    { model: modelos[0], usarJson: false }
  ];

  for (const { model, usarJson } of intentos) {
    try {
      const { res, data } = await llamarGemini(apiKey, model, system, user, usarJson, {
        maxOutputTokens: 6144,
        timeoutMs: TIMEOUT_GEMINI_MS
      });
      if (res.status === 429) return { ok: false, motivo: "cuota" };
      if (!res.ok) {
        ultimoError = res.status === 404 ? "modelo_no_disponible" : "api_error";
        ultimoDetalle = data?.error?.message || `HTTP ${res.status}`;
        continue;
      }
      const { text, blockReason } = extraerTextoGemini(data);
      if (blockReason) {
        ultimoError = "bloqueado";
        ultimoDetalle = String(blockReason);
        continue;
      }
      const parsed = parseJsonSeguro(text);
      const dietaRaw = normalizarDietaDia(parsed, catalogoMap);
      if (dietaRaw) {
          if (dietaRaw.comidas.length < comidasTarget.length) {
            console.warn(
              `[recetaIaGemini] comidas incompletas: ${dietaRaw.comidas.length}/${comidasTarget.length}`
            );
            ultimoError = "comidas_incompletas";
            ultimoDetalle = `Gemini devolvió ${dietaRaw.comidas.length} de ${comidasTarget.length} comidas`;
            continue;
          }
          const targetDia = {
            calorias: redondear(num(plan.restante_dia?.calorias ?? plan.objetivo_dia?.calorias)),
            proteinas: redondear(num(plan.restante_dia?.proteinas ?? plan.objetivo_dia?.proteinas)),
            carbohidratos: redondear(
              num(plan.restante_dia?.carbohidratos ?? plan.objetivo_dia?.carbohidratos)
            ),
            grasas: redondear(num(plan.restante_dia?.grasas ?? plan.objetivo_dia?.grasas)),
            sodio: redondear(num(plan.restante_dia?.sodio ?? plan.objetivo_dia?.sodio ?? 2300))
          };
          const macrosPreOpt = dietaRaw.comidas.reduce(
            (t, c) => {
              const m = c.macros_combo || {};
              return {
                calorias: t.calorias + num(m.calorias),
                proteinas: t.proteinas + num(m.proteinas),
                carbohidratos: t.carbohidratos + num(m.carbohidratos),
                grasas: t.grasas + num(m.grasas)
              };
            },
            { calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0 }
          );
          let dieta = dietaRaw;
          try {
            for (let optPass = 0; optPass < 2; optPass++) {
              dieta = optimizarDietaDia(dieta, catalogoMap, targetDia);
              const gapKcal = num(targetDia.calorias) - num(dieta.macros_plan?.calorias);
              if (gapKcal <= 80) break;
            }
            dieta.macros_ajustados = OPTIMIZER_DISPONIBLE;
            dieta.catalogo_fuente = db ? "turso+payload" : "payload";
            dieta.macros_pre_optimizador = macrosPreOpt;
            dieta.comidas_esperadas = comidasTarget.length;
          } catch (optErr) {
            console.warn("[recetaIaGemini] optimizarDietaDia:", optErr.message);
          }
        return {
          ok: true,
          dieta,
          ia: true,
          modelo: model,
          optimizer: OPTIMIZER_DISPONIBLE ? "v4.2" : "off"
        };
      }
      ultimoError = "parse_error";
      ultimoDetalle = (text || "").slice(0, 160) || "respuesta vacía";
    } catch (err) {
      const msg = err?.message || String(err);
      ultimoDetalle = msg;
      ultimoError = /timeout|aborted/i.test(msg) ? "timeout" : "red";
    }
  }

  if (ultimoError === "parse_error") {
    return { ok: false, motivo: "parse_error", detalle: ultimoDetalle };
  }
  return { ok: false, motivo: ultimoError, detalle: ultimoDetalle };
}

function geminiConfigurado() {
  return !!resolverGeminiApiKey();
}

/** AIzaSy… (clásico) y AQ.… (AI Studio 2026+) son válidos; solo longitud mínima. */
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
    false,
    { timeoutMs: TIMEOUT_GEMINI_PROBE_MS }
  );

  if (!res.ok) {
    return {
      ok: false,
      motivo: res.status === 429 ? "cuota" : "api_error",
      detalle: data?.error?.message || `HTTP ${res.status}`,
      modelo: model,
      http: res.status
    };
  }

  const { text } = extraerTextoGemini(data);
  return {
    ok: true,
    modelo: model,
    respuesta: (text || "OK").slice(0, 80),
    optimizer: OPTIMIZER_DISPONIBLE ? "v4.1" : "off"
  };
}

module.exports = {
  generarRecetaComida,
  generarDietaDiaCompleta,
  normalizarCatalogo,
  cargarCatalogoDesdeDb,
  mensajeErrorAmigable,
  geminiConfigurado,
  formatoKeyPareceValido,
  probarConexionGemini,
  resolverGeminiApiKey,
  OPTIMIZER_DISPONIBLE
};
