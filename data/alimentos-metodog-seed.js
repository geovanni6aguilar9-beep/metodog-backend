/**
 * Biblioteca MétodoG — macros por porcion_base + unidad (igual que tabla Turso).
 * grupo = UI coach · grupo_equivalencia = motor de sustitutos
 */

const ALIMENTOS_METODOG = [
  // —— Proteína magra ——
  { nombre: "Pechuga de Pollo", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 165, proteinas: 31, carbohidratos: 0, grasas: 3.6, sodio: 74 },
  { nombre: "Atún en Agua", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 116, proteinas: 26, carbohidratos: 0, grasas: 1, sodio: 338 },
  { nombre: "Carne de Res Magra", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 250, proteinas: 26, carbohidratos: 0, grasas: 15, sodio: 72 },
  { nombre: "Pechuga de Pavo", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 114, proteinas: 24, carbohidratos: 0, grasas: 1.5, sodio: 115 },
  { nombre: "Pescado Tilapia", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 96, proteinas: 20, carbohidratos: 0, grasas: 1.7, sodio: 52 },
  { nombre: "Camarón", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 85, proteinas: 20, carbohidratos: 0, grasas: 0.5, sodio: 119 },
  { nombre: "Claras de Huevo", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 48, proteinas: 11, carbohidratos: 0.7, grasas: 0.2, sodio: 166 },
  { nombre: "Queso Cottage Bajo Grasa", grupo: "Lácteos", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 72, proteinas: 12, carbohidratos: 3, grasas: 1, sodio: 321 },
  { nombre: "Scoop Proteína Whey", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 30, unidad: "g", calorias: 111, proteinas: 25, carbohidratos: 1, grasas: 0.5, sodio: 45 },
  { nombre: "Jamón de Pavo", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 105, proteinas: 18, carbohidratos: 2, grasas: 3, sodio: 900 },

  // —— Proteína con más grasa ——
  { nombre: "Huevo Entero", grupo: "Carnes", grupo_equivalencia: "proteina_grasa", porcion_base: 1, unidad: "pieza", calorias: 70, proteinas: 6, carbohidratos: 0, grasas: 5, sodio: 65 },
  { nombre: "Carne Molida 90/10", grupo: "Carnes", grupo_equivalencia: "proteina_grasa", porcion_base: 100, unidad: "g", calorias: 176, proteinas: 20, carbohidratos: 0, grasas: 10, sodio: 66 },
  { nombre: "Carne Molida 80/20", grupo: "Carnes", grupo_equivalencia: "proteina_grasa", porcion_base: 100, unidad: "g", calorias: 254, proteinas: 17, carbohidratos: 0, grasas: 20, sodio: 81 },
  { nombre: "Salmón", grupo: "Carnes", grupo_equivalencia: "proteina_grasa", porcion_base: 100, unidad: "g", calorias: 208, proteinas: 20, carbohidratos: 0, grasas: 13, sodio: 59 },
  { nombre: "Queso Panela", grupo: "Lácteos", grupo_equivalencia: "proteina_grasa", porcion_base: 100, unidad: "g", calorias: 284, proteinas: 17, carbohidratos: 3, grasas: 22, sodio: 600 },
  { nombre: "Muslo de Pollo sin Piel", grupo: "Carnes", grupo_equivalencia: "proteina_grasa", porcion_base: 100, unidad: "g", calorias: 175, proteinas: 17, carbohidratos: 0, grasas: 12, sodio: 76 },

  // —— Carbohidratos complejos ——
  { nombre: "Arroz Blanco Cocido", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 130, proteinas: 2.7, carbohidratos: 28, grasas: 0.3, sodio: 1 },
  { nombre: "Arroz Integral Cocido", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 112, proteinas: 2.6, carbohidratos: 24, grasas: 0.9, sodio: 5 },
  { nombre: "Avena en Hojuelas", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 40, unidad: "g", calorias: 154, proteinas: 5, carbohidratos: 27, grasas: 3, sodio: 2 },
  { nombre: "Tortilla de Maíz", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 1, unidad: "pieza", calorias: 52, proteinas: 1.4, carbohidratos: 11, grasas: 0.5, sodio: 11 },
  { nombre: "Papa Cocida", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 87, proteinas: 1.9, carbohidratos: 20, grasas: 0.1, sodio: 5 },
  { nombre: "Camote Cocido", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 90, proteinas: 2, carbohidratos: 21, grasas: 0.2, sodio: 36 },
  { nombre: "Pasta de Trigo Cocida", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 157, proteinas: 5.8, carbohidratos: 31, grasas: 0.9, sodio: 1 },
  { nombre: "Pan Integral", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 1, unidad: "pieza", calorias: 74, proteinas: 3.5, carbohidratos: 13, grasas: 1.2, sodio: 140 },
  { nombre: "Quinoa Cocida", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 120, proteinas: 4.4, carbohidratos: 21, grasas: 1.9, sodio: 7 },
  { nombre: "Harina de Avena", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 30, unidad: "g", calorias: 117, proteinas: 4, carbohidratos: 20, grasas: 2, sodio: 2 },

  // —— Legumbres ——
  { nombre: "Lentejas Cocidas", grupo: "Leguminosas", grupo_equivalencia: "legumbre", porcion_base: 100, unidad: "g", calorias: 116, proteinas: 9, carbohidratos: 20, grasas: 0.4, sodio: 2 },
  { nombre: "Frijoles Cocidos", grupo: "Leguminosas", grupo_equivalencia: "legumbre", porcion_base: 100, unidad: "g", calorias: 130, proteinas: 8.8, carbohidratos: 23, grasas: 0.5, sodio: 2 },
  { nombre: "Frijol Negro Cocido", grupo: "Leguminosas", grupo_equivalencia: "legumbre", porcion_base: 100, unidad: "g", calorias: 132, proteinas: 8.9, carbohidratos: 24, grasas: 0.5, sodio: 2 },
  { nombre: "Garbanzo Cocido", grupo: "Leguminosas", grupo_equivalencia: "legumbre", porcion_base: 100, unidad: "g", calorias: 164, proteinas: 8.9, carbohidratos: 27, grasas: 2.6, sodio: 7 },

  // —— Frutas ——
  { nombre: "Plátano", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 89, proteinas: 1.1, carbohidratos: 23, grasas: 0.3, sodio: 1 },
  { nombre: "Manzana", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 52, proteinas: 0.3, carbohidratos: 14, grasas: 0.2, sodio: 1 },
  { nombre: "Papaya", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 43, proteinas: 0.5, carbohidratos: 11, grasas: 0.3, sodio: 8 },
  { nombre: "Fresas", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 32, proteinas: 0.7, carbohidratos: 8, grasas: 0.3, sodio: 1 },
  { nombre: "Arándanos", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 57, proteinas: 0.7, carbohidratos: 14, grasas: 0.3, sodio: 1 },
  { nombre: "Mango", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 60, proteinas: 0.8, carbohidratos: 15, grasas: 0.4, sodio: 1 },
  { nombre: "Sandía", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 30, proteinas: 0.6, carbohidratos: 8, grasas: 0.2, sodio: 1 },
  { nombre: "Uvas", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 69, proteinas: 0.7, carbohidratos: 18, grasas: 0.2, sodio: 2 },

  // —— Grasas ——
  { nombre: "Aguacate", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 50, unidad: "g", calorias: 80, proteinas: 1, carbohidratos: 4, grasas: 7.5, sodio: 7 },
  { nombre: "Aceite de Oliva", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 1, unidad: "cucharada", calorias: 119, proteinas: 0, carbohidratos: 0, grasas: 13.5, sodio: 0 },
  { nombre: "Almendras", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 30, unidad: "g", calorias: 173, proteinas: 6, carbohidratos: 6, grasas: 15, sodio: 0 },
  { nombre: "Nueces", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 30, unidad: "g", calorias: 196, proteinas: 4.6, carbohidratos: 4, grasas: 19.5, sodio: 1 },
  { nombre: "Cacahuates", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 30, unidad: "g", calorias: 176, proteinas: 7, carbohidratos: 6, grasas: 15, sodio: 2 },
  { nombre: "Crema de Cacahuate Natural", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 15, unidad: "g", calorias: 88, proteinas: 4, carbohidratos: 3, grasas: 7.5, sodio: 3 },
  { nombre: "Aceite de Coco", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 10, unidad: "g", calorias: 89, proteinas: 0, carbohidratos: 0, grasas: 10, sodio: 0 },

  // —— Lácteos ——
  { nombre: "Leche Entera", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 250, unidad: "ml", calorias: 150, proteinas: 8, carbohidratos: 12, grasas: 8, sodio: 105 },
  { nombre: "Leche Deslactosada Light", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 250, unidad: "ml", calorias: 108, proteinas: 8, carbohidratos: 12, grasas: 2.5, sodio: 113 },
  { nombre: "Yogur Griego Sin Azúcar", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 200, unidad: "g", calorias: 120, proteinas: 20, carbohidratos: 8, grasas: 0, sodio: 70 },
  { nombre: "Kefir Natural", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 250, unidad: "ml", calorias: 103, proteinas: 8.5, carbohidratos: 10, grasas: 2.5, sodio: 100 },

  // —— Verduras (bajo impacto; sustituto opcional entre ellas) ——
  { nombre: "Brócoli Cocido", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 35, proteinas: 2.4, carbohidratos: 7, grasas: 0.4, sodio: 41 },
  { nombre: "Espinaca Cruda", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 23, proteinas: 2.9, carbohidratos: 4, grasas: 0.4, sodio: 79 },
  { nombre: "Jitomate", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 18, proteinas: 0.9, carbohidratos: 4, grasas: 0.2, sodio: 5 },
  { nombre: "Pepino", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 15, proteinas: 0.7, carbohidratos: 4, grasas: 0.1, sodio: 2 },
  { nombre: "Lechuga", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 15, proteinas: 1.4, carbohidratos: 3, grasas: 0.2, sodio: 28 },

  // —— Otros ——
  { nombre: "Miel de Abeja", grupo: "Otros", grupo_equivalencia: "azucar", porcion_base: 15, unidad: "g", calorias: 46, proteinas: 0, carbohidratos: 12, grasas: 0, sodio: 1 },
  { nombre: "Gelatina Sin Azúcar", grupo: "Otros", grupo_equivalencia: "libre", porcion_base: 100, unidad: "g", calorias: 10, proteinas: 2, carbohidratos: 0, grasas: 0, sodio: 9 },
  { nombre: "Salsa de Tomate", grupo: "Otros", grupo_equivalencia: "condimento", porcion_base: 100, unidad: "g", calorias: 29, proteinas: 1.3, carbohidratos: 7, grasas: 0.2, sodio: 384 }
];

module.exports = { ALIMENTOS_METODOG };
