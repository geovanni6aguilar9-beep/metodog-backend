const { ALIMENTOS_METODOG } = require("./data/alimentos-metodog-seed");
const { CARNES_ESTADO } = require("./data/carnes-estado");
const { RENAMES_PESAJE, PESAJE_ESTADO } = require("./data/pesaje-estado");

/** Rellena grupo_equivalencia en filas legacy (seed inicial de 13 ítems). */
const LEGACY_EQUIVALENCIA = {
  "Pechuga de Pollo": "proteina_magra",
  "Carne de Res Magra": "proteina_magra",
  "Atún en Agua": "proteina_magra",
  "Leche Entera": "lacteo",
  "Yogur Griego Sin Azúcar": "lacteo",
  Lentejas: "legumbre",
  Frijoles: "legumbre",
  "Arroz Blanco": "carbohidrato_complejo",
  Avena: "carbohidrato_complejo",
  "Tortilla de Maíz": "carbohidrato_complejo",
  Almendras: "grasa",
  "Aceite de Oliva": "grasa",
  Aguacate: "grasa"
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
  try {
    await db.execute("ALTER TABLE alimentos ADD COLUMN estado TEXT");
  } catch (_) {
    /* columna ya existe */
  }
}

async function seedAlimentosMetodog(db) {
  await ensureAlimentosSchema(db);

  for (const [desde, hacia] of [
    ["Pulpo Cocido", "Pulpo"],
    ["Mejillón Cocido", "Mejillón"],
    ...RENAMES_PESAJE
  ]) {
    await db.execute({
      sql: `UPDATE alimentos SET nombre = ?
            WHERE coach_id IS NULL AND LOWER(nombre) = LOWER(?)
              AND NOT EXISTS (
                SELECT 1 FROM alimentos x
                WHERE x.coach_id IS NULL AND LOWER(x.nombre) = LOWER(?)
              )`,
      args: [hacia, desde, hacia]
    });
    // Si el nombre limpio ya existía, borra el viejo con Cocido/Crudo
    await db.execute({
      sql: `DELETE FROM alimentos WHERE coach_id IS NULL AND LOWER(nombre) = LOWER(?)`,
      args: [desde]
    });
  }

  await db.execute({
    sql: `DELETE FROM alimentos WHERE coach_id IS NULL AND LOWER(nombre) = LOWER(?)`,
    args: ["Edamame con Cáscara"]
  });

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

  // Reemplazo: ficha singular incorrecta → «Tostadas Salmas» (1 paquete = 3 tostadas)
  await db.execute({
    sql: `DELETE FROM alimentos WHERE coach_id IS NULL AND LOWER(nombre) = LOWER(?)`,
    args: ["Tostada Salmas"]
  });

  // Dedupe histórico: pastas de legumbre solo en Cereales (carbohidrato_complejo)
  for (const nombre of ["Pasta de Lenteja", "Pasta de Garbanzo"]) {
    await db.execute({
      sql: `UPDATE alimentos
            SET grupo = 'Cereales',
                grupo_equivalencia = 'carbohidrato_complejo'
            WHERE coach_id IS NULL AND LOWER(nombre) = LOWER(?)`,
      args: [nombre]
    });
  }

  // Aceites mal etiquetados como "1 g" con macros de cucharada (global + coach)
  // Importante: pasar string (o args: []) — `{ sql }` sin args rompe @libsql (Object.entries(undefined)).
  await db.execute(`UPDATE alimentos
          SET unidad = 'cucharada',
              porcion_base = 1,
              grupo = 'Grasas',
              grupo_equivalencia = COALESCE(NULLIF(TRIM(grupo_equivalencia), ''), 'grasa')
          WHERE (
              LOWER(nombre) LIKE '%aceite%'
              OR LOWER(TRIM(nombre)) = 'ghee'
            )
            AND LOWER(COALESCE(unidad, 'g')) IN ('g', 'gr', 'gramo', 'gramos')
            AND CAST(porcion_base AS REAL) <= 2
            AND CAST(grasas AS REAL) >= 10`);

  await aplicarCarnesEstado(db);
  await aplicarPesajeEstado(db);

  const count = await db.execute("SELECT COUNT(*) AS n FROM alimentos");
  console.log(`✅ Biblioteca alimentos: ${count.rows[0]?.n ?? "?"} ítems (grupo_equivalencia activo).`);
}

/** Una ficha: el estado en que se pesa. Sin par (arroz no va crudo). */
async function aplicarPesajeEstado(db) {
  for (const row of PESAJE_ESTADO) {
    await db.execute({
      sql: `UPDATE alimentos SET estado = ?
            WHERE coach_id IS NULL AND LOWER(nombre) = LOWER(?)`,
      args: [row.estado, row.nombre]
    });
  }
}

/** coach_id 0 = el otro estado del corte. La IA solo lee coach_id NULL. */
async function aplicarCarnesEstado(db) {
  for (const row of CARNES_ESTADO) {
    await db.execute({
      sql: `UPDATE alimentos SET estado = ?
            WHERE coach_id IS NULL AND LOWER(nombre) = LOWER(?)`,
      args: [row.estado, row.nombre]
    });
    const par = row.par;
    const existe = await db.execute({
      sql: `SELECT id FROM alimentos WHERE coach_id = 0 AND LOWER(nombre) = LOWER(?)`,
      args: [row.nombre]
    });
    const args = [
      row.nombre,
      "Carnes",
      row.grupo_equivalencia,
      100,
      "g",
      par.calorias,
      par.proteinas,
      par.carbohidratos,
      par.grasas,
      par.sodio,
      par.estado
    ];
    if (existe.rows.length > 0) {
      await db.execute({
        sql: `UPDATE alimentos SET
              nombre = ?, grupo = ?, grupo_equivalencia = ?, porcion_base = ?, unidad = ?,
              calorias = ?, proteinas = ?, carbohidratos = ?, grasas = ?, sodio = ?, estado = ?
              WHERE id = ?`,
        args: [...args, existe.rows[0].id]
      });
    } else {
      await db.execute({
        sql: `INSERT INTO alimentos (
          nombre, grupo, grupo_equivalencia, porcion_base, unidad,
          calorias, proteinas, carbohidratos, grasas, sodio, coach_id, estado
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        args
      });
    }
  }
}

module.exports = { seedAlimentosMetodog, ensureAlimentosSchema };
