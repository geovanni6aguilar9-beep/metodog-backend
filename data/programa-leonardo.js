/**
 * Plan nutrición + rutina — Leonardo (cliente coach).
 * Fuente: PDFs Plan Alimenticio (06-05-26) y Rutina (11-05-26).
 */

const PLAN_NUTRICION = {
  _meta: {
    calorias_objetivo: 2668,
    proteina_objetivo: 111.3,
    carbos_objetivo: 392.6,
    grasas_objetivo: 64.5,
    sodio_objetivo: 805,
    notas_dieta:
      "🔥 KEY POINTS:\n1. Hidratación y Sodio (Pump): Toma 3 a 4 litros de agua natural al día. Agrega sal al gusto (especialmente en la papa y arroz post-entreno) para mejorar el bombeo.\n2. Combustible: Tu dieta es alta en carbohidratos (~400g). Úsalos a tu favor para entrenar muy pesado.\n3. Pesaje: La pechuga de pollo se pesa EN CRUDO. El arroz, lentejas y papa se pesan YA COCIDOS.\n4. Vegetales: Come vegetales verdes libremente (lechuga, espinaca). La papa y zanahoria de tu plan NO son libres.\n5. Bebidas: 1 a 2 tazas de café o bebidas Zero permitidas, pero no reemplazan tu agua."
  },
  desayuno: [
    { nombre: "Huevo entero", cantidad: 3, unidad: "piezas", kcal: 210, prot: 18, carb: 0, grasas: 15 },
    { nombre: "Plátano", cantidad: 180, unidad: "g", kcal: 162, prot: 1.8, carb: 41.4, grasas: 0 },
    { nombre: "Avena", cantidad: 40, unidad: "g", kcal: 156, prot: 6.8, carb: 26.6, grasas: 2.8 },
    { nombre: "Papaya", cantidad: 150, unidad: "g", kcal: 60, prot: 2, carb: 15, grasas: 0 },
    { nombre: "Miel de abeja", cantidad: 50, unidad: "g", kcal: 152, prot: 0, carb: 41.2, grasas: 0 }
  ],
  comida_2: [
    { nombre: "Leche deslactosada", cantidad: 250, unidad: "ml", kcal: 115, prot: 8, carb: 12, grasas: 4 },
    { nombre: "Avena", cantidad: 40, unidad: "g", kcal: 156, prot: 6.8, carb: 26.6, grasas: 2.8 },
    { nombre: "Plátano", cantidad: 80, unidad: "g", kcal: 72, prot: 0.8, carb: 18.4, grasas: 0 },
    { nombre: "Creatina Monohidratada", cantidad: 5, unidad: "g", kcal: 0, prot: 0, carb: 0, grasas: 0 },
    { nombre: "Papa cocida", cantidad: 120, unidad: "g", kcal: 92.4, prot: 2.4, carb: 21, grasas: 0 },
    { nombre: "Arroz blanco cocido", cantidad: 100, unidad: "g", kcal: 130, prot: 2.5, carb: 29, grasas: 0.3 },
    { nombre: "Tortilla de maíz", cantidad: 2, unidad: "piezas", kcal: 104, prot: 2, carb: 22, grasas: 1.5 },
    { nombre: "Zanahoria", cantidad: 50, unidad: "g", kcal: 21, prot: 1.5, carb: 4.8, grasas: 0 }
  ],
  comida_3: [
    { nombre: "Yogur Griego Natural s/azúcar", cantidad: 150, unidad: "g", kcal: 109, prot: 10.6, carb: 10.2, grasas: 2.5 },
    { nombre: "Manzana", cantidad: 100, unidad: "g", kcal: 52, prot: 2, carb: 14, grasas: 0 },
    { nombre: "Almendras", cantidad: 30, unidad: "g", kcal: 174, prot: 6.4, carb: 6.5, grasas: 15 },
    { nombre: "Melón", cantidad: 200, unidad: "g", kcal: 68, prot: 0, carb: 16.4, grasas: 0 }
  ],
  comida_4: [
    { nombre: "Pechuga de Pollo (cruda)", cantidad: 100, unidad: "g", kcal: 132, prot: 24.8, carb: 0, grasas: 2.8 },
    { nombre: "Lentejas cocidas", cantidad: 100, unidad: "g", kcal: 120, prot: 9, carb: 20, grasas: 0.4 },
    { nombre: "Aguacate", cantidad: 40, unidad: "g", kcal: 64, prot: 0.8, carb: 3.2, grasas: 6 },
    { nombre: "Aceite de oliva", cantidad: 15, unidad: "ml", kcal: 120, prot: 0, carb: 0, grasas: 14 },
    { nombre: "Queso Fresco", cantidad: 50, unidad: "g", kcal: 72.5, prot: 6, carb: 2.5, grasas: 4.1 },
    { nombre: "Tortilla de maíz", cantidad: 4, unidad: "piezas", kcal: 208, prot: 4, carb: 44, grasas: 3 },
    { nombre: "Manzana", cantidad: 80, unidad: "g", kcal: 41.6, prot: 1.6, carb: 11.2, grasas: 0 }
  ],
  comida_5: [
    { nombre: "Gelatina sin azúcar", cantidad: 1, unidad: "porción", kcal: 10, prot: 2, carb: 0, grasas: 0 },
    { nombre: "Melón", cantidad: 200, unidad: "g", kcal: 68, prot: 0, carb: 16.4, grasas: 0 }
  ]
};

