/**
 * Ajuste de porciones tras Gemini (v4.1).
 * Tolerancia funcional: ±30 kcal, ±5 g P/C/G.
 */

const TOLERANCIA = {
  calorias: 30,
  proteinas: 5,
  carbohidratos: 5,
  grasas: 5
};

const MAX_PASADAS_COMBO = 16;
const MAX_PASADAS_DIA = 32;
const FACTOR_ESCALA_MAX = 1.28;

const GRUPOS_CARB_LIMPIO = new Set(["carbohidrato_complejo"]);
const GRUPOS_NO_RELLENO_CARB = new Set(["verdura", "legumbre", "lacteo", "condimento", "libre", "azucar"]);
const FRUTAS_CARB_ALTO = /plátano|platano|mango|papaya|uva/i;

function grupoEquiv(cat) {
  const ge = String(cat?.grupo_equivalencia || "").trim().toLowerCase();
  if (ge) return ge;
  const inferido = inferGrupoEquivalencia(cat);
  if (inferido) return inferido;
  const g = String(cat?.grupo || "").trim().toLowerCase();
  if (g === "verduras") return "verdura";
  if (g === "frutas") return "fruta";
  if (g === "cereales") return "carbohidrato_complejo";
  if (g === "carnes") return "proteina_magra";
  if (g === "grasas") return "grasa";
  if (g === "leguminosas") return "legumbre";
  if (g === "lácteos" || g === "lacteos") return "lacteo";
  return "";
}

/** Fallback cuando Turso/payload no traen grupo_equivalencia. */
function inferGrupoEquivalencia(cat) {
  const nombre = String(cat?.nombre || "").toLowerCase();
  if (/almendr|nueces?|cacahuate|avellana|macadamia|semilla de|semillas|piñones?|pecanas?/.test(nombre)) return "grasa";
  if (/aceite|aguacate|crema de cacahuate|mantequilla de/.test(nombre)) return "grasa";
  if (/arroz|avena|tortilla|papa|camote|pasta|pan integral|pan blanco|quinoa|bagel|harina de/.test(nombre)) {
    return "carbohidrato_complejo";
  }
  if (/brócoli|brocoli|espinaca|jitomate|pepino|lechuga|calabac|espárrago|esparrago|nopal|coliflor|zanahoria/.test(nombre)) {
    return "verdura";
  }
  if (/plátano|platano|fresa|sandía|sandia|mango|papaya|uva|manzana|arándano/.test(nombre)) return "fruta";
  if (/whey|caseína|caseina|proteína.*polvo|proteina.*polvo|bcaa|creatina/.test(nombre)) return "proteina_magra";
  if (/leche|yogur|kefir|queso cottage/.test(nombre)) return "lacteo";
  if (/huevo/.test(nombre)) return "proteina_grasa";
  if (/pollo|pavo|res|atún|atun|tilapia|salmón|salmon|camarón|camaron|bowl|jamón|jamon/.test(nombre)) {
    return "proteina_magra";
  }
  if (/lenteja|frijol|garbanzo/.test(nombre)) return "legumbre";
  return "";
}

function esPlatoCompuesto(cat) {
  return /bowl|wrap|meal prep|burrito|tacos al plato|combo fitness/.test(String(cat?.nombre || "").toLowerCase());
}

function enriquecerCatalogoMap(catalogoMap) {
  for (const [id, cat] of catalogoMap.entries()) {
    if (grupoEquiv(cat)) continue;
    const ge = inferGrupoEquivalencia(cat);
    if (ge) catalogoMap.set(id, { ...cat, grupo_equivalencia: ge });
  }
  return catalogoMap;
}

function optsCarbFill(errProt, errCarb) {
  const proteinAlLimite = errProt <= TOLERANCIA.proteinas;
  return {
    modoLimpio: proteinAlLimite,
    soloComplejo: proteinAlLimite && errCarb > 15
  };
}

