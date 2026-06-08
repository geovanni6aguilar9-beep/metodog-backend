/**
 * Importación CSV/Excel (exportado como .csv) de biblioteca de alimentos por coach.
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
  "fruta", "grasa", "lacteo", "verdura", "sin_sustituto", "condimento", "libre"
]);

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

function mapearColumnas(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const n = normHeader(h);
    for (const [campo, aliases] of Object.entries(ALIAS)) {
      if (aliases.some((a) => normHeader(a) === n)) {
        if (map[campo] == null) map[campo] = idx;
      }
    }
  });
  return map;
}

function num(v, fallback = 0) {
  if (v == null || v === "") return fallback;
  const s = String(v).replace(",", ".").trim();
  const n = parseFloat(s);
  return Number.isNaN(n) ? fallback : n;
}

function normalizarFila(cells, colMap, lineaNum) {
  const get = (campo) => {
    const idx = colMap[campo];
    return idx == null ? "" : (cells[idx] ?? "");
  };

  const nombre = String(get("nombre")).trim();
  if (!nombre) {
    return { error: `Fila ${lineaNum}: falta nombre del alimento.` };
  }

  const calorias = num(get("calorias"), NaN);
  if (Number.isNaN(calorias) || calorias < 0) {
    return { error: `Fila ${lineaNum} («${nombre}»): calorías inválidas o faltantes.` };
  }

  let grupo = String(get("grupo")).trim() || "Otros";
  if (!GRUPOS_UI.includes(grupo)) grupo = "Otros";

  let grupoEq = String(get("grupo_equivalencia")).trim().toLowerCase().replace(/\s+/g, "_");
  if (!grupoEq || !EQUIVALENCIAS.has(grupoEq)) grupoEq = "sin_sustituto";

  const porcionBase = num(get("porcion_base"), 100) || 100;
  let unidad = String(get("unidad")).trim().toLowerCase() || "g";
  if (!["g", "ml", "pieza", "cucharada"].includes(unidad)) unidad = "g";

  return {
    item: {
      nombre,
      grupo,
      grupo_equivalencia: grupoEq,
      porcion_base: porcionBase,
      unidad,
      calorias,
      proteinas: num(get("proteinas"), 0),
      carbohidratos: num(get("carbohidratos"), 0),
      grasas: num(get("grasas"), 0),
      sodio: num(get("sodio"), 0)
    }
  };
}

function parsearCsvTexto(csvText) {
  const raw = String(csvText || "").replace(/^\uFEFF/, "").trim();
  if (!raw) return { error: "El archivo está vacío." };
  if (raw.length > MAX_BYTES) {
    return { error: `El archivo supera ${MAX_BYTES / 1024} KB. Divide tu lista o importa por partes.` };
  }

  const lineas = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lineas.length < 2) {
    return { error: "El CSV debe incluir encabezados y al menos una fila de datos." };
  }

  const sep = detectarSeparador(lineas[0]);
  const headers = parseCsvLinea(lineas[0], sep);
  const colMap = mapearColumnas(headers);

  if (colMap.nombre == null) {
    return { error: "Falta columna «nombre» (o alimento / name)." };
  }
  if (colMap.calorias == null) {
    return { error: "Falta columna «calorias» (o kcal)." };
  }

  const filas = [];
  const errores = [];

  for (let i = 1; i < lineas.length; i++) {
    if (filas.length >= MAX_FILAS) {
      errores.push(`Solo se procesan ${MAX_FILAS} filas por importación. El resto se omitió.`);
      break;
    }
    const cells = parseCsvLinea(lineas[i], sep);
    const res = normalizarFila(cells, colMap, i + 1);
    if (res.error) errores.push(res.error);
    else filas.push(res.item);
  }

  if (filas.length === 0) {
    return { error: "No hay filas válidas para importar.", errores };
  }

  return { filas, errores, total_lineas: lineas.length - 1 };
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

  for (const item of parsed.filas) {
    const accion = await upsertAlimento(db, coachId, item);
    if (accion === "nuevo") nuevos++;
    else actualizados++;
  }

  return {
    ok: true,
    nuevos,
    actualizados,
    total: parsed.filas.length,
    errores: parsed.errores || [],
    mensaje: `Importación lista: ${nuevos} nuevo(s), ${actualizados} actualizado(s).`
  };
}

const PLANTILLA_CSV = `nombre,grupo,porcion_base,unidad,calorias,proteinas,carbohidratos,grasas,sodio,grupo_equivalencia
Pechuga de Pollo,Carnes,100,g,165,31,0,3.6,74,proteina_magra
Arroz Blanco Cocido,Cereales,100,g,130,2.7,28,0.3,1,carbohidrato_complejo
Aguacate,Grasas,50,g,80,1,4,7.5,7,grasa`;

module.exports = {
  parsearCsvTexto,
  importarAlimentosCsv,
  PLANTILLA_CSV,
  MAX_FILAS
};