const PLAN_RUTINA = {
  _meta: {
    nombre_rutina: "Programa de Fuerza e Hipertrofia (Leo)",
    notas_programa:
      "Semana estructurada de 5 días. Prioriza la técnica y registra tus pesos exactos para asegurar la sobrecarga progresiva. Descansos sugeridos: 90s-120s en compuestos, 60s-90s en accesorios."
  },
  lunes: [
    { musculo: "Hombro", nombre: "Press Militar con Mancuernas", series: 4, reps: "10-15", rir: "2" },
    { musculo: "Hombro", nombre: "Laterales Sentado", series: 4, reps: "8-12", rir: "1-2" },
    { musculo: "Espalda", nombre: "Pull Down Agarre Neutro", series: 3, reps: "10-15", rir: "2" },
    { musculo: "Espalda", nombre: "Remo Unilateral", series: 3, reps: "12", rir: "2" },
    { musculo: "Espalda", nombre: "Pull Over con Barra", series: 3, reps: "12", rir: "2" },
    { musculo: "Bíceps", nombre: "Curl Bayesian", series: 3, reps: "10-15", rir: "2" },
    { musculo: "Bíceps", nombre: "Curl Inclinado con Mancuerna", series: 3, reps: "8-12", rir: "1-2" }
  ],
  martes: [
    { musculo: "Cuádriceps", nombre: "Sentadilla Hack", series: 4, reps: "10-15", rir: "1-2" },
    { musculo: "Cuádriceps", nombre: "Desplantes con Barra", series: 4, reps: "15-20", rir: "2" },
    { musculo: "Cuádriceps", nombre: "Extensión de Cuádriceps", series: 3, reps: "12", rir: "1-2" },
    { musculo: "Aductores", nombre: "Aducción en Máquina", series: 3, reps: "15", rir: "1-2" },
    { musculo: "Glúteo", nombre: "Patada de Glúteo en Máquina", series: 2, reps: "15", rir: "1-2" },
    { musculo: "Isquiosurales", nombre: "Femoral Sentado", series: 3, reps: "12", rir: "1-2" },
    { musculo: "Pantorrilla", nombre: "Pantorrilla con Mancuerna (Unilateral)", series: 3, reps: "12", rir: "1-2" }
  ],
  miercoles: [
    { musculo: "Hombro", nombre: "Press Militar en Máquina", series: 3, reps: "8-12", rir: "2" },
    { musculo: "Hombro", nombre: "Laterales con Mancuerna", series: 3, reps: "8-12", rir: "1-2" },
    { musculo: "Pectoral", nombre: "Pec Deck", series: 4, reps: "12", rir: "2" },
    { musculo: "Pectoral", nombre: "Cruce de Poleas", series: 4, reps: "8-12", rir: "2" },
    { musculo: "Pectoral", nombre: "Press Inclinado con Mancuernas", series: 4, reps: "10-15", rir: "2" },
    { musculo: "Tríceps", nombre: "Fondos para Tríceps", series: 3, reps: "8-12", rir: "1-2" },
    { musculo: "Tríceps", nombre: "Extensiones con Barra", series: 3, reps: "10-15", rir: "1-2" },
    { musculo: "Tríceps", nombre: "Lagartijas Diamante", series: 3, reps: "8-12", rir: "1-2" }
  ],
  jueves: [
    { musculo: "Cuádriceps", nombre: "Sentadilla Hack", series: 3, reps: "10-15", rir: "0-2" },
    { musculo: "Cuádriceps", nombre: "Extensión de Cuádriceps", series: 3, reps: "10-15", rir: "0-2" },
    { musculo: "Isquiosurales", nombre: "Femoral Sentado", series: 3, reps: "10-15", rir: "0-2" },
    { musculo: "Glúteo", nombre: "Hip Thrust", series: 3, reps: "10-15", rir: "1-2" },
    { musculo: "Glúteo", nombre: "Abducción en Máquina", series: 3, reps: "15-20", rir: "1-2" },
    { musculo: "Cuádriceps", nombre: "Sentadilla Búlgara", series: 3, reps: "8-12", rir: "1-2" },
    { musculo: "Aductores", nombre: "Costurera", series: 3, reps: "10-15", rir: "1-2" },
    { musculo: "Pantorrilla", nombre: "Pantorrilla en Prensa", series: 3, reps: "10-15", rir: "1-2" }
  ],
  viernes: [
    { musculo: "Hombro post", nombre: "Pec Deck Invertido", series: 3, reps: "10-15", rir: "1-2" },
    { musculo: "Hombro", nombre: "Laterales con Mancuerna", series: 3, reps: "8-12", rir: "2" },
    { musculo: "Pectoral", nombre: "Press Inclinado con Mancuernas", series: 3, reps: "10-15", rir: "2" },
    { musculo: "Espalda", nombre: "Dominadas con Agarre Abierto", series: 3, reps: "8-12", rir: "1-2" },
    { musculo: "Bíceps", nombre: "Curl con Barra Z", series: 3, reps: "8-12", rir: "1-2" },
    { musculo: "Tríceps", nombre: "Fondos para Tríceps", series: 3, reps: "8-12", rir: "1-2" }
  ]
};

