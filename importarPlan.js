/**
 * Importación CSV/texto de rutina o dieta (§6.6).
 * v1: CSV estructurado; PDF/IA en fase posterior.
 */

const MAX_BYTES = 256 * 1024;
const MAX_FILAS = 400;

const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const MAP_DIA = {
  lunes: "Lunes",
  lun: "Lunes",
  monday: "Lunes",
  mon: "Lunes",
  martes: "Martes",
  mar: "Martes",
  tuesday: "Martes",
  tue: "Martes",
  miercoles: "Miércoles",
  miércoles: "Miércoles",
  mier: "Miércoles",
  mié: "Miércoles",
  wednesday: "Miércoles",
  wed: "Miércoles",
  jueves: "Jueves",
  jue: "Jueves",
  thursday: "Jueves",
  thu: "Jueves",
  viernes: "Viernes",
  vie: "Viernes",
  friday: "Viernes",
  fri: "Viernes",
  sabado: "Sábado",
  sábado: "Sábado",
  sab: "Sábado",
  saturday: "Sábado",
  sat: "Sábado"
};

const COMIDAS_DEFAULT = ["Desayuno", "Comida", "Cena", "Snacks / Otros"];

const MAP_COMIDA = {
  desayuno: "Desayuno",
  breakfast: "Desayuno",
  comida: "Comida",
  almuerzo: "Comida",
  lunch: "Comida",
  cena: "Cena",
  dinner: "Cena",
  snacks: "Snacks / Otros",
  snack: "Snacks / Otros",
  otros: "Snacks / Otros",
  merienda: "Snacks / Otros",
  colacion: "Snacks / Otros",
  "colación": "Snacks / Otros",
  "snacks / otros": "Snacks / Otros"
};

const ALIAS_RUTINA = {
  dia: ["dia", "día", "day", "jornada"],
  grupo: ["grupo", "musculo", "músculo", "muscle", "zona"],
  nombre: ["nombre", "ejercicio", "exercise", "movimiento"],
  series: ["series", "sets", "serie"],
  reps: ["reps", "repeticiones", "rep", "reps objetivo"],
  rir: ["rir", "rpe", "reserva", "intensidad"]
};

const ALIAS_DIETA = {
  comida: ["comida", "meal", "momento", "tiempo"],
  alimento: ["alimento", "food", "nombre", "producto"],
  cantidad: ["cantidad", "gramos", "porcion", "porción", "qty", "amount", "gramaje"],
  unidad: ["unidad", "unit", "medida"]
};

const PLANTILLA_RUTINA_CSV = `dia,grupo,nombre,series,reps,rir
Lunes,Pecho,Press banca con barra,4,8,2
Lunes,Pecho,Press inclinado mancuernas,3,10,2
Martes,Espalda,Remo con barra,4,8-10,2
Martes,Espalda,Jalón al pecho,3,12,2
Jueves,Pierna,Sentadilla trasera,4,6,2
Jueves,Pierna,Prensa 45°,3,12,2`;

const PLANTILLA_DIETA_CSV = `comida,alimento,cantidad,unidad
Desayuno,Avena,80,g
Desayuno,Huevo entero,2,unidad
Comida,Arroz integral cocido,150,g
Comida,Pechuga de pollo,180,g
Comida,Aceite de oliva,10,g
Cena,Salmón,150,g
Cena,Boniato,200,g
Snacks / Otros,Yogur griego,125,g`;

function normHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectarSeparador(linea) {
  const comas = (linea.match(/,/g) || []).length;
  const puntos = (linea.match(/;/g) || []).length;
  const tabs = (linea.match(/\t/g) || []).length;
  if (tabs >= comas && tabs >= puntos) return "\t";
  return puntos > comas ? ";" : ",";
}

function parseCsvLinea(linea, sep) {
  const out = [];
  let cur = "";
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') {
        cur += '"';
        i++;
      } else enComillas = !enComillas;
    } else if (c === sep && !enComillas) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(texto) {
  const raw = String(texto || "").replace(/^\uFEFF/, "").trim();
  if (!raw) return { filas: [], headers: [], sep: "," };
  const lineas = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return { filas: [], headers: [], sep: "," };
  const sep = detectarSeparador(lineas[0]);
  const headers = parseCsvLinea(lineas[0], sep).map(normHeader);
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const cols = parseCsvLinea(lineas[i], sep);
    if (!cols.some((c) => String(c).trim())) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    obj.__raw = cols;
    filas.push(obj);
  }
  return { filas, headers, sep };
}