/** Topes realistas por tipo de alimento (MétodoG). */
function limitesPorAlimento(cat) {
  const eq = grupoEquiv(cat);
  const u = String(cat?.unidad || "g").toLowerCase();

  if (eq === "verdura" && (u === "g" || u === "ml")) return { min: 25, max: 200 };
  if (eq === "fruta" && u === "g") return { min: 50, max: 200 };
  if (eq === "carbohidrato_complejo") {
    if (u === "g" || u === "ml") return { min: 40, max: 350 };
    if (u === "pieza") return { min: 1, max: 10 };
  }
  if (eq === "proteina_magra") {
    if (esPlatoCompuesto(cat) && u === "g") return { min: 120, max: 280 };
    if (u === "g") return { min: 80, max: 250 };
    if (u === "scoop") return { min: 0.5, max: 2.5 };
  }
  if (eq === "proteina_grasa") {
    if (u === "pieza") return { min: 1, max: 5 };
    if (u === "g") return { min: 60, max: 250 };
  }
  if (eq === "grasa") {
    if (u === "cucharada") return { min: 0.5, max: 2 };
    if (u === "g") return { min: 5, max: 30 };
  }
  if (eq === "legumbre" && u === "g") return { min: 50, max: 200 };
  if (eq === "lacteo" && (u === "g" || u === "ml")) return { min: 100, max: 400 };

  if (u === "g" || u === "ml") return { min: 0.5, max: 350 };
  if (u === "cucharada") return { min: 0.5, max: 2 };
  if (u === "scoop") return { min: 0.5, max: 2.5 };
  if (u === "pieza") return { min: 1, max: 10 };
  return { min: 0.5, max: 350 };
}

function cantidadFinalAlimento(qty, cat) {
  const lim = limitesPorAlimento(cat);
  const u = String(cat?.unidad || "g").toLowerCase();
  let q = num(qty, 0);
  q = Math.min(lim.max, Math.max(lim.min, q));
  if (u === "g" || u === "ml") q = Math.round(q);
  else q = redondear(q);
  return Math.min(lim.max, Math.max(lim.min, q));
}

function clampQtyAlimento(qty, cat) {
  return cantidadFinalAlimento(qty, cat);
}

function esFuenteCarbPermitida(cat, opciones = {}) {
  if (!cat) return false;
  const modoLimpio = !!opciones.modoLimpio;
  const soloComplejo = !!opciones.soloComplejo;
  const eq = grupoEquiv(cat);
  if (GRUPOS_NO_RELLENO_CARB.has(eq)) return false;
  if (soloComplejo) return GRUPOS_CARB_LIMPIO.has(eq);
  if (modoLimpio) {
    if (GRUPOS_CARB_LIMPIO.has(eq)) return true;
    if (eq === "fruta" && FRUTAS_CARB_ALTO.test(String(cat.nombre || ""))) return true;
    return false;
  }
  if (GRUPOS_CARB_LIMPIO.has(eq)) return true;
  if (eq === "fruta") {
    return FRUTAS_CARB_ALTO.test(String(cat.nombre || "")) || densidad(cat, "carbohidratos") >= 0.18;
  }
  return densidad(cat, "carbohidratos") >= 0.15 && eq !== "verdura";
}

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

function redondearCantidad(cantidad, unidad) {
  const u = String(unidad || "g").toLowerCase();
  if (u === "g" || u === "ml") return Math.round(num(cantidad));
  return redondear(cantidad);
}

