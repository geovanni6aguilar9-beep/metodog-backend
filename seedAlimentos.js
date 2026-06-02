const { ALIMENTOS_METODOG } = require("./data/alimentos-metodog-seed");

/** Rellena grupo_equivalencia en filas legacy (seed inicial de 13 ítems). */
const LEGACY_EQUIVALENCIA = {
  "Pechuga de Pollo": "proteina_magra",
  "Carne de Res Magra": "proteina_magra",
  "Atún en Agua": "proteina_magra",
  "Leche Entera": "lacteo",
  "Yogur Griego Sin Azúcar": "lacteo",
  "Lentejas Cocidas": "legumbre",
  "Frijoles Cocidos": "legumbre",
  "Arroz Blanco Cocido": "carbohidrato_complejo",
  "Avena en Hojuelas": "carbohidrato_complejo",
  "Tortilla de Maíz": "carbohidrato_complejo",
  "Almendras": "grasa",
  "Aceite de Oliva": "grasa",
  "Aguacate": "grasa"
};

async function ensureAlimentosSchema(db) {
  try {
    await db.execute("ALTER TABLE alimentos ADD COLUMN grupo_equivalencia TEXT");
  } catch (_) {
    /* columna ya existe */
  }
  try {
    await db.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_alimentos_nombre ON alimentos(nombre)"
    );
  } catch (_) {
    /* ignore */
  }
}

async function seedAlimentosMetodog(db) {
  await ensureAlimentosSchema(db);

  for (const [nombre, ge] of Object.entries(LEGACY_EQUIVALENCIA)) {
    await db.execute({
      sql: `UPDATE alimentos SET grupo_equivalencia = ?
            WHERE nombre = ? AND (grupo_equivalencia IS NULL OR grupo_equivalencia = '')`,
      args: [ge, nombre]
    });
  }

  const sql = `INSERT INTO alimentos (
    nombre, grupo, grupo_equivalencia, porcion_base, unidad,
    calorias, proteinas, carbohidratos, grasas, sodio
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(nombre) DO UPDATE SET
    grupo = excluded.grupo,
    grupo_equivalencia = excluded.grupo_equivalencia,
    porcion_base = excluded.porcion_base,
    unidad = excluded.unidad,
    calorias = excluded.calorias,
    proteinas = excluded.proteinas,
    carbohidratos = excluded.carbohidratos,
    grasas = excluded.grasas,
    sodio = excluded.sodio`;

  for (const a of ALIMENTOS_METODOG) {
    await db.execute({
      sql,
      args: [
        a.nombre,
        a.grupo,
        a.grupo_equivalencia,
        a.porcion_base,
        a.unidad,
        a.calorias,
        a.proteinas,
        a.carbohidratos,
        a.grasas,
        a.sodio
      ]
    });
  }

  const count = await db.execute("SELECT COUNT(*) AS n FROM alimentos");
  console.log(`✅ Biblioteca alimentos: ${count.rows[0]?.n ?? "?"} ítems (grupo_equivalencia activo).`);
}

module.exports = { seedAlimentosMetodog, ensureAlimentosSchema };