const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const MAP_DIAS_RUTINA = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes"
};

const COMIDAS_ORDEN = [
  { key: "desayuno", nombre: "Desayuno" },
  { key: "comida_2", nombre: "Comida 2" },
  { key: "comida_3", nombre: "Comida 3" },
  { key: "comida_4", nombre: "Comida 4" },
  { key: "comida_5", nombre: "Comida 5" }
];

function buildAlimentoDesdeSeed(item, idUnico) {
  const cant = parseFloat(item.cantidad) || 1;
  return {
    id: `leo-${idUnico}`,
    idUnico,
    nombre: item.nombre,
    grupo: "Plan Leo",
    porcion_base: cant,
    unidad: item.unidad || "g",
    calorias: item.kcal || 0,
    proteinas: item.prot || 0,
    carbohidratos: item.carb || 0,
    grasas: item.grasas || 0,
    sodio: item.sodio || 0,
    cantidadSeleccionada: cant
  };
}

function sumarConsumido(comidas) {
  const t = { cal: 0, prot: 0, carb: 0, gras: 0, sod: 0 };
  for (const comida of comidas || []) {
    for (const a of comida.alimentos || []) {
      const f = (parseFloat(a.cantidadSeleccionada) || 0) / (parseFloat(a.porcion_base) || 1);
      t.cal += (parseFloat(a.calorias) || 0) * f;
      t.prot += (parseFloat(a.proteinas) || 0) * f;
      t.carb += (parseFloat(a.carbohidratos) || 0) * f;
      t.gras += (parseFloat(a.grasas) || 0) * f;
      t.sod += (parseFloat(a.sodio) || 0) * f;
    }
  }
  return t;
}

