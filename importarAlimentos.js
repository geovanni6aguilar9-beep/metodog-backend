/**
 * Importación CSV/Excel de biblioteca de alimentos por coach.
 * coachId numérico → solo biblioteca de ese coach; null → global (solo SUPERADMIN).
 */

const MAX_FILAS = 500;
const MAX_BYTES = 512 * 1024;

const ALIAS = {
  nombre: ["nombre", "alimento", "food", "name", "descripcion", "descripción"],
  grupo: ["grupo", "category", "categoría", "categoria", "tipo"],
  grupo_equivalencia: ["grupo_equivalencia", "equivalencia", "grupo equiv"],
  porcion_base: ["porcion_base", "porción base", "porcion", "porción", "cantidad", "serving", "porcion base"],
  unidad: ["unidad", "unit", "medida"],
  calorias: ["calorias", "calorías", "kcal", "energia", "energía", "cal"],
  proteinas: ["proteinas", "proteínas", "prot", "protein", "proteina"],
  carbohidratos: ["carbohidratos", "carbos", "carb", "carbs", "cho", "hidratos"],
  grasas: ["grasas", "grasa", "fat", "lipidos", "lípidos"],
  sodio: ["sodio", "sodium", "na", "mg sodio"]
};

const GRUPOS_UI = [
  "Carnes", "Lácteos", "Cereales", "Leguminosas", "Frutas", "Grasas", "Verduras", "Otros"
];

const EQUIVALENCIAS = new Set([
  "proteina_magra", "proteina_grasa", "carbohidrato_complejo", "legumbre",
  "fruta", "grasa", "lacteo", "verdura", "sin_sustituto", "condimento", "libre", "azucar"
]);

const GRUPO_POR_EQUIVALENCIA = {
  proteina_magra: "Carnes",
  proteina_grasa: "Carnes",
  carbohidrato_complejo: "Cereales",
  legumbre: "Leguminosas",
  fruta: "Frutas",
  grasa: "Grasas",
  lacteo: "Lácteos",
  verdura: "Verduras"
};

function normHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function limpiarHeader(h) {
  return normHeader(h)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectarSeparador(linea) {
  const comas = (linea.match(/,/g) || []).length;
  const puntos = (linea.match(/;/g) || []).length;
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
      } else {
        enComillas = !enComillas;
      }
    } else if (c === sep && !enComillas) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function mapearColumnasExacto(headersLimpios) {
  const map = {};
  headersLimpios.forEach((n, idx) => {
    for (const [campo, aliases] of Object.entries(ALIAS)) {
      if (aliases.some((a) => limpiarHeader(a) === n)) {
        if (map[campo] == null) map[campo] = idx;
      }
    }
  });
  return map;
}

function mapearColumnasFuzzy(headersLimpios, map) {
  headersLimpios.forEach((n, idx) => {
    if (map.nombre == null && /comida|alimento|nombre|descripcion|food|name|tipo/.test(n) && !/kcal|calor|protein|carb|grasa|sodio/.test(n)) {
      map.nombre = idx;
    }
    if (map.calorias == null && /(^kcal$|caloria|calorias|energia)/.test(n)) map.calorias = idx;
    if (map.proteinas == null && /protein|proteina/.test(n)) map.proteinas = idx;
    if (map.carbohidratos == null && /carbohidrato|carbo|hidratos|\bcho\b/.test(n)) map.carbohidratos = idx;
    if (map.grasas == null && /grasa|lipid|\bfat\b/.test(n)) map.grasas = idx;
    if (map.sodio == null && /sodio|sodium|\bna\b/.test(n)) map.sodio = idx;
    if (map.grupo == null && /(^grupo$|categoria|category)/.test(n)) map.grupo = idx;
  });
  if (map.nombre == null && headersLimpios.length > 0) map.nombre = 0;
  return map;
}

function mapearColumnas(headers) {
  const limpios = headers.map(limpiarHeader);
  const map = mapearColumnasExacto(limpios);
  return mapearColumnasFuzzy(limpios, map);
}

