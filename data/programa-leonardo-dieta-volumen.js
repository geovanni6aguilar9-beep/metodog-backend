/**
 * Plan nutricional actual de Leonardo — superávit / volumen (mayo 2026).
 * Pollo, carne molida, scoop de proteína. No confundir con PLAN_NUTRICION (PDF viejo).
 * sodio (mg) por ítem = total de la porción indicada (suma por comida según plan coach).
 */

const PLAN_NUTRICION_VOLUMEN = {
  _meta: {
    calorias_objetivo: 3061,
    proteina_objetivo: 142,
    carbos_objetivo: 434,
    grasas_objetivo: 88,
    sodio_objetivo: 75,
    tipo_ajuste: "sumar",
    ajuste_kcal: 400,
    etiqueta: "Superávit alto — volumen / ganancia de masa",
    notas_dieta:
      "🔥 KEY POINTS:\n1. Hidratación y Sodio (Pump): Toma 3 a 4 litros de agua natural al día. Agrega sal al gusto (especialmente en la papa y arroz post-entreno) para mejorar el bompeo.\n2. Combustible: Dieta alta en carbohidratos (~434g). Úsalos para entrenar muy pesado.\n3. Pesaje: Pechuga de pollo y carne molida EN CRUDO. Arroz, lentejas y papa YA COCIDOS.\n4. Proteína: Scoop de proteína en Comida 2; pollo y carne molida en Comida 4.\n5. Vegetales: Lechuga y verdes libres. Papa y zanahoria según plan.\n6. Bebidas: 1–2 tazas de café o Zero; no reemplazan el agua."
  },
  desayuno: [
    { nombre: "Huevo entero", cantidad: 2, unidad: "piezas", kcal: 140, prot: 12, carb: 0, grasas: 10, sodio: 0 },
    { nombre: "Plátano", cantidad: 160, unidad: "g", kcal: 144, prot: 1.6, carb: 36.8, grasas: 0, sodio: 0 },
    { nombre: "Avena", cantidad: 30, unidad: "g", kcal: 117, prot: 5.1, carb: 20, grasas: 2.1, sodio: 0 },
    { nombre: "Papaya", cantidad: 140, unidad: "g", kcal: 56, prot: 1.9, carb: 14, grasas: 0, sodio: 0 },
    { nombre: "Miel de abeja", cantidad: 50, unidad: "g", kcal: 152, prot: 0, carb: 41.2, grasas: 0, sodio: 0 }
  ],
  comida_2: [
    { nombre: "Leche deslactosada", cantidad: 250, unidad: "ml", kcal: 115, prot: 8, carb: 12, grasas: 4, sodio: 7 },
    { nombre: "Avena", cantidad: 30, unidad: "g", kcal: 117, prot: 5.1, carb: 20, grasas: 2.1, sodio: 0 },
    { nombre: "Plátano", cantidad: 80, unidad: "g", kcal: 72, prot: 0.8, carb: 18.4, grasas: 0, sodio: 0 },
    { nombre: "Creatina Monohidratada", cantidad: 5, unidad: "g", kcal: 0, prot: 0, carb: 0, grasas: 0, sodio: 0 },
    { nombre: "Papa cocida", cantidad: 150, unidad: "g", kcal: 116, prot: 3, carb: 26.3, grasas: 0, sodio: 0 },
    { nombre: "Arroz blanco cocido", cantidad: 120, unidad: "g", kcal: 156, prot: 3, carb: 34.8, grasas: 0.4, sodio: 0 },
    { nombre: "Tortilla de maíz", cantidad: 4, unidad: "piezas", kcal: 208, prot: 4, carb: 44, grasas: 3, sodio: 0 },
    { nombre: "Scoop de proteína", cantidad: 20, unidad: "g", kcal: 80, prot: 20, carb: 0, grasas: 0, sodio: 0 },
    { nombre: "Lechuga", cantidad: 100, unidad: "g", kcal: 14, prot: 1, carb: 2.5, grasas: 0, sodio: 0 }
  ],
  comida_3: [
    { nombre: "Yogur Griego Natural s/azúcar", cantidad: 150, unidad: "g", kcal: 109, prot: 10.6, carb: 10.2, grasas: 2.5, sodio: 0 },
    { nombre: "Manzana", cantidad: 80, unidad: "g", kcal: 42, prot: 1.6, carb: 11.2, grasas: 0, sodio: 0 },
    { nombre: "Almendras", cantidad: 20, unidad: "g", kcal: 115, prot: 4.3, carb: 10.1, grasas: 3.9, sodio: 0 },
    { nombre: "Melón", cantidad: 200, unidad: "g", kcal: 68, prot: 0, carb: 16.4, grasas: 0, sodio: 0 }
  ],
  comida_4: [
    { nombre: "Pechuga de Pollo (cruda)", cantidad: 100, unidad: "g", kcal: 132, prot: 24.8, carb: 0, grasas: 2.8, sodio: 28 },
    { nombre: "Lentejas cocidas", cantidad: 80, unidad: "g", kcal: 96, prot: 7.2, carb: 16, grasas: 0.3, sodio: 5 },
    { nombre: "Aceite de oliva", cantidad: 10, unidad: "ml", kcal: 80, prot: 0, carb: 0, grasas: 9.3, sodio: 0 },
    { nombre: "Queso Fresco", cantidad: 31, unidad: "g", kcal: 45, prot: 3.7, carb: 1.6, grasas: 2.5, sodio: 12 },
    { nombre: "Tortilla de maíz", cantidad: 4, unidad: "piezas", kcal: 208, prot: 4, carb: 44, grasas: 3, sodio: 12 },
    { nombre: "Manzana", cantidad: 80, unidad: "g", kcal: 42, prot: 1.6, carb: 11.2, grasas: 0, sodio: 0 },
    { nombre: "Carne molida", cantidad: 100, unidad: "g", kcal: 220, prot: 18, carb: 0, grasas: 15, sodio: 10 },
    { nombre: "Lechuga", cantidad: 100, unidad: "g", kcal: 14, prot: 1, carb: 2.5, grasas: 0, sodio: 0 }
  ],
  comida_5: [
    { nombre: "Melón", cantidad: 220, unidad: "g", kcal: 75, prot: 0, carb: 18, grasas: 0, sodio: 0 },
    { nombre: "Aceite de coco + miel", cantidad: 55, unidad: "g", kcal: 329, prot: 0, carb: 22.6, grasas: 27.5, sodio: 1 }
  ]
};

module.exports = { PLAN_NUTRICION_VOLUMEN };
