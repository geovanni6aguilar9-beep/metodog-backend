/**
 * Ajuste ligero de porciones tras Gemini.
 * Tolerancia funcional (no perfección matemática): ±30 kcal, ±5 g P/C/G.
 * Máximo de pasadas fijo para evitar bucles.
 */

/** Margen de error aceptable — pedido explícito de producto. */
const TOLERANCIA = {
  calorias: 30,
  proteinas: 5,
  carbohidratos: 5,
  grasas: 5
};

const MAX_PASADAS_COMBO = 8;
const MAX_PASADAS_DIA = 12;

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

function redondear(n) {
  return Math.round(n * 10) / 10;
}

function clampQty(qty, minQty, maxQty) {
  return redondear(Math.min(maxQty, Math.max(minQty, qty)));
}

function itemDesdeCatalogo(cat, cantidad) {
  const base = num(cat?.porcion_base, 1) || 1;
  const factor = num(cantidad, 0) / base;
  return {
    id_alimento: cat.id,
    nombre: cat.nombre,
    cantidad_sugerida: redondear(cantidad),
    unidad: cat.unidad,
    porcion_base: cat.porcion_base,
    calorias: redondear(num(cat.calorias) * factor),
    proteinas: redondear(num(cat.proteinas) * factor),
    carbohidratos: redondear(num(cat.carbohidratos) * factor),
    grasas: redondear(num(cat.grasas) * factor),
    sodio: redondear(num(cat.sodio) * factor)
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

function densidad(cat, macro) {
  const base = num(cat?.porcion_base, 1) || 1;
  return num(cat?.[macro]) / base;
}

function idsEnCombo(items) {
  return new Set(items.map((i) => i.id_alimento));
}

function reconstruirItems(items, catalogoMap, minQty, maxQty) {
  const out = [];
  for (const row of items) {
    const cat = catalogoMap.get(row.id_alimento);
    if (!cat) continue;
    const qty = clampQty(num(row.cantidad_sugerida, 0), minQty, maxQty);
    if (qty <= 0) continue;
    out.push(itemDesdeCatalogo(cat, qty));
  }
  return out;
}

function dentroTolerancia(total, target) {
  return (
    Math.abs(num(total.calorias) - num(target.calorias)) <= TOLERANCIA.calorias &&
    Math.abs(num(total.proteinas) - num(target.proteinas)) <= TOLERANCIA.proteinas &&
    Math.abs(num(total.carbohidratos) - num(target.carbohidratos)) <= TOLERANCIA.carbohidratos &&
    Math.abs(num(total.grasas) - num(target.grasas)) <= TOLERANCIA.grasas
  );
}

function mejorRellenoCarb(catalogoMap, excludeIds) {
  let mejor = null;
  let mejorScore = -Infinity;
  for (const cat of catalogoMap.values()) {
    if (excludeIds.has(cat.id)) continue;
    const carb = densidad(cat, "carbohidratos");
    const gras = densidad(cat, "grasas");
    if (carb < 0.12) continue;
    const score = carb * 2 - gras * 3;
    if (score > mejorScore) {
      mejorScore = score;
      mejor = cat;
    }
  }
  return mejor;
}

function itemMasGraso(items, catalogoMap) {
  let peor = null;
  let peorScore = -1;
  for (const item of items) {
    const cat = catalogoMap.get(item.id_alimento);
    if (!cat) continue;
    const score = densidad(cat, "grasas") * num(item.cantidad_sugerida);
    if (score > peorScore) {
      peorScore = score;
      peor = item;
    }
  }
  return peor;
}

function itemMasCarb(items, catalogoMap) {
  let mejor = null;
  let mejorScore = -Infinity;
  for (const item of items) {
    const cat = catalogoMap.get(item.id_alimento);
    if (!cat) continue;
    if (densidad(cat, "carbohidratos") < 0.12) continue;
    const score = densidad(cat, "carbohidratos") - densidad(cat, "grasas");
    if (score > mejorScore) {
      mejorScore = score;
      mejor = item;
    }
  }
  return mejor;
}

/** Un paso de ajuste; devuelve false si no hubo cambio (anti-bucle). */
function pasoAjusteCombo(items, catalogoMap, target, options) {
  const minQty = options.minQty ?? 0.5;
  const maxQty = options.maxQty ?? 400;
  const maxItems = options.maxItems ?? 7;
  const total = sumarMacrosLista(items);

  const errCarb = num(target.carbohidratos) - total.carbohidratos;
  const errGras = num(target.grasas) - total.grasas;
  const errCal = num(target.calorias) - total.calorias;

  if (errCarb > TOLERANCIA.carbohidratos) {
    const carbItem = itemMasCarb(items, catalogoMap);
    if (carbItem) {
      carbItem.cantidad_sugerida = clampQty(carbItem.cantidad_sugerida * 1.12, minQty, maxQty);
      return true;
    }
    const filler = mejorRellenoCarb(catalogoMap, idsEnCombo(items));
    if (filler && items.length < maxItems) {
      const qty = clampQty(
        (Math.min(errCarb, 40) / Math.max(densidad(filler, "carbohidratos"), 0.01)) * filler.porcion_base * 0.5,
        minQty,
        maxQty
      );
      items.push(itemDesdeCatalogo(filler, qty));
      return true;
    }
  }

  if (errGras < -TOLERANCIA.grasas) {
    const peor = itemMasGraso(items, catalogoMap);
    if (peor) {
      peor.cantidad_sugerida = clampQty(peor.cantidad_sugerida * 0.85, minQty, maxQty);
      return true;
    }
  }

  if (Math.abs(errCal) > TOLERANCIA.calorias && total.calorias > 0) {
    const factor = Math.max(0.88, Math.min(1.12, num(target.calorias) / total.calorias));
    for (const item of items) {
      item.cantidad_sugerida = clampQty(item.cantidad_sugerida * factor, minQty, maxQty);
    }
    return true;
  }

  return false;
}

function finalizarCombo(combo, items, catalogoMap, minQty, maxQty) {
  items = reconstruirItems(items, catalogoMap, minQty, maxQty);
  const macros_combo = sumarMacrosLista(items);
  Object.keys(macros_combo).forEach((k) => {
    macros_combo[k] = redondear(macros_combo[k]);
  });
  return {
    ...combo,
    alimentos_sugeridos: items,
    macros_combo,
    macros_ajustados: true
  };
}

/** Ajusta un combo hacia macros_objetivo_comida (rápido, tolerancia ±5 g / ±30 kcal). */
function optimizarCombo(combo, catalogoMap, target, options = {}) {
  if (!combo?.alimentos_sugeridos?.length || !target || num(target.calorias) <= 0) {
    return combo;
  }

  const minQty = options.minQty ?? 0.5;
  const maxQty = options.maxQty ?? 400;
  let items = reconstruirItems(combo.alimentos_sugeridos, catalogoMap, minQty, maxQty);
  if (!items.length) return combo;

  for (let i = 0; i < MAX_PASADAS_COMBO; i++) {
    items = reconstruirItems(items, catalogoMap, minQty, maxQty);
    if (dentroTolerancia(sumarMacrosLista(items), target)) break;
    if (!pasoAjusteCombo(items, catalogoMap, target, options)) break;
  }

  return finalizarCombo(combo, items, catalogoMap, minQty, maxQty);
}

function totalDieta(comidas) {
  return comidas.reduce(
    (t, c) => {
      const m = c.macros_combo || sumarMacrosLista(c.alimentos_sugeridos || []);
      return {
        calorias: t.calorias + num(m.calorias),
        proteinas: t.proteinas + num(m.proteinas),
        carbohidratos: t.carbohidratos + num(m.carbohidratos),
        grasas: t.grasas + num(m.grasas),
        sodio: t.sodio + num(m.sodio)
      };
    },
    { calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, sodio: 0 }
  );
}

function refrescarMacrosComidas(comidas) {
  for (const c of comidas) {
    c.macros_combo = sumarMacrosLista(c.alimentos_sugeridos || []);
    Object.keys(c.macros_combo).forEach((k) => {
      c.macros_combo[k] = redondear(c.macros_combo[k]);
    });
  }
}

/** Un paso global del plan del día. */
function pasoAjusteDieta(comidas, catalogoMap, targetDia, options) {
  const minQty = options.minQty ?? 0.5;
  const maxQty = options.maxQty ?? 400;
  const total = totalDieta(comidas);
  const errCarb = num(targetDia.carbohidratos) - total.carbohidratos;
  const errGras = num(targetDia.grasas) - total.grasas;
  const errCal = num(targetDia.calorias) - total.calorias;
  const n = Math.max(comidas.length, 1);

  if (errCarb > TOLERANCIA.carbohidratos) {
    const bloque = [...comidas].sort(
      (a, b) => num(a.macros_combo?.carbohidratos) - num(b.macros_combo?.carbohidratos)
    )[0];
    if (bloque) {
      const items = bloque.alimentos_sugeridos || [];
      const carbItem = itemMasCarb(items, catalogoMap);
      if (carbItem) {
        carbItem.cantidad_sugerida = clampQty(carbItem.cantidad_sugerida * 1.1, minQty, maxQty);
      } else {
        const filler = mejorRellenoCarb(catalogoMap, idsEnCombo(items));
        if (filler && items.length < 7) {
          items.push(
            itemDesdeCatalogo(
              filler,
              clampQty(
                (errCarb / n / Math.max(densidad(filler, "carbohidratos"), 0.01)) * filler.porcion_base * 0.4,
                minQty,
                maxQty
              )
            )
          );
        }
      }
      bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap, minQty, maxQty);
      refrescarMacrosComidas(comidas);
      return true;
    }
  }

  if (errGras < -TOLERANCIA.grasas) {
    let cambio = false;
    for (const bloque of comidas) {
      const peor = itemMasGraso(bloque.alimentos_sugeridos || [], catalogoMap);
      if (peor) {
        peor.cantidad_sugerida = clampQty(peor.cantidad_sugerida * 0.88, minQty, maxQty);
        cambio = true;
      }
    }
    if (cambio) {
      refrescarMacrosComidas(comidas);
      return true;
    }
  }

  if (Math.abs(errCal) > TOLERANCIA.calorias && total.calorias > 0) {
    const factor = Math.max(0.9, Math.min(1.1, num(targetDia.calorias) / total.calorias));
    for (const bloque of comidas) {
      for (const item of bloque.alimentos_sugeridos || []) {
        item.cantidad_sugerida = clampQty(item.cantidad_sugerida * factor, minQty, maxQty);
      }
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap, minQty, maxQty);
    }
    refrescarMacrosComidas(comidas);
    return true;
  }

  return false;
}