function buildDietaPayload(plan = PLAN_NUTRICION) {
  let uid = 1;
  const comidas = COMIDAS_ORDEN.map((bloque, idx) => ({
    id: idx + 1,
    nombre: bloque.nombre,
    alimentos: (plan[bloque.key] || []).map((item) => {
      const alimento = buildAlimentoDesdeSeed(item, uid);
      uid += 1;
      return alimento;
    })
  }));

  const meta = plan._meta || {};
  const consumido = sumarConsumido(comidas);

  const objetivos = {
    cal: meta.calorias_objetivo,
    prot: meta.proteina_objetivo,
    carb: meta.carbos_objetivo,
    gras: meta.grasas_objetivo,
    sodio: meta.sodio_objetivo
  };
  if (meta.tipo_ajuste) objetivos.tipo_ajuste = meta.tipo_ajuste;
  if (meta.ajuste_kcal != null) objetivos.ajuste_kcal = meta.ajuste_kcal;
  if (meta.etiqueta) objetivos.etiqueta = meta.etiqueta;

  return {
    datos_dieta: comidas,
    macros_totales: { objetivos, consumido },
    notas_dieta: meta.notas_dieta || ""
  };
}

function buildEjercicioDesdeSeed(ej, id) {
  const numSets = Math.max(1, parseInt(ej.series, 10) || 3);
  const reps = String(ej.reps || "10-15");
  const sets = [];
  for (let i = 0; i < numSets; i++) {
    sets.push({ kg: "", peso: "", reps, completado: false });
  }
  return {
    id,
    grupo: ej.musculo || "",
    nombre: ej.nombre || "Ejercicio",
    nota: "",
    link: "",
    series: String(numSets),
    reps,
    rir: String(ej.rir ?? "2"),
    peso: "",
    bloque: null,
    colorId: null,
    sets
  };
}

function buildRutinaPayload(plan = PLAN_RUTINA) {
  const datos_rutina = {};
  const notas_generales = {};
  let ejId = 1;

  for (const dia of DIAS_SEMANA) {
    datos_rutina[dia] = [];
    notas_generales[dia] = "";
  }

  for (const [key, diaNombre] of Object.entries(MAP_DIAS_RUTINA)) {
    datos_rutina[diaNombre] = (plan[key] || []).map((ej) => {
      const built = buildEjercicioDesdeSeed(ej, ejId);
      ejId += 1;
      return built;
    });
    notas_generales[diaNombre] = `🏋️ ${diaNombre} — ${plan._meta?.nombre_rutina || "Programa Leo"}`;
  }

  notas_generales.Lunes = [
    `📋 ${plan._meta?.nombre_rutina || "Programa Leo"}`,
    plan._meta?.notas_programa || "",
    "",
    notas_generales.Lunes
  ].join("\n");

  datos_rutina._meta = {
    nombre_rutina: plan._meta?.nombre_rutina || "Programa Leo",
    notas_programa: plan._meta?.notas_programa || "",
    preguntas_checkin: [],
    checkin_respuestas: []
  };

  return { datos_rutina, notas_generales };
}

module.exports = {
  PLAN_NUTRICION,
  PLAN_RUTINA,
  buildDietaPayload,
  buildRutinaPayload
};