function itemDesdeCatalogo(cat, cantidad) {
  const base = num(cat?.porcion_base, 1) || 1;
  const qty = cantidadFinalAlimento(cantidad, cat);
  const factor = num(qty, 0) / base;
  return {
    id_alimento: cat.id,
    nombre: cat.nombre,
    cantidad_sugerida: qty,
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

function reconstruirItems(items, catalogoMap) {
  const out = [];
  for (const row of items) {
    const cat = catalogoMap.get(row.id_alimento);
    if (!cat) continue;
    const qty = clampQtyAlimento(num(row.cantidad_sugerida, 0), cat);
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

function mejorRellenoCarb(catalogoMap, excludeIds, opciones = {}) {
  let mejor = null;
  let mejorScore = -Infinity;
  for (const cat of catalogoMap.values()) {
    if (excludeIds.has(cat.id)) continue;
    if (!esFuenteCarbPermitida(cat, opciones)) continue;
    const carb = densidad(cat, "carbohidratos");
    const prot = densidad(cat, "proteinas");
    const gras = densidad(cat, "grasas");
    const score = carb * 3 - prot * 4 - gras * 2;
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

function itemMasCarb(items, catalogoMap, opciones = {}) {
  const carbOpts = typeof opciones === "object" ? opciones : { modoLimpio: !!opciones };
  let mejor = null;
  let mejorScore = -Infinity;
  for (const item of items) {
    const cat = catalogoMap.get(item.id_alimento);
    if (!cat || !esFuenteCarbPermitida(cat, carbOpts)) continue;
    const score = densidad(cat, "carbohidratos") - densidad(cat, "proteinas") * 0.5 - densidad(cat, "grasas");
    if (score > mejorScore) {
      mejorScore = score;
      mejor = item;
    }
  }
  return mejor;
}

function prioridadRecorteProteina(cat) {
  const eq = grupoEquiv(cat);
  const u = String(cat?.unidad || "g").toLowerCase();
  if (eq === "proteina_magra" && u === "scoop") return 100;
  if (eq === "lacteo") return 95;
  if (eq === "grasa") return 90;
  if (eq === "proteina_grasa" && u === "pieza") return 75;
  if (esPlatoCompuesto(cat)) return 25;
  if (eq === "proteina_magra" && u === "g") return 35;
  if (eq === "legumbre") return 45;
  return 10;
}

function itemMasProteinaParaRecorte(items, catalogoMap) {
  let candidato = null;
  let mejorPrioridad = -1;
  let mejorScore = -1;
  for (const item of items) {
    const cat = catalogoMap.get(item.id_alimento);
    if (!cat) continue;
    const lim = limitesPorAlimento(cat);
    if (num(item.cantidad_sugerida) <= lim.min * 1.02) continue;
    const pri = prioridadRecorteProteina(cat);
    const score = densidad(cat, "proteinas") * num(item.cantidad_sugerida);
    if (pri > mejorPrioridad || (pri === mejorPrioridad && score > mejorScore)) {
      mejorPrioridad = pri;
      mejorScore = score;
      candidato = item;
    }
  }
  return candidato;
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

function escalarItems(items, factor, catalogoMap) {
  if (Math.abs(factor - 1) < 0.01) return false;
  for (const item of items) {
    const cat = catalogoMap.get(item.id_alimento);
    if (!cat) continue;
    item.cantidad_sugerida = clampQtyAlimento(item.cantidad_sugerida * factor, cat);
  }
  return true;
}

function pasoEscalarCaloriasItems(items, target, catalogoMap) {
  const total = sumarMacrosLista(items);
  const errCal = num(target.calorias) - total.calorias;
  if (Math.abs(errCal) <= TOLERANCIA.calorias || total.calorias <= 0) return false;
  if (Math.abs(errCal) < 60) return false;
  return escalarItems(items, factorEscalaCalorias(total, target), catalogoMap);
}

function pasoAjusteCombo(items, catalogoMap, target, options) {
  const maxItems = options.maxItems ?? 7;
  const total = sumarMacrosLista(items);

  const errProt = num(target.proteinas) - total.proteinas;
  const errCarb = num(target.carbohidratos) - total.carbohidratos;
  const errGras = num(target.grasas) - total.grasas;
  const errCal = num(target.calorias) - total.calorias;
  const carbOpts = optsCarbFill(errProt, errCarb);

  if (errCal > 80 && total.calorias > 0) {
    if (pasoEscalarCaloriasItems(items, target, catalogoMap)) return true;
  }

  if (errProt < -TOLERANCIA.proteinas) {
    const protItem = itemMasProteinaParaRecorte(items, catalogoMap);
    if (protItem) {
      const cat = catalogoMap.get(protItem.id_alimento);
      protItem.cantidad_sugerida = clampQtyAlimento(protItem.cantidad_sugerida * 0.88, cat);
      return true;
    }
  }

  if (errCarb > TOLERANCIA.carbohidratos) {
    const carbItem = itemMasCarb(items, catalogoMap, carbOpts);
    if (carbItem) {
      const cat = catalogoMap.get(carbItem.id_alimento);
      const boost = errCarb > 25 ? 1.18 : 1.12;
      carbItem.cantidad_sugerida = clampQtyAlimento(carbItem.cantidad_sugerida * boost, cat);
      return true;
    }
    const filler = mejorRellenoCarb(catalogoMap, idsEnCombo(items), carbOpts);
    if (filler && items.length < maxItems) {
      const qty = clampQtyAlimento(
        (Math.min(errCarb, 55) / Math.max(densidad(filler, "carbohidratos"), 0.01)) * num(filler.porcion_base, 1) * 0.75,
        filler
      );
      items.push(itemDesdeCatalogo(filler, qty));
      return true;
    }
  }

  if (errCarb < -TOLERANCIA.carbohidratos) {
    const carbItem = itemMasCarb(items, catalogoMap, { modoLimpio: false });
    if (carbItem) {
      const cat = catalogoMap.get(carbItem.id_alimento);
      const cut = errCarb < -25 ? 0.88 : 0.92;
      carbItem.cantidad_sugerida = clampQtyAlimento(carbItem.cantidad_sugerida * cut, cat);
      return true;
    }
  }

  if (errGras > TOLERANCIA.grasas) {
    const grasItem = itemMasGraso(items, catalogoMap);
    if (grasItem && densidad(catalogoMap.get(grasItem.id_alimento), "grasas") >= 0.4) {
      const cat = catalogoMap.get(grasItem.id_alimento);
      grasItem.cantidad_sugerida = clampQtyAlimento(grasItem.cantidad_sugerida * 1.12, cat);
      return true;
    }
    const filler = mejorRellenoGrasa(catalogoMap, idsEnCombo(items));
    if (filler && items.length < maxItems) {
      const qty = clampQtyAlimento(
        (Math.min(errGras, 18) / Math.max(densidad(filler, "grasas"), 0.01)) * num(filler.porcion_base, 1) * 0.7,
        filler
      );
      items.push(itemDesdeCatalogo(filler, qty));
      return true;
    }
  }

  if (errGras < -TOLERANCIA.grasas) {
    const peor = itemMasGraso(items, catalogoMap);
    if (peor) {
      const cat = catalogoMap.get(peor.id_alimento);
      peor.cantidad_sugerida = clampQtyAlimento(peor.cantidad_sugerida * 0.85, cat);
      return true;
    }
  }

  if (Math.abs(errCal) > TOLERANCIA.calorias && total.calorias > 0) {
    return escalarItems(items, factorEscalaCalorias(total, target), catalogoMap);
  }

  return false;
}

function finalizarCombo(combo, items, catalogoMap) {
  items = reconstruirItems(items, catalogoMap);
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

  let items = reconstruirItems(combo.alimentos_sugeridos, catalogoMap);
  if (!items.length) return combo;

  pasoEscalarCaloriasItems(items, target, catalogoMap);
  items = reconstruirItems(items, catalogoMap);

  for (let i = 0; i < MAX_PASADAS_COMBO; i++) {
    items = reconstruirItems(items, catalogoMap);
    if (dentroTolerancia(sumarMacrosLista(items), target)) break;
    if (!pasoAjusteCombo(items, catalogoMap, target, options)) break;
  }

  return finalizarCombo(combo, items, catalogoMap);
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

function refrescarMacrosComidas(comidas, catalogoMap) {
  for (const c of comidas) {
    c.alimentos_sugeridos = reconstruirItems(c.alimentos_sugeridos || [], catalogoMap);
    c.macros_combo = sumarMacrosLista(c.alimentos_sugeridos || []);
    Object.keys(c.macros_combo).forEach((k) => {
      c.macros_combo[k] = redondear(c.macros_combo[k]);
    });
  }
}

function pasoRellenarCarbDieta(comidas, catalogoMap, targetDia, options) {
  const total = totalDieta(comidas);
  const errCarb = num(targetDia.carbohidratos) - total.carbohidratos;
  const errProt = num(targetDia.proteinas) - total.proteinas;
  if (errCarb <= TOLERANCIA.carbohidratos) return false;

  const carbOpts = optsCarbFill(errProt, errCarb);
  const n = Math.max(comidas.length, 1);
  const bloque = [...comidas].sort(
    (a, b) => num(a.macros_combo?.carbohidratos) - num(b.macros_combo?.carbohidratos)
  )[0];
  if (!bloque) return false;

  const items = bloque.alimentos_sugeridos || [];
  const carbItem = itemMasCarb(items, catalogoMap, carbOpts);
  const boost = errCarb > 50 ? 1.22 : errCarb > 25 ? 1.15 : 1.1;

  if (carbItem) {
    const cat = catalogoMap.get(carbItem.id_alimento);
    carbItem.cantidad_sugerida = clampQtyAlimento(carbItem.cantidad_sugerida * boost, cat);
  } else {
    const filler = mejorRellenoCarb(catalogoMap, idsEnCombo(items), carbOpts);
    if (filler && items.length < 7) {
      items.push(
        itemDesdeCatalogo(
          filler,
          clampQtyAlimento(
            (errCarb / n / Math.max(densidad(filler, "carbohidratos"), 0.01)) *
              num(filler.porcion_base, 1) *
              0.92,
            filler
          )
        )
      );
    } else if (errProt >= -TOLERANCIA.proteinas) {
      return false;
    }
  }

  bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap);
  refrescarMacrosComidas(comidas, catalogoMap);
  return true;
}

/** Reparte relleno de carbos en las comidas más bajas (post-afinado). */
function pasoDistribuirCarbFinal(comidas, catalogoMap, targetDia, options) {
  const total = totalDieta(comidas);
  const errCal = num(targetDia.calorias) - total.calorias;
  const errCarb = num(targetDia.carbohidratos) - total.carbohidratos;
  const errProt = num(targetDia.proteinas) - total.proteinas;
  if (errCarb <= TOLERANCIA.carbohidratos || errCal < -40) return false;

  const carbOpts = optsCarbFill(errProt, errCarb);
  const ordenadas = [...comidas].sort(
    (a, b) => num(a.macros_combo?.carbohidratos) - num(b.macros_combo?.carbohidratos)
  );
  const nBoost = errCarb > 35 ? 3 : errCarb > 18 ? 2 : 1;
  const boost = errCarb > 40 ? 1.18 : errCarb > 25 ? 1.12 : 1.08;
  let cambio = false;

  for (let i = 0; i < Math.min(nBoost, ordenadas.length); i++) {
    const bloque = ordenadas[i];
    const items = bloque.alimentos_sugeridos || [];
    const carbItem = itemMasCarb(items, catalogoMap, carbOpts);
    if (carbItem) {
      const cat = catalogoMap.get(carbItem.id_alimento);
      carbItem.cantidad_sugerida = clampQtyAlimento(carbItem.cantidad_sugerida * boost, cat);
      bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap);
      cambio = true;
    } else if (items.length < 7) {
      const filler = mejorRellenoCarb(catalogoMap, idsEnCombo(items), carbOpts);
      if (filler) {
        const porcion =
          (errCarb / nBoost / Math.max(densidad(filler, "carbohidratos"), 0.01)) *
          num(filler.porcion_base, 1) *
          0.9;
        items.push(itemDesdeCatalogo(filler, porcion));
        bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap);
        cambio = true;
      }
    }
  }

  if (cambio) refrescarMacrosComidas(comidas, catalogoMap);
  return cambio;
}

/** Ajuste fino cuando kcal ya cuadra pero P/C/G se pasan o faltan. */
function pasoAfinarMacrosDieta(comidas, catalogoMap, targetDia, options) {
  const total = totalDieta(comidas);
  if (Math.abs(num(targetDia.calorias) - total.calorias) > 50) return false;

  const errProt = num(targetDia.proteinas) - total.proteinas;
  const errCarb = num(targetDia.carbohidratos) - total.carbohidratos;
  const errGras = num(targetDia.grasas) - total.grasas;
  const carbOpts = optsCarbFill(errProt, errCarb);

  if (errCarb < -TOLERANCIA.carbohidratos) {
    const bloque = [...comidas].sort(
      (a, b) => num(b.macros_combo?.carbohidratos) - num(a.macros_combo?.carbohidratos)
    )[0];
    if (bloque) {
      const carbItem = itemMasCarb(bloque.alimentos_sugeridos || [], catalogoMap, { modoLimpio: false });
      if (carbItem) {
        const cat = catalogoMap.get(carbItem.id_alimento);
        const cut = errCarb < -25 ? 0.87 : 0.91;
        carbItem.cantidad_sugerida = clampQtyAlimento(carbItem.cantidad_sugerida * cut, cat);
        bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap);
        refrescarMacrosComidas(comidas, catalogoMap);
        return true;
      }
    }
  }

  if (errProt < -TOLERANCIA.proteinas) {
    const bloque = [...comidas].sort(
      (a, b) => num(b.macros_combo?.proteinas) - num(a.macros_combo?.proteinas)
    )[0];
    if (bloque) {
      const protItem = itemMasProteinaParaRecorte(bloque.alimentos_sugeridos || [], catalogoMap);
      if (protItem) {
        const cat = catalogoMap.get(protItem.id_alimento);
        protItem.cantidad_sugerida = clampQtyAlimento(protItem.cantidad_sugerida * 0.9, cat);
        bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap);
        refrescarMacrosComidas(comidas, catalogoMap);
        return true;
      }
    }
  }

  if (errGras > TOLERANCIA.grasas) {
    const bloque = [...comidas].sort(
      (a, b) => num(a.macros_combo?.grasas) - num(b.macros_combo?.grasas)
    )[0];
    if (bloque) {
      const items = bloque.alimentos_sugeridos || [];
      const grasItem = itemMasGraso(items, catalogoMap);
      if (grasItem && densidad(catalogoMap.get(grasItem.id_alimento), "grasas") >= 0.35) {
        const cat = catalogoMap.get(grasItem.id_alimento);
        grasItem.cantidad_sugerida = clampQtyAlimento(grasItem.cantidad_sugerida * 1.1, cat);
      } else {
        const filler = mejorRellenoGrasa(catalogoMap, idsEnCombo(items));
        if (filler && items.length < 7) {
          const n = Math.max(comidas.length, 1);
          items.push(
            itemDesdeCatalogo(
              filler,
              clampQtyAlimento(
                (errGras / n / Math.max(densidad(filler, "grasas"), 0.01)) * num(filler.porcion_base, 1) * 0.55,
                filler
              )
            )
          );
        }
      }
      bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap);
      refrescarMacrosComidas(comidas, catalogoMap);
      return true;
    }
  }

  if (errCarb > TOLERANCIA.carbohidratos && carbOpts.modoLimpio) {
    const bloque = [...comidas].sort(
      (a, b) => num(a.macros_combo?.carbohidratos) - num(b.macros_combo?.carbohidratos)
    )[0];
    if (bloque) {
      const items = bloque.alimentos_sugeridos || [];
      const carbItem = itemMasCarb(items, catalogoMap, carbOpts);
      if (carbItem) {
        const cat = catalogoMap.get(carbItem.id_alimento);
        carbItem.cantidad_sugerida = clampQtyAlimento(carbItem.cantidad_sugerida * 1.08, cat);
        bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap);
        refrescarMacrosComidas(comidas, catalogoMap);
        return true;
      }
      const filler = mejorRellenoCarb(catalogoMap, idsEnCombo(items), carbOpts);
      if (filler && items.length < 7) {
        items.push(
          itemDesdeCatalogo(
            filler,
            clampQtyAlimento(
              (Math.min(errCarb, 40) / Math.max(densidad(filler, "carbohidratos"), 0.01)) * num(filler.porcion_base, 1) * 0.6,
              filler
            )
          )
        );
        bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap);
        refrescarMacrosComidas(comidas, catalogoMap);
        return true;
      }
    }
  }

  return false;
}