function mapearColumnas(headers, aliasMap) {
  const out = {};
  for (const [campo, aliases] of Object.entries(aliasMap)) {
    const idx = headers.findIndex((h) => aliases.includes(h) || aliases.some((a) => h.includes(a)));
    if (idx >= 0) out[campo] = idx;
  }
  return out;
}

function normalizarDia(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (DIAS_SEMANA.includes(s)) return s;
  const key = normHeader(s);
  return MAP_DIA[key] || null;
}

function normalizarComida(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (COMIDAS_DEFAULT.includes(s)) return s;
  const key = normHeader(s);
  return MAP_COMIDA[key] || s;
}

function parseSeriesReps(textoSeries, textoReps) {
  let series = parseInt(textoSeries, 10);
  let reps = String(textoReps || "").trim();
  const combo = String(textoSeries || "").trim();
  const m = combo.match(/^(\d+)\s*[x×]\s*(.+)$/i);
  if (m) {
    series = parseInt(m[1], 10);
    if (!reps) reps = m[2].trim();
  }
  if (!series || Number.isNaN(series)) series = 3;
  if (!reps) reps = "10";
  return { series, reps };
}

function buildEjercicio(ej, id) {
  const { series, reps } = parseSeriesReps(ej.series, ej.reps);
  const sets = [];
  for (let i = 0; i < series; i++) {
    sets.push({ kg: "", peso: "", reps, completado: false });
  }
  return {
    id,
    grupo: ej.grupo || "",
    nombre: ej.nombre || "Ejercicio",
    nota: "",
    link: "",
    series: String(series),
    reps,
    rir: String(ej.rir ?? "2"),
    peso: "",
    bloque: null,
    colorId: null,
    sets
  };
}

function detectarTipoPlan(headers, tipoHint) {
  if (tipoHint === "rutina" || tipoHint === "dieta") return tipoHint;
  const h = headers.join(" ");
  const scoreRutina = ["dia", "ejercicio", "series", "reps", "grupo"].filter((k) => h.includes(k)).length;
  const scoreDieta = ["comida", "alimento", "cantidad"].filter((k) => h.includes(k)).length;
  if (scoreDieta > scoreRutina) return "dieta";
  if (scoreRutina > 0) return "rutina";
  return null;
}

