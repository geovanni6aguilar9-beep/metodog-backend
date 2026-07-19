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
    await db.execute("ALTER TABLE alimentos ADD COLUMN coach_id INTEGER");
  } catch (_) {
    /* columna ya existe */
  }
  try {
    await db.execute("DROP INDEX idx_alimentos_nombre");
  } catch (_) {
    /* índice legacy */
  }
  try {
    await db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_alimentos_global_nombre
       ON alimentos(nombre) WHERE coach_id IS NULL`
    );
  } catch (_) {
    /* ignore */
  }
  try {
    await db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_alimentos_coach_nombre
       ON alimentos(coach_id, nombre) WHERE coach_id IS NOT NULL`
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

  for (const a of ALIMENTOS_METODOG) {
    const existente = await db.execute({
      sql: "SELECT id FROM alimentos WHERE coach_id IS NULL AND LOWER(nombre) = LOWER(?)",
      args: [a.nombre]
    });
    const args = [
      a.grupo,
      a.grupo_equivalencia,
      a.porcion_base,
      a.unidad,
      a.calorias,
      a.proteinas,
      a.carbohidratos,
      a.grasas,
      a.sodio
    ];
    if (existente.rows.length > 0) {
      await db.execute({
        sql: `UPDATE alimentos SET grupo = ?, grupo_equivalencia = ?, porcion_base = ?, unidad = ?,
              calorias = ?, proteinas = ?, carbohidratos = ?, grasas = ?, sodio = ?
              WHERE id = ?`,
        args: [...args, existente.rows[0].id]
      });
    } else {
      await db.execute({
        sql: `INSERT INTO alimentos (
          nombre, grupo, grupo_equivalencia, porcion_base, unidad,
          calorias, proteinas, carbohidratos, grasas, sodio, coach_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        args: [a.nombre, ...args]
      });
    }
  }

    // Seguridad: aceites globales mal etiquetados como "1 g" con macros de cucharada
  await db.execute({
    sql: `UPDATE alimentos
          SET unidad = 'cucharada', porcion_base = 1
          WHERE coach_id IS NULL
            AND LOWER(nombre) LIKE '%aceite%'
            AND LOWER(unidad) IN ('g', 'gr', 'gramo', 'gramos')
            AND CAST(porcion_base AS REAL) <= 2
            AND CAST(grasas AS REAL) >= 10`
  });

  const count = await db.execute("SELECT COUNT(*) AS n FROM alimentos");
  console.log(`✅ Biblioteca alimentos: ${count.rows[0]?.n ?? "?"} ítems (grupo_equivalencia activo).`);
}

module.exports = { seedAlimentosMetodog, ensureAlimentosSchema };