function pasoAjusteDieta(comidas, catalogoMap, targetDia, options) {
  const total = totalDieta(comidas);
  const errProt = num(targetDia.proteinas) - total.proteinas;
  const errCarb = num(targetDia.carbohidratos) - total.carbohidratos;
  const errGras = num(targetDia.grasas) - total.grasas;
  const errCal = num(targetDia.calorias) - total.calorias;
  const n = Math.max(comidas.length, 1);
  const carbOpts = optsCarbFill(errProt, errCarb);

  if (errProt < -TOLERANCIA.proteinas) {
    if (pasoRecortarProteinaExceso(comidas, catalogoMap, targetDia)) return true;
  }

  if (errCarb > 15) {
    if (pasoRellenarCarbDieta(comidas, catalogoMap, targetDia, options)) return true;
  }

  if (errCal > 80 && errCarb <= 20 && total.calorias > 0) {
    const factor = factorEscalaCalorias(total, targetDia);
    for (const bloque of comidas) {
      escalarItems(bloque.alimentos_sugeridos || [], factor, catalogoMap);
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap);
    }
    refrescarMacrosComidas(comidas, catalogoMap);
    return true;
  }

  if (errCarb > TOLERANCIA.carbohidratos) {
    const bloque = [...comidas].sort(
      (a, b) => num(a.macros_combo?.carbohidratos) - num(b.macros_combo?.carbohidratos)
    )[0];
    if (bloque) {
      const items = bloque.alimentos_sugeridos || [];
      const carbItem = itemMasCarb(items, catalogoMap, carbOpts);
      const boost = errCarb > 40 ? 1.15 : 1.1;
      if (carbItem) {
        const cat = catalogoMap.get(carbItem.id_alimento);
        carbItem.cantidad_sugerida = clampQtyAlimento(carbItem.cantidad_sugerida * boost, cat);
      } else {
        const filler = mejorRellenoCarb(catalogoMap, idsEnCombo(items), carbOpts);
        if (filler && items.length < 7) {
          items.push(
            itemDesdeCatalogo(
              filler,
              clampQtyAlimento(
                (errCarb / n / Math.max(densidad(filler, "carbohidratos"), 0.01)) * num(filler.porcion_base, 1) * 0.65,
                filler
              )
            )
          );
        }
      }
      bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap);
      refrescarMacrosComidas(comidas, catalogoMap);
      return true;
    }
  }

  if (errCarb < -TOLERANCIA.carbohidratos) {
    const bloque = [...comidas].sort(
      (a, b) => num(b.macros_combo?.carbohidratos) - num(a.macros_combo?.carbohidratos)
    )[0];
    if (bloque) {
      const carbItem = itemMasCarb(bloque.alimentos_sugeridos || [], catalogoMap, { modoLimpio: false });
      if (carbItem) {
        const cat = catalogoMap.get(carbItem.id_alimento);
        carbItem.cantidad_sugerida = clampQtyAlimento(carbItem.cantidad_sugerida * 0.9, cat);
        bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap);
        refrescarMacrosComidas(comidas, catalogoMap);
        return true;
      }
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
        const cat = catalogoMap.get(grasItem.id_alimento);
        grasItem.cantidad_sugerida = clampQtyAlimento(grasItem.cantidad_sugerida * 1.12, cat);
      } else {
        const filler = mejorRellenoGrasa(catalogoMap, idsEnCombo(items));
        if (filler && items.length < 7) {
          items.push(
            itemDesdeCatalogo(
              filler,
              clampQtyAlimento(
                (errGras / n / Math.max(densidad(filler, "grasas"), 0.01)) * num(filler.porcion_base, 1) * 0.65,
                filler
              )
            )
          );
        }
      }
      bloque.alimentos_sugeridos = reconstruirItems(items, catalogoMap);
      refrescarMacrosComidas(comidas, catalogoMap);
      return true;
    }
  }

  if (errGras < -TOLERANCIA.grasas) {
    let cambio = false;
    for (const bloque of comidas) {
      const peor = itemMasGraso(bloque.alimentos_sugeridos || [], catalogoMap);
      if (peor) {
        const cat = catalogoMap.get(peor.id_alimento);
        peor.cantidad_sugerida = clampQtyAlimento(peor.cantidad_sugerida * 0.88, cat);
        cambio = true;
      }
    }
    if (cambio) {
      refrescarMacrosComidas(comidas, catalogoMap);
      return true;
    }
  }

  if (Math.abs(errCal) > TOLERANCIA.calorias && total.calorias > 0) {
    const factor = factorEscalaCalorias(total, targetDia);
    for (const bloque of comidas) {
      escalarItems(bloque.alimentos_sugeridos || [], factor, catalogoMap);
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap);
    }
    refrescarMacrosComidas(comidas, catalogoMap);
    return true;
  }

  return false;
}