function num(v, fallback = 0) {
  if (v == null || v === "") return fallback;
  let s = String(v).replace(/\s/g, "").replace(",", ".").trim();
  const rango = s.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (rango) {
    const a = parseFloat(rango[1]);
    const b = parseFloat(rango[2]);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return Math.round(((a + b) / 2) * 10) / 10;
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? fallback : n;
}

function extraerPorcionDesdeNombre(nombreRaw) {
  let nombre = String(nombreRaw || "").trim();
  let porcion_base = null;
  let unidad = null;

  const m = nombre.match(/\(([^)]+)\)\s*$/);
  if (!m) return { nombre, porcion_base, unidad };

  const inner = m[1].trim();
  const numUnit = inner.match(/^(\d+(?:[.,]\d+)?)\s*(g|gr|grs|gramos|ml|cc|pieza|piezas|rebanada|rebanadas|cucharada|cucharadas)?/i);
  if (numUnit) {
    porcion_base = parseFloat(String(numUnit[1]).replace(",", "."));
    const u = (numUnit[2] || "g").toLowerCase();
    if (/ml|cc/.test(u)) unidad = "ml";
    else if (/pieza|rebanada/.test(u)) unidad = "pieza";
    else if (/cucharada/.test(u)) unidad = "cucharada";
    else unidad = "g";
  } else {
    const soloNum = inner.match(/^(\d+(?:[.,]\d+)?)/);
    if (soloNum) {
      porcion_base = parseFloat(String(soloNum[1]).replace(",", "."));
      unidad = /rebanada|pieza|tortilla/.test(inner) ? "pieza" : "g";
    }
  }

  if (porcion_base != null) {
    nombre = nombre.replace(/\([^)]+\)\s*$/, "").trim();
  }
  return { nombre, porcion_base, unidad };
}

function inferirGrupoEquivalencia(item, contextoHoja) {
  const ctx = String(contextoHoja || "").toLowerCase();
  if (/carbohidrato|hidratos|cereal|arroz|pan|pasta|tortilla|avena|quinoa/.test(ctx)) return "carbohidrato_complejo";
  if (/legumbre|frijol|lenteja|garbanzo/.test(ctx)) return "legumbre";
  if (/fruta|plátano|platano|manzana|mango/.test(ctx)) return "fruta";
  if (/verdura|vegetal|brocoli|espinaca|jitomate/.test(ctx)) return "verdura";
  if (/l[aá]cteo|leche|yogur|queso|kefir/.test(ctx)) return "lacteo";
  if (/grasa|aceite|nuez|aguacate|almendra|cacahuate/.test(ctx)) return "grasa";
  if (/prote[ií]na|carne|pollo|pescado|huevo|atun|atún/.test(ctx)) {
    return item.grasas > 8 ? "proteina_grasa" : "proteina_magra";
  }

  const p = item.proteinas;
  const c = item.carbohidratos;
  const g = item.grasas;

  if (g >= 5 && g >= p && g >= c * 0.4) return "grasa";
  if (c >= 12 && c > p * 1.2) return "carbohidrato_complejo";
  if (p >= 6 && p >= c && p >= g) return g > 5 ? "proteina_grasa" : "proteina_magra";
  if (c >= 8 && p >= 5) return "legumbre";

  return "sin_sustituto";
}

function inferirGrupoUi(grupoEq, grupoActual) {
  if (grupoActual && grupoActual !== "Otros" && GRUPOS_UI.includes(grupoActual)) return grupoActual;
  return GRUPO_POR_EQUIVALENCIA[grupoEq] || "Otros";
}

function normalizarNombreParaMatch(nombre) {
  return String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function buscarEnBibliotecaGlobal(db, nombre) {
  const clave = normalizarNombreParaMatch(nombre);
  if (!clave || clave.length < 3) return null;

  const exacto = await db.execute({
    sql: `SELECT nombre, grupo, grupo_equivalencia FROM alimentos
          WHERE coach_id IS NULL AND LOWER(TRIM(nombre)) = LOWER(TRIM(?)) LIMIT 1`,
    args: [nombre.replace(/\([^)]*\)\s*$/, "").trim()]
  });
  if (exacto.rows.length > 0) return exacto.rows[0];

  const like = await db.execute({
    sql: `SELECT nombre, grupo, grupo_equivalencia FROM alimentos
          WHERE coach_id IS NULL AND (
            LOWER(nombre) LIKE ? OR LOWER(?) LIKE '%' || LOWER(nombre) || '%'
          )
          ORDER BY LENGTH(nombre) ASC LIMIT 1`,
    args: [`%${clave}%`, clave]
  });
  return like.rows.length > 0 ? like.rows[0] : null;
}

function celda(cells, colMap, campo) {
  const idx = colMap[campo];
  return idx == null ? "" : (cells[idx] ?? "");
}

function tieneCalorias(cells, colMap) {
  const v = celda(cells, colMap, "calorias");
  const n = num(v, NaN);
  return !Number.isNaN(n) && n >= 0;
}

function filaVacia(cells, colMap) {
  const nombre = String(celda(cells, colMap, "nombre")).trim();
  if (nombre) return false;
  return !tieneCalorias(cells, colMap);
}