/** Ajuste global del plan del día (máx. 12 pasadas, tolerancia funcional). */
function optimizarDietaDia(dieta, catalogoMap, targetDia, options = {}) {
  if (!dieta?.comidas?.length || !targetDia) return dieta;

  const minQty = options.minQty ?? 0.5;
  const maxQty = options.maxQty ?? 400;

  dieta.comidas = dieta.comidas.map((bloque) => ({
    ...bloque,
    alimentos_sugeridos: reconstruirItems(bloque.alimentos_sugeridos || [], catalogoMap, minQty, maxQty)
  }));
  refrescarMacrosComidas(dieta.comidas);

  for (let pass = 0; pass < MAX_PASADAS_DIA; pass++) {
    if (dentroTolerancia(totalDieta(dieta.comidas), targetDia)) break;
    if (!pasoAjusteDieta(dieta.comidas, catalogoMap, targetDia, options)) break;
  }

  dieta.macros_plan = totalDieta(dieta.comidas);
  Object.keys(dieta.macros_plan).forEach((k) => {
    dieta.macros_plan[k] = redondear(dieta.macros_plan[k]);
  });

  return dieta;
}

module.exports = {
  optimizarCombo,
  optimizarDietaDia,
  sumarMacrosLista,
  dentroTolerancia,
  TOLERANCIA
};