/** Fuerza topes por categoría en todos los ítems (post-escalado). */
function enforceLimitesFinales(comidas, catalogoMap) {
  for (const bloque of comidas) {
    bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos || [], catalogoMap);
  }
  refrescarMacrosComidas(comidas, catalogoMap);
}

/** Recorta suplementos/lácteos/frutos secos antes que carnes principales. */
function pasoRecortarProteinaExceso(comidas, catalogoMap, targetDia) {
  const total = totalDieta(comidas);
  const errProt = num(targetDia.proteinas) - total.proteinas;
  if (errProt >= -TOLERANCIA.proteinas) return false;

  let mejorItem = null;
  let mejorBloque = null;
  let mejorPri = -1;
  for (const bloque of comidas) {
    const item = itemMasProteinaParaRecorte(bloque.alimentos_sugeridos || [], catalogoMap);
    if (!item) continue;
    const cat = catalogoMap.get(item.id_alimento);
    const pri = prioridadRecorteProteina(cat);
    if (pri > mejorPri) {
      mejorPri = pri;
      mejorItem = item;
      mejorBloque = bloque;
    }
  }
  if (!mejorItem || !mejorBloque) return false;

  const cat = catalogoMap.get(mejorItem.id_alimento);
  const factor = errProt < -20 ? 0.8 : errProt < -12 ? 0.85 : 0.9;
  mejorItem.cantidad_sugerida = clampQtyAlimento(mejorItem.cantidad_sugerida * factor, cat);
  mejorBloque.alimentos_sugeridos = reconstruirItems(mejorBloque.alimentos_sugeridos, catalogoMap);
  refrescarMacrosComidas(comidas, catalogoMap);
  return true;
}