function esFilaEncabezados(cells) {
  const joined = normHeader(cells.join(" "));
  return /kcal|caloria/.test(joined) && (/protein|carbohidrato|grasa|hidratos/.test(joined));
}

/** Filas tipo «Tipos de comidas para Proteína» entre bloques del Excel. */
function esTituloSeccion(cells, colMap) {
  const nombre = String(celda(cells, colMap, "nombre")).trim();
  if (!nombre) return false;
  const n = normHeader(nombre);
  if (/tipos de comidas para|alimentos para|grupo de|lista de/.test(n)) return true;
  if (/^seccion|^sección/.test(n)) return true;
  if (/para (proteina|carbohidrato|grasas|frutas|verduras|lacteos)/.test(n) && !tieneCalorias(cells, colMap)) {
    return true;
  }
  return false;
}

function normalizarFila(cells, colMap, lineaNum, contextoHoja) {
  const get = (campo) => celda(cells, colMap, campo);

  let nombre = String(get("nombre")).trim();
  if (!nombre) {
    return { error: `Fila ${lineaNum}: falta nombre del alimento.` };
  }

  const extraido = extraerPorcionDesdeNombre(nombre);
  nombre = extraido.nombre || nombre;

  const calorias = num(get("calorias"), NaN);
  if (Number.isNaN(calorias) || calorias < 0) {
    return { error: `Fila ${lineaNum} («${nombre}»): calorías inválidas o faltantes.` };
  }

  let grupo = String(get("grupo")).trim() || "Otros";
  if (!GRUPOS_UI.includes(grupo)) grupo = "Otros";

  let grupoEq = String(get("grupo_equivalencia")).trim().toLowerCase().replace(/\s+/g, "_");
  if (!grupoEq || !EQUIVALENCIAS.has(grupoEq)) grupoEq = null;

  let porcionBase = extraido.porcion_base != null ? extraido.porcion_base : num(get("porcion_base"), 100);
  if (!porcionBase || porcionBase <= 0) porcionBase = 100;

  let unidad = extraido.unidad || String(get("unidad")).trim().toLowerCase() || "g";
  if (!["g", "ml", "pieza", "cucharada"].includes(unidad)) unidad = "g";

  const item = {
    nombre,
    grupo,
    grupo_equivalencia: grupoEq || "sin_sustituto",
    porcion_base: porcionBase,
    unidad,
    calorias,
    proteinas: num(get("proteinas"), 0),
    carbohidratos: num(get("carbohidratos"), 0),
    grasas: num(get("grasas"), 0),
    sodio: num(get("sodio"), 0),
    _contexto_hoja: contextoHoja
  };

  if (!grupoEq) {
    item.grupo_equivalencia = inferirGrupoEquivalencia(item, contextoHoja);
    item.grupo = inferirGrupoUi(item.grupo_equivalencia, grupo);
  }

  delete item._contexto_hoja;
  return { item };
}

function parsearCsvTexto(csvText) {
  const raw = String(csvText || "").replace(/^\uFEFF/, "").trim();
  if (!raw) return { error: "El archivo está vacío." };
  if (raw.length > MAX_BYTES) {
    return { error: `El archivo supera ${MAX_BYTES / 1024} KB. Divide tu lista o importa por partes.` };
  }

  const lineas = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lineas.length < 2) {
    return { error: "El archivo debe incluir encabezados y al menos una fila de datos." };
  }

  const sep = detectarSeparador(lineas[0]);
  const headers = parseCsvLinea(lineas[0], sep);
  const colMap = mapearColumnas(headers);
  const contextoHoja = headers.join(" ");

  if (colMap.nombre == null) {
    return { error: "No encontramos una columna con el nombre del alimento." };
  }
  if (colMap.calorias == null) {
    return { error: "No encontramos una columna de calorías (kcal)." };
  }

  const filas = [];
  const errores = [];
  let omitidas = 0;
  let contextoActivo = contextoHoja;

  for (let i = 1; i < lineas.length; i++) {
    if (filas.length >= MAX_FILAS) {
      errores.push(`Solo se procesan ${MAX_FILAS} filas por importación. El resto se omitió.`);
      break;
    }
    const cells = parseCsvLinea(lineas[i], sep);

    if (esFilaEncabezados(cells)) {
      const nuevoMap = mapearColumnas(cells);
      if (nuevoMap.calorias != null) {
        Object.assign(colMap, nuevoMap);
        contextoActivo = cells.join(" ");
      }
      omitidas++;
      continue;
    }

    if (filaVacia(cells, colMap)) {
      omitidas++;
      continue;
    }

    if (esTituloSeccion(cells, colMap)) {
      contextoActivo = String(celda(cells, colMap, "nombre")).trim();
      omitidas++;
      continue;
    }

    const res = normalizarFila(cells, colMap, i + 1, contextoActivo);
    if (res.error) {
      if (tieneCalorias(cells, colMap)) errores.push(res.error);
      else omitidas++;
      continue;
    }
    filas.push(res.item);
  }

  if (filas.length === 0) {
    return { error: "No hay filas válidas para importar.", errores, omitidas };
  }

  return { filas, errores, omitidas, total_lineas: lineas.length - 1, contexto_hoja: contextoActivo };
}

