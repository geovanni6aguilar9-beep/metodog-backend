/**
 * Ajuste de porciones tras Gemini.
 * Tolerancia funcional: ±30 kcal, ±5 g P/C/G.
 */

const TOLERANCIA = {
  calorias: 30,
  proteinas: 5,
  carbohidratos: 5,
  grasas: 5
};

const MAX_PASADAS_COMBO = 14;
const MAX_PASADAS_DIA = 24;
const FACTOR_ESCALA_MAX = 1.28;

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

function mejorRellenoGrasa(catalogoMap, excludeIds) {
  let mejor = null;
  let mejorScore = -Infinity;
  for (const cat of catalogoMap.values()) {
    if (excludeIds.has(cat.id)) continue;
    const gras = densidad(cat, "grasas");
    const carb = densidad(cat, "carbohidratos");
    if (gras < 0.4) continue;
    const score = gras * 2 - carb;
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

function itemMasProteina(items, catalogoMap) {
  let peor = null;
  let peorScore = -1;
  for (const item of items) {
    const cat = catalogoMap.get(item.id_alimento);
    if (!cat) continue;
    const score = densidad(cat, "proteinas") * num(item.cantidad_sugerida);
    if (score > peorScore) {
      peorScore = score;
      peor = item;
    }
  }
  return peor;
}

function factorEscalaCalorias(total, target) {
  if (num(total.calorias) <= 0 || num(target.calorias) <= 0) return 1;
  return Math.max(0.82, Math.min(FACTOR_ESCALA_MAX, num(target.calorias) / total.calorias));
}

function escalarItems(items, factor, minQty, maxQty) {
  if (Math.abs(factor - 1) < 0.01) return false;
  for (const item of items) {
    item.cantidad_sugerida = clampQty(item.cantidad_sugerida * factor, minQty, maxQty);
  }
  return true;
}

function pasoEscalarCaloriasItems(items, target, minQty, maxQty) {
  const total = sumarMacrosLista(items);
  const errCal = num(target.calorias) - total.calorias;
  if (Math.abs(errCal) <= TOLERANCIA.calorias || total.calorias <= 0) return false;
  if (Math.abs(errCal) < 60) return false;
  return escalarItems(items, factorEscalaCalorias(total, target), minQty, maxQty);
}

function pasoAjusteCombo(items, catalogoMap, target, options) {
  const minQty = options.minQty ?? 0.5;
  const maxQty = options.maxQty ?? 400;
  const maxItems = options.maxItems ?? 7;
  const total = sumarMacrosLista(items);

  const errProt = num(target.proteinas) - total.proteinas;
  const errCarb = num(target.carbohidratos) - total.carbohidratos;
  const errGras = num(target.grasas) - total.grasas;
  const errCal = num(target.calorias) - total.calorias;

  if (errCal > 80 && total.calorias > 0) {
    if (pasoEscalarCaloriasItems(items, target, minQty, maxQty)) return true;
  }

  if (errProt < -TOLERANCIA.proteinas) {
    const protItem = itemMasProteina(items, catalogoMap);
    if (protItem) {
      protItem.cantidad_sugerida = clampQty(protItem.cantidad_sugerida * 0.88, minQty, maxQty);
      return true;
    }
  }

  if (errCarb > TOLERANCIA.carbohidratos) {
    const carbItem = itemMasCarb(items, catalogoMap);
    if (carbItem) {
      const boost = errCarb > 25 ? 1.18 : 1.12;
      carbItem.cantidad_sugerida = clampQty(carbItem.cantidad_sugerida * boost, minQty, maxQty);
      return true;
    }
    const filler = mejorRellenoCarb(catalogoMap, idsEnCombo(items));
    if (filler && items.length < maxItems) {
      const qty = clampQty(
        (Math.min(errCarb, 55) / Math.max(densidad(filler, "carbohidratos"), 0.01)) * num(filler.porcion_base, 1) * 0.75,
        minQty,
        maxQty
      );
      items.push(itemDesdeCatalogo(filler, qty));
      return true;
    }
  }

  if (errGras > TOLERANCIA.grasas) {
    const grasItem = itemMasGraso(items, catalogoMap);
    if (grasItem && densidad(catalogoMap.get(grasItem.id_alimento), "grasas") >= 0.4) {
      grasItem.cantidad_sugerida = clampQty(grasItem.cantidad_sugerida * 1.12, minQty, maxQty);
      return true;
    }
    const filler = mejorRellenoGrasa(catalogoMap, idsEnCombo(items));
    if (filler && items.length < maxItems) {
      const qty = clampQty(
        (Math.min(errGras, 18) / Math.max(densidad(filler, "grasas"), 0.01)) * num(filler.porcion_base, 1) * 0.7,
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
    return escalarItems(items, factorEscalaCalorias(total, target), minQty, maxQty);
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

function optimizarCombo(combo, catalogoMap, target, options = {}) {
  if (!combo?.alimentos_sugeridos?.length || !target || num(target.calorias) <= 0) {
    return combo;
  }

  const minQty = options.minQty ?? 0.5;
  const maxQty = options.maxQty ?? 400;
  let items = reconstruirItems(combo.alimentos_sugeridos, catalogoMap, minQty, maxQty);
  if (!items.length) return combo;

  pasoEscalarCaloriasItems(items, target, minQty, maxQty);
  items = reconstruirItems(items, catalogoMap, minQty, maxQty);

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

function refrescarMacrosComidas(comidas, catalogoMap, minQty, maxQty) {
  for (const c of comidas) {
    c.alimentos_sugeridos = reconstruirItems(c.alimentos_sugeridos || [], catalogoMap, minQty, maxQty);
    c.macros_combo = sumarMacrosLista(c.alimentos_sugeridos || []);
    Object.keys(c.macros_combo).forEach((k) => {
      c.macros_combo[k] = redondear(c.macros_combo[k]);
    });
  }
}

function pasoAjusteDieta(comidas, catalogoMap, targetDia, options) {
  const minQty = options.minQty ?? 0.5;
  const maxQty = options.maxQty ?? 400;
  const total = totalDieta(comidas);
  const errProt = num(targetDia.proteinas) - total.proteinas;
  const errCarb = num(targetDia.carbohidratos) - total.carbohidratos;
  const errGras = num(targetDia.grasas) - total.grasas;
  const errCal = num(targetDia.calorias) - total.calorias;
  const n = Math.max(comidas.length, 1);

  if (errCal > 80 && total.calorias > 0) {
    const factor = factorEscalaCalorias(total, targetDia);
    for (const bloque of comidas) {
      escalarItems(bloque.alimentos_sugeridos || [], factor, minQty, maxQty);
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap, minQty, maxQty);
    }
    refrescarMacrosComidas(comidas, catalogoMap, minQty, maxQty);
    return true;
  }

  if (errProt < -TOLERANCIA.proteinas) {
    const bloque = [...comidas].sort(
      (a, b) => num(b.macros_combo?.proteinas) - num(a.macros_combo?.proteinas)
    )[0];
    if (bloque) {
      const protItem = itemMasProteina(bloque.alimentos_sugeridos || [], catalogoMap);
      if (protItem) {
        protItem.cantidad_sugerida = clampQty(protItem.cantidad_sugerida * 0.9, minQty, maxQty);
        bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap, minQty, maxQty);
        refrescarMacrosComidas(comidas, catalogoMap, minQty, maxQty);
        return true;
      }
    }
  }

  if (errCarb > TOLERANCIA.carbohidratos) {
    const bloque = [...comidas].sort(
      (a, b) => num(a.macros_combo?.carbohidratos) - num(b.macros_combo?.carbohidratos)
    )[0];
    if (bloque) {
      const items = bloque.alimentos_sugeridos || [];
      const carbItem = itemMasCarb(items, catalogoMap);
      const boost = errCarb > 40 ? 1.15 : 1.1;
      if (carbItem) {
        carbItem.cantidad_sugerida = clampQty(carbItem.cantidad_sugerida * boost, minQty, maxQty);
      } else {
        const filler = mejorRellenoCarb(catalogoMap, idsEnCombo(items));
        if (filler && items.length < 7) {
          items.push(
            itemDesdeCatalogo(
              filler,
              clampQty(
                (errCarb / n / Math.max(densidad(filler, "carbohidratos"), 0.01)) * num(filler.porcion_base, 1) * 0.65,
                minQty,
                maxQty
              )
            )
          );
        }
      }
      bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap, minQty, maxQty);
      refrescarMacrosComidas(comidas, catalogoMap, minQty, maxQty);
      return true;
    }
  }

  if (errGras > TOLERANCIA.grasas) {
    const bloque = [...comidas].sort(
      (a, b) => num(a.macros_combo?.grasas) - num(b.macros_combo?.grasas)
    )[0];
    if (bloque) {
      const items = bloque.alimentos_sugeridos || [];
      const grasItem = itemMasGraso(items, catalogoMap);
      if (grasItem && densidad(catalogoMap.get(grasItem.id_alimento), "grasas") >= 0.4) {
        grasItem.cantidad_sugerida = clampQty(grasItem.cantidad_sugerida * 1.12, minQty, maxQty);
      } else {
        const filler = mejorRellenoGrasa(catalogoMap, idsEnCombo(items));
        if (filler && items.length < 7) {
          items.push(
            itemDesdeCatalogo(
              filler,
              clampQty(
                (errGras / n / Math.max(densidad(filler, "grasas"), 0.01)) * num(filler.porcion_base, 1) * 0.65,
                minQty,
                maxQty
              )
            )
          );
        }
      }
      bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap, minQty, maxQty);
      refrescarMacrosComidas(comidas, catalogoMap, minQty, maxQty);
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
      refrescarMacrosComidas(comidas, catalogoMap, minQty, maxQty);
      return true;
    }
  }

  if (Math.abs(errCal) > TOLERANCIA.calorias && total.calorias > 0) {
    const factor = factorEscalaCalorias(total, targetDia);
    for (const bloque of comidas) {
      escalarItems(bloque.alimentos_sugeridos || [], factor, minQty, maxQty);
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap, minQty, maxQty);
    }
    refrescarMacrosComidas(comidas, catalogoMap, minQty, maxQty);
    return true;
  }

  return false;
}

function optimizarDietaDia(dieta, catalogoMap, targetDia, options = {}) {
  if (!dieta?.comidas?.length || !targetDia) return dieta;

  const minQty = options.minQty ?? 0.5;
  const maxQty = options.maxQty ?? 400;

  dieta.comidas = dieta.comidas.map((bloque) => ({
    ...bloque,
    alimentos_sugeridos: reconstruirItems(bloque.alimentos_sugeridos || [], catalogoMap, minQty, maxQty)
  }));
  refrescarMacrosComidas(dieta.comidas, catalogoMap, minQty, maxQty);

  const totalInicial = totalDieta(dieta.comidas);
  if (num(targetDia.calorias) - totalInicial.calorias > 80 && totalInicial.calorias > 0) {
    const factor = factorEscalaCalorias(totalInicial, targetDia);
    for (const bloque of dieta.comidas) {
      escalarItems(bloque.alimentos_sugeridos || [], factor, minQty, maxQty);
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap, minQty, maxQty);
    }
    refrescarMacrosComidas(dieta.comidas, catalogoMap, minQty, maxQty);
  }

  for (let pass = 0; pass < MAX_PASADAS_DIA; pass++) {
    if (dentroTolerancia(totalDieta(dieta.comidas), targetDia)) break;
    if (!pasoAjusteDieta(dieta.comidas, catalogoMap, targetDia, options)) break;
  }

  const totalFinal = totalDieta(dieta.comidas);
  if (Math.abs(num(targetDia.calorias) - totalFinal.calorias) > 50 && totalFinal.calorias > 0) {
    const factor = factorEscalaCalorias(totalFinal, targetDia);
    for (const bloque of dieta.comidas) {
      escalarItems(bloque.alimentos_sugeridos || [], factor, minQty, maxQty);
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap, minQty, maxQty);
    }
    refrescarMacrosComidas(dieta.comidas, catalogoMap, minQty, maxQty);
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
