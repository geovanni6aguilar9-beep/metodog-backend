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

  await corregirProteinasScoop(db);

  const count = await db.execute("SELECT COUNT(*) AS n FROM alimentos");
  console.log(`✅ Biblioteca alimentos: ${count.rows[0]?.n ?? "?"} ítems (grupo_equivalencia activo).`);
}

/** Fuerza unidad scoop en polvos de proteína (corrige filas legacy en Turso). */
async function corregirProteinasScoop(db) {
  const fixes = [
    {
      match: "%whey%",
      porcion_base: 1,
      unidad: "scoop",
      calorias: 111,
      proteinas: 25,
      carbohidratos: 1,
      grasas: 0.5,
      sodio: 45
    },
    {
      match: "%caseína%",
      porcion_base: 1,
      unidad: "scoop",
      calorias: 108,
      proteinas: 24,
      carbohidratos: 2,
      grasas: 1,
      sodio: 50
    },
    {
      match: "%vegetal en polvo%",
      porcion_base: 1,
      unidad: "scoop",
      calorias: 120,
      proteinas: 24,
      carbohidratos: 2,
      grasas: 2,
      sodio: 340
    }
  ];
  for (const f of fixes) {
    await db.execute({
      sql: `UPDATE alimentos SET porcion_base = ?, unidad = ?, calorias = ?, proteinas = ?,
            carbohidratos = ?, grasas = ?, sodio = ?
            WHERE coach_id IS NULL AND LOWER(nombre) LIKE ?`,
      args: [
        f.porcion_base,
        f.unidad,
        f.calorias,
        f.proteinas,
        f.carbohidratos,
        f.grasas,
        f.sodio,
        f.match.toLowerCase()
      ]
    });
  }
}

module.exports = { seedAlimentosMetodog, ensureAlimentosSchema };