async function enriquecerConBibliotecaGlobal(db, item) {
  if (item.grupo_equivalencia && item.grupo_equivalencia !== "sin_sustituto") return item;

  const match = await buscarEnBibliotecaGlobal(db, item.nombre);
  if (match?.grupo_equivalencia && match.grupo_equivalencia !== "sin_sustituto") {
    item.grupo_equivalencia = match.grupo_equivalencia;
    if (item.grupo === "Otros" && match.grupo) item.grupo = match.grupo;
    return item;
  }

  item.grupo_equivalencia = inferirGrupoEquivalencia(item, "");
  item.grupo = inferirGrupoUi(item.grupo_equivalencia, item.grupo);
  return item;
}

async function upsertAlimento(db, coachId, item) {
  const coachClause = coachId == null ? "IS NULL" : "= ?";
  const argsBuscar = coachId == null ? [item.nombre] : [coachId, item.nombre];

  const existente = await db.execute({
    sql: `SELECT id FROM alimentos WHERE coach_id ${coachClause} AND LOWER(nombre) = LOWER(?)`,
    args: argsBuscar
  });

  const campos = [
    item.grupo,
    item.grupo_equivalencia,
    item.porcion_base,
    item.unidad,
    item.calorias,
    item.proteinas,
    item.carbohidratos,
    item.grasas,
    item.sodio
  ];

  if (existente.rows.length > 0) {
    const id = existente.rows[0].id;
    await db.execute({
      sql: `UPDATE alimentos SET grupo = ?, grupo_equivalencia = ?, porcion_base = ?, unidad = ?,
            calorias = ?, proteinas = ?, carbohidratos = ?, grasas = ?, sodio = ?
            WHERE id = ?`,
      args: [...campos, id]
    });
    return "actualizado";
  }

  const argsInsert = coachId == null
    ? [item.nombre, ...campos]
    : [item.nombre, ...campos, coachId];

  await db.execute({
    sql: `INSERT INTO alimentos (
      nombre, grupo, grupo_equivalencia, porcion_base, unidad,
      calorias, proteinas, carbohidratos, grasas, sodio${coachId != null ? ", coach_id" : ""}
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${coachId != null ? ", ?" : ""})`,
    args: argsInsert
  });
  return "nuevo";
}

async function importarAlimentosCsv(db, coachId, csvText) {
  const parsed = parsearCsvTexto(csvText);
  if (parsed.error && !parsed.filas) {
    return { ok: false, error: parsed.error, errores: parsed.errores || [] };
  }

  let nuevos = 0;
  let actualizados = 0;

  for (const raw of parsed.filas) {
    const item = await enriquecerConBibliotecaGlobal(db, { ...raw });
    const accion = await upsertAlimento(db, coachId, item);
    if (accion === "nuevo") nuevos++;
    else actualizados++;
  }

  const alcanceMsg =
    coachId == null
      ? "Biblioteca global MétodoG actualizada."
      : "Guardado en tu biblioteca personal (solo tú la ves al armar dietas).";

  const omitidas = parsed.omitidas || 0;
  const omitMsg = omitidas > 0
    ? ` ${omitidas} fila(s) de título o vacías omitidas (normal si tu Excel tiene secciones).`
    : "";

  return {
    ok: true,
    nuevos,
    actualizados,
    total: parsed.filas.length,
    omitidas,
    errores: parsed.errores || [],
    mensaje: `Importación lista: ${nuevos} nuevo(s), ${actualizados} actualizado(s).${omitMsg} ${alcanceMsg}`
  };
}

const PLANTILLA_CSV = `nombre,calorias,proteinas,carbohidratos,grasas,sodio
Arroz blanco cocido (100 g),130,2.5,29,0,2
Pan integral (2 piezas),180,12,30,2,8
Pechuga de pollo (100 g),165,31,0,3.6,74`;

module.exports = {
  parsearCsvTexto,
  importarAlimentosCsv,
  PLANTILLA_CSV,
  MAX_FILAS,
  inferirGrupoEquivalencia,
  mapearColumnas
};