function optimizarDietaDia(dieta, catalogoMap, targetDia, options = {}) {
  if (!dieta?.comidas?.length || !targetDia) return dieta;

  enriquecerCatalogoMap(catalogoMap);
  dieta.comidas = dieta.comidas.map((bloque) => ({
    ...bloque,
    alimentos_sugeridos: reconstruirItems(bloque.alimentos_sugeridos || [], catalogoMap)
  }));
  refrescarMacrosComidas(dieta.comidas, catalogoMap);

  const totalInicial = totalDieta(dieta.comidas);
  if (num(targetDia.calorias) - totalInicial.calorias > 80 && totalInicial.calorias > 0) {
    const factor = factorEscalaCalorias(totalInicial, targetDia);
    for (const bloque of dieta.comidas) {
      escalarItems(bloque.alimentos_sugeridos || [], factor, catalogoMap);
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap);
    }
    refrescarMacrosComidas(dieta.comidas, catalogoMap);
  }

  for (let pass = 0; pass < MAX_PASADAS_DIA; pass++) {
    if (dentroTolerancia(totalDieta(dieta.comidas), targetDia)) break;
    if (!pasoAjusteDieta(dieta.comidas, catalogoMap, targetDia, options)) break;
  }

  for (let pass = 0; pass < 6; pass++) {
    const total = totalDieta(dieta.comidas);
    const errCal = num(targetDia.calorias) - total.calorias;
    if (Math.abs(errCal) <= TOLERANCIA.calorias) break;
    if (total.calorias <= 0) break;
    const factor = factorEscalaCalorias(total, targetDia);
    if (Math.abs(factor - 1) < 0.015) break;
    for (const bloque of dieta.comidas) {
      escalarItems(bloque.alimentos_sugeridos || [], factor, catalogoMap);
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap);
    }
    refrescarMacrosComidas(dieta.comidas, catalogoMap);
  }

  for (let pass = 0; pass < 8; pass++) {
    if (dentroTolerancia(totalDieta(dieta.comidas), targetDia)) break;
    if (!pasoAjusteDieta(dieta.comidas, catalogoMap, targetDia, options)) break;
  }

  const totalFinal = totalDieta(dieta.comidas);
  if (Math.abs(num(targetDia.calorias) - totalFinal.calorias) > 50 && totalFinal.calorias > 0) {
    const factor = factorEscalaCalorias(totalFinal, targetDia);
    for (const bloque of dieta.comidas) {
      escalarItems(bloque.alimentos_sugeridos || [], factor, catalogoMap);
      bloque.alimentos_sugeridos = reconstruirItems(bloque.alimentos_sugeridos, catalogoMap);
    }
    refrescarMacrosComidas(dieta.comidas, catalogoMap);
  }

  for (let pass = 0; pass < 20; pass++) {
    if (dentroTolerancia(totalDieta(dieta.comidas), targetDia)) break;
    if (!pasoAfinarMacrosDieta(dieta.comidas, catalogoMap, targetDia, options)) break;
  }

  enforceLimitesFinales(dieta.comidas, catalogoMap);

  for (let pass = 0; pass < 18; pass++) {
    const total = totalDieta(dieta.comidas);
    if (dentroTolerancia(total, targetDia)) break;
    const errProt = num(targetDia.proteinas) - total.proteinas;
    const errCarb = num(targetDia.carbohidratos) - total.carbohidratos;
    let cambio = false;
    if (errProt < -TOLERANCIA.proteinas && pasoRecortarProteinaExceso(dieta.comidas, catalogoMap, targetDia)) {
      cambio = true;
    } else if (errCarb > TOLERANCIA.carbohidratos && pasoRellenarCarbDieta(dieta.comidas, catalogoMap, targetDia, options)) {
      cambio = true;
    } else if (pasoAfinarMacrosDieta(dieta.comidas, catalogoMap, targetDia, options)) {
      cambio = true;
    }
    enforceLimitesFinales(dieta.comidas, catalogoMap);
    if (!cambio) break;
  }

  for (let pass = 0; pass < 6; pass++) {
    const total = totalDieta(dieta.comidas);
    const errCarb = num(targetDia.carbohidratos) - total.carbohidratos;
    const errCal = num(targetDia.calorias) - total.calorias;
    if (errCarb <= TOLERANCIA.carbohidratos) break;
    if (Math.abs(errCal) > 45) break;
    if (!pasoDistribuirCarbFinal(dieta.comidas, catalogoMap, targetDia, options)) break;
    enforceLimitesFinales(dieta.comidas, catalogoMap);
  }

  enforceLimitesFinales(dieta.comidas, catalogoMap);

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