function parseTextoLibreRutina(texto) {
  const lineas = String(texto || "").split(/\r?\n/);
  const filas = [];
  let diaActual = null;
  for (const linea of lineas) {
    const t = linea.trim();
    if (!t) continue;
    const headerDia = t.match(/^#+\s*(.+)$/) || t.match(/^\[(.+)\]$/);
    if (headerDia) {
      diaActual = normalizarDia(headerDia[1].replace(/^d[ií]a\s*/i, ""));
      continue;
    }
    const diaInline = t.match(/^(Lunes|Martes|Mi[ée]rcoles|Jueves|Viernes|S[áa]bado)\s*[:\-|]/i);
    if (diaInline) {
      diaActual = normalizarDia(diaInline[1]);
      const resto = t.slice(diaInline[0].length).trim();
      if (resto) filas.push(parseLineaEjercicio(resto, diaActual));
      continue;
    }
    if (t.startsWith("-") || t.startsWith("•")) {
      filas.push(parseLineaEjercicio(t.replace(/^[-•]\s*/, ""), diaActual));
    }
  }
  return filas.filter(Boolean);
}

function parseLineaEjercicio(texto, diaDefault) {
  const partes = texto.split("|").map((p) => p.trim());
  if (partes.length < 2 && !texto.includes("|")) {
    const csvParts = texto.split(",").map((p) => p.trim());
    if (csvParts.length >= 2) {
      const dia = normalizarDia(csvParts[0]) || diaDefault;
      if (!dia) return null;
      const { series, reps } = parseSeriesReps(csvParts[3] || csvParts[2], csvParts[4] || csvParts[3]);
      return {
        dia,
        grupo: csvParts[1] || "",
        nombre: csvParts[2] || csvParts[1],
        series: String(series),
        reps,
        rir: csvParts[5] || "2"
      };
    }
    return null;
  }
  const dia = normalizarDia(partes[0]) || diaDefault;
  if (!dia) return null;
  let grupo = "";
  let nombre = "";
  let series = "3";
  let reps = "10";
  let rir = "2";
  if (partes.length >= 4) {
    grupo = partes[1];
    nombre = partes[2];
    const sr = parseSeriesReps(partes[3], partes[3]);
    series = String(sr.series);
    reps = sr.reps;
    rir = partes[4] || "2";
  } else if (partes.length === 3) {
    nombre = partes[0];
    const sr = parseSeriesReps(partes[1], partes[1]);
    series = String(sr.series);
    reps = sr.reps;
    rir = partes[2] || "2";
  } else {
    nombre = partes[0];
    const sr = parseSeriesReps(partes[1], partes[1]);
    series = String(sr.series);
    reps = sr.reps;
  }
  return { dia, grupo, nombre, series, reps, rir };
}

function parseRutina(texto, tipoForzado) {
  const avisos = [];
  const errores = [];
  const parsed = parseCsv(texto);
  let filasEj = [];

  if (parsed.headers.length >= 2 && detectarTipoPlan(parsed.headers, tipoForzado) === "rutina") {
    const mapa = mapearColumnas(parsed.headers, ALIAS_RUTINA);
    if (mapa.nombre == null) {
      return { ok: false, error: "Falta columna de ejercicio (nombre)." };
    }
    for (const fila of parsed.filas) {
      const dia = normalizarDia(valorDesdeMapa(fila, mapa, "dia", parsed.headers));
      const nombre = valorDesdeMapa(fila, mapa, "nombre", parsed.headers);
      if (!nombre) continue;
      if (!dia) {
        avisos.push(`Ejercicio «${nombre}» sin día válido — omitido.`);
        continue;
      }
      const sr = parseSeriesReps(
        valorDesdeMapa(fila, mapa, "series", parsed.headers),
        valorDesdeMapa(fila, mapa, "reps", parsed.headers)
      );
      filasEj.push({
        dia,
        grupo: valorDesdeMapa(fila, mapa, "grupo", parsed.headers),
        nombre,
        series: String(sr.series),
        reps: sr.reps,
        rir: valorDesdeMapa(fila, mapa, "rir", parsed.headers) || "2"
      });
    }
  } else {
    filasEj = parseTextoLibreRutina(texto);
    if (!filasEj.length) {
      return {
        ok: false,
        error: "No se reconoció formato de rutina. Usa CSV con columnas dia, nombre, series, reps o texto con # Lunes y líneas «Ejercicio | Grupo | 4x8 | 2»."
      };
    }
  }

  const datos_rutina = {};
  for (const d of DIAS_SEMANA) datos_rutina[d] = [];
  let ejId = 1;
  for (const ej of filasEj) {
    if (!ej?.nombre || !ej?.dia) continue;
    datos_rutina[ej.dia].push(buildEjercicio(ej, ejId++));
  }
  const totalEj = filasEj.filter((e) => e?.nombre).length;
  const diasConEj = DIAS_SEMANA.filter((d) => datos_rutina[d].length > 0);
  if (!totalEj) {
    return { ok: false, error: "No se encontraron ejercicios válidos.", avisos, errores };
  }
  return {
    ok: true,
    tipo: "rutina",
    datos_rutina,
    resumen: { ejercicios: totalEj, dias: diasConEj },
    muestra: filasEj.slice(0, 5).map((e) => ({
      dia: e.dia,
      nombre: e.nombre,
      detalle: `${e.series}x${e.reps}${e.grupo ? ` · ${e.grupo}` : ""}`
    })),
    avisos,
    errores
  };
}

function valorDesdeMapa(fila, mapa, campo, headers) {
  if (mapa[campo] != null && fila.__raw) return String(fila.__raw[mapa[campo]] ?? "").trim();
  const aliases = ALIAS_RUTINA[campo] || ALIAS_DIETA[campo] || [];
  for (const alias of aliases) {
    if (fila[alias] != null) return String(fila[alias]).trim();
    const key = Object.keys(fila).find((k) => k !== "__raw" && normHeader(k) === alias);
    if (key) return String(fila[key]).trim();
  }
  void headers;
  return "";
}

function parseDieta(texto, tipoForzado) {
  const avisos = [];
  const parsed = parseCsv(texto);
  const filasAl = [];

  if (parsed.headers.length >= 2 && detectarTipoPlan(parsed.headers, tipoForzado) === "dieta") {
    const mapa = mapearColumnas(parsed.headers, ALIAS_DIETA);
    if (mapa.alimento == null) {
      return { ok: false, error: "Falta columna de alimento." };
    }
    for (const fila of parsed.filas) {
      const alimento = valorDesdeMapa(fila, mapa, "alimento", parsed.headers);
      if (!alimento) continue;
      const comida = normalizarComida(valorDesdeMapa(fila, mapa, "comida", parsed.headers)) || "Comida";
      const cantidadRaw = valorDesdeMapa(fila, mapa, "cantidad", parsed.headers);
      const cantidad = parseFloat(String(cantidadRaw).replace(",", ".")) || null;
      const unidad = valorDesdeMapa(fila, mapa, "unidad", parsed.headers) || "g";
      filasAl.push({ comida, alimento, cantidad, unidad });
    }
  } else {
    return {
      ok: false,
      error: "No se reconoció formato de dieta. Usa CSV con columnas comida, alimento, cantidad, unidad."
    };
  }

  if (!filasAl.length) {
    return { ok: false, error: "No se encontraron alimentos válidos.", avisos };
  }

  const nombresComida = [...new Set(filasAl.map((f) => f.comida))];
  const comidasOrden = [];
  for (const c of COMIDAS_DEFAULT) {
    if (nombresComida.includes(c)) comidasOrden.push(c);
  }
  for (const c of nombresComida) {
    if (!comidasOrden.includes(c)) comidasOrden.push(c);
  }

  let uid = 1;
  const datos_dieta = comidasOrden.map((nombre, idx) => ({
    id: idx + 1,
    nombre,
    alimentos: filasAl
      .filter((f) => f.comida === nombre)
      .map((f) => ({
        idUnico: uid++,
        nombre: f.alimento,
        cantidadSeleccionada: f.cantidad,
        porcion_base: f.cantidad || 100,
        unidad: f.unidad || "g",
        calorias: 0,
        proteinas: 0,
        carbohidratos: 0,
        grasas: 0,
        sodio: 0,
        _importado: true,
        _sinMacros: true
      }))
  }));

  return {
    ok: true,
    tipo: "dieta",
    datos_dieta,
    resumen: {
      alimentos: filasAl.length,
      comidas: comidasOrden
    },
    muestra: filasAl.slice(0, 5).map((f) => ({
      comida: f.comida,
      nombre: f.alimento,
      detalle: `${f.cantidad ?? "?"} ${f.unidad || "g"}`
    })),
    avisos: [
      ...avisos,
      "Los macros se completan al aplicar si el alimento existe en tu biblioteca."
    ],
    errores: []
  };
}

function previewImportPlan(texto, opts = {}) {
  const raw = String(texto || "");
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) {
    return { ok: false, error: `Archivo demasiado grande (máx. ${MAX_BYTES / 1024} KB).` };
  }
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return { ok: false, error: "El archivo está vacío." };

  const parsed = parseCsv(trimmed);
  const tipo = opts.tipo || detectarTipoPlan(parsed.headers, null);
  if (!tipo) {
    return {
      ok: false,
      error: "No se detectó si es rutina o dieta. Elige el tipo manualmente o usa las plantillas CSV."
    };
  }

  if (parsed.filas.length > MAX_FILAS) {
    return { ok: false, error: `Demasiadas filas (máx. ${MAX_FILAS}).` };
  }

  if (tipo === "rutina") return parseRutina(trimmed, "rutina");
  return parseDieta(trimmed, "dieta");
}

module.exports = {
  previewImportPlan,
  PLANTILLA_RUTINA_CSV,
  PLANTILLA_DIETA_CSV,
  DIAS_SEMANA,
  COMIDAS_DEFAULT
};
