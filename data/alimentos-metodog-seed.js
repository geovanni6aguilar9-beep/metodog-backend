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
  { nombre: "Salsa de Tomate", grupo: "Otros", grupo_equivalencia: "condimento", porcion_base: 100, unidad: "g", calorias: 29, proteinas: 1.3, carbohidratos: 7, grasas: 0.2, sodio: 384 },

  // —— Proteína magra (ampliado) ——
  { nombre: "Bacalao", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 82, proteinas: 18, carbohidratos: 0, grasas: 0.7, sodio: 54 },
  { nombre: "Merluza", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 71, proteinas: 16, carbohidratos: 0, grasas: 0.6, sodio: 68 },
  { nombre: "Trucha", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 141, proteinas: 20, carbohidratos: 0, grasas: 6, sodio: 52 },
  { nombre: "Sardina en Agua", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 142, proteinas: 21, carbohidratos: 0, grasas: 6, sodio: 320 },
  { nombre: "Surimi", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 99, proteinas: 15, carbohidratos: 7, grasas: 0.9, sodio: 450 },
  { nombre: "Tofu Firme", grupo: "Leguminosas", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 76, proteinas: 8, carbohidratos: 2, grasas: 4.8, sodio: 7 },
  { nombre: "Tempeh", grupo: "Leguminosas", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 192, proteinas: 20, carbohidratos: 8, grasas: 11, sodio: 9 },
  { nombre: "Edamame Cocido", grupo: "Leguminosas", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 121, proteinas: 11, carbohidratos: 9, grasas: 5, sodio: 6 },
  { nombre: "Proteína Vegetal en Polvo", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 30, unidad: "g", calorias: 108, proteinas: 22, carbohidratos: 2, grasas: 1, sodio: 280 },
  { nombre: "Requesón Bajo Grasa", grupo: "Lácteos", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 72, proteinas: 12, carbohidratos: 3, grasas: 0.5, sodio: 380 },
  { nombre: "Queso Ricotta Light", grupo: "Lácteos", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 138, proteinas: 11, carbohidratos: 5, grasas: 8, sodio: 120 },
  { nombre: "Arrachera Magra", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 201, proteinas: 27, carbohidratos: 0, grasas: 10, sodio: 65 },

  // —— Proteína / grasa (ampliado) ——
  { nombre: "Queso Oaxaca Light", grupo: "Lácteos", grupo_equivalencia: "proteina_grasa", porcion_base: 30, unidad: "g", calorias: 90, proteinas: 6, carbohidratos: 1, grasas: 7, sodio: 180 },
  { nombre: "Caballa en Lata", grupo: "Carnes", grupo_equivalencia: "proteina_grasa", porcion_base: 100, unidad: "g", calorias: 205, proteinas: 19, carbohidratos: 0, grasas: 14, sodio: 280 },

  // —— Carbohidratos (ampliado) ——
  { nombre: "Granola Natural", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 40, unidad: "g", calorias: 180, proteinas: 5, carbohidratos: 28, grasas: 6, sodio: 45 },
  { nombre: "Galletas de Arroz", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 2, unidad: "pieza", calorias: 70, proteinas: 1.4, carbohidratos: 15, grasas: 0.5, sodio: 25 },
  { nombre: "Tostadas Horneadas", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 1, unidad: "pieza", calorias: 55, proteinas: 1.5, carbohidratos: 11, grasas: 0.8, sodio: 85 },
  { nombre: "Elote Desgranado", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 96, proteinas: 3.4, carbohidratos: 21, grasas: 1.5, sodio: 15 },
  { nombre: "Amaranto Natural", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 30, unidad: "g", calorias: 111, proteinas: 4, carbohidratos: 19, grasas: 2, sodio: 5 },
  { nombre: "Cuscús Cocido", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 112, proteinas: 3.8, carbohidratos: 23, grasas: 0.2, sodio: 5 },
  { nombre: "Pan de Pita Integral", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 1, unidad: "pieza", calorias: 165, proteinas: 6, carbohidratos: 33, grasas: 1.5, sodio: 320 },
  { nombre: "Bagel Integral", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 1, unidad: "pieza", calorias: 250, proteinas: 10, carbohidratos: 48, grasas: 2, sodio: 430 },
  { nombre: "Cereal Integral Sin Azúcar", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 40, unidad: "g", calorias: 145, proteinas: 4, carbohidratos: 32, grasas: 1, sodio: 180 },
  { nombre: "Galletas María", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 5, unidad: "pieza", calorias: 115, proteinas: 2, carbohidratos: 20, grasas: 3, sodio: 200 },
  { nombre: "Palomitas Naturales", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 30, unidad: "g", calorias: 115, proteinas: 3, carbohidratos: 23, grasas: 1.5, sodio: 2 },
  { nombre: "Bulgur Cocido", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 83, proteinas: 3, carbohidratos: 19, grasas: 0.2, sodio: 5 },
  { nombre: "Tapioca Cocida", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 100, unidad: "g", calorias: 130, proteinas: 0.2, carbohidratos: 32, grasas: 0, sodio: 2 },
  { nombre: "Pan Blanco", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 1, unidad: "pieza", calorias: 79, proteinas: 2.7, carbohidratos: 15, grasas: 1, sodio: 130 },
  { nombre: "Tortilla de Harina Integral", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 1, unidad: "pieza", calorias: 104, proteinas: 3, carbohidratos: 17, grasas: 2.5, sodio: 220 },

  // —— Legumbres / semillas ——
  { nombre: "Hummus Natural", grupo: "Leguminosas", grupo_equivalencia: "legumbre", porcion_base: 50, unidad: "g", calorias: 82, proteinas: 4, carbohidratos: 7, grasas: 4.5, sodio: 180 },
  { nombre: "Chía", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 15, unidad: "g", calorias: 73, proteinas: 2.5, carbohidratos: 6, grasas: 4.5, sodio: 2 },
  { nombre: "Linaza Molida", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 15, unidad: "g", calorias: 74, proteinas: 2.5, carbohidratos: 4, grasas: 6, sodio: 4 },
  { nombre: "Semilla de Girasol", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 30, unidad: "g", calorias: 175, proteinas: 6, carbohidratos: 6, grasas: 15, sodio: 2 },
  { nombre: "Semilla de Calabaza", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 30, unidad: "g", calorias: 168, proteinas: 9, carbohidratos: 4, grasas: 14, sodio: 5 },
  { nombre: "Pistaches", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 30, unidad: "g", calorias: 168, proteinas: 6, carbohidratos: 8, grasas: 13, sodio: 0 },

  // —— Frutas (ampliado) ——
  { nombre: "Piña", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 50, proteinas: 0.5, carbohidratos: 13, grasas: 0.1, sodio: 1 },
  { nombre: "Naranja", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 47, proteinas: 0.9, carbohidratos: 12, grasas: 0.1, sodio: 0 },
  { nombre: "Mandarina", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 53, proteinas: 0.8, carbohidratos: 13, grasas: 0.3, sodio: 2 },
  { nombre: "Pera", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 57, proteinas: 0.4, carbohidratos: 15, grasas: 0.1, sodio: 1 },
  { nombre: "Durazno", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 39, proteinas: 0.9, carbohidratos: 10, grasas: 0.3, sodio: 0 },
  { nombre: "Kiwi", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 61, proteinas: 1.1, carbohidratos: 15, grasas: 0.5, sodio: 3 },
  { nombre: "Toronja", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 42, proteinas: 0.8, carbohidratos: 11, grasas: 0.1, sodio: 0 },
  { nombre: "Melón", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 34, proteinas: 0.8, carbohidratos: 8, grasas: 0.2, sodio: 16 },
  { nombre: "Granada", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 83, proteinas: 1.7, carbohidratos: 19, grasas: 1.2, sodio: 3 },
  { nombre: "Ciruela", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 46, proteinas: 0.7, carbohidratos: 11, grasas: 0.3, sodio: 0 },
  { nombre: "Higo", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 74, proteinas: 0.8, carbohidratos: 19, grasas: 0.3, sodio: 1 },
  { nombre: "Maracuyá", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 97, proteinas: 2.2, carbohidratos: 23, grasas: 0.7, sodio: 28 },
  { nombre: "Guayaba", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 68, proteinas: 2.6, carbohidratos: 14, grasas: 1, sodio: 2 },
  { nombre: "Tuna (Fruta)", grupo: "Frutas", grupo_equivalencia: "fruta", porcion_base: 100, unidad: "g", calorias: 41, proteinas: 0.7, carbohidratos: 10, grasas: 0.5, sodio: 2 },

  // —— Lácteos (ampliado) ——
  { nombre: "Leche de Almendras Sin Azúcar", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 250, unidad: "ml", calorias: 40, proteinas: 1, carbohidratos: 2, grasas: 3, sodio: 180 },
  { nombre: "Yogur Natural Light", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 200, unidad: "g", calorias: 110, proteinas: 10, carbohidratos: 14, grasas: 2, sodio: 85 },
  { nombre: "Leche Descremada", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 250, unidad: "ml", calorias: 85, proteinas: 8, carbohidratos: 12, grasas: 0.5, sodio: 105 },
  { nombre: "Jocoque Light", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 100, unidad: "g", calorias: 95, proteinas: 5, carbohidratos: 6, grasas: 6, sodio: 45 },

  // —— Verduras (ampliado) ——
  { nombre: "Zanahoria Cruda", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 41, proteinas: 0.9, carbohidratos: 10, grasas: 0.2, sodio: 69 },
  { nombre: "Calabaza Cocida", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 26, proteinas: 1, carbohidratos: 7, grasas: 0.1, sodio: 1 },
  { nombre: "Coliflor Cocida", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 23, proteinas: 1.8, carbohidratos: 4, grasas: 0.3, sodio: 19 },
  { nombre: "Champiñón", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 22, proteinas: 3.1, carbohidratos: 3, grasas: 0.3, sodio: 5 },
  { nombre: "Espárragos Cocidos", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 22, proteinas: 2.4, carbohidratos: 4, grasas: 0.2, sodio: 2 },
  { nombre: "Nopales Cocidos", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 16, proteinas: 1.3, carbohidratos: 3, grasas: 0.1, sodio: 20 },
  { nombre: "Calabacita", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 17, proteinas: 1.2, carbohidratos: 3, grasas: 0.3, sodio: 8 },
  { nombre: "Kale Crudo", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 35, proteinas: 2.9, carbohidratos: 7, grasas: 0.4, sodio: 53 },
  { nombre: "Acelga Cocida", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 20, proteinas: 1.9, carbohidratos: 4, grasas: 0.1, sodio: 213 },
  { nombre: "Chayote Cocido", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 19, proteinas: 0.8, carbohidratos: 4, grasas: 0.1, sodio: 2 },
  { nombre: "Pimiento Morrón", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 31, proteinas: 1, carbohidratos: 6, grasas: 0.3, sodio: 4 },
  { nombre: "Cebolla", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 40, proteinas: 1.1, carbohidratos: 9, grasas: 0.1, sodio: 4 },
  { nombre: "Betabel Cocido", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 44, proteinas: 1.7, carbohidratos: 10, grasas: 0.2, sodio: 77 },

  // —— Grasas (ampliado) ——
  { nombre: "Mantequilla de Almendra", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 15, unidad: "g", calorias: 98, proteinas: 3, carbohidratos: 3, grasas: 8.5, sodio: 2 },
  { nombre: "Aceite de Aguacate", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 1, unidad: "cucharada", calorias: 124, proteinas: 0, carbohidratos: 0, grasas: 14, sodio: 0 },
  { nombre: "Guacamole Light", grupo: "Grasas", grupo_equivalencia: "grasa", porcion_base: 50, unidad: "g", calorias: 80, proteinas: 1, carbohidratos: 4, grasas: 7, sodio: 120 },

  // —— Suplementos / otros fitness ——
  { nombre: "Creatina Monohidrato", grupo: "Otros", grupo_equivalencia: "libre", porcion_base: 5, unidad: "g", calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, sodio: 0 },
  { nombre: "BCAA en Polvo", grupo: "Otros", grupo_equivalencia: "libre", porcion_base: 10, unidad: "g", calorias: 40, proteinas: 10, carbohidratos: 0, grasas: 0, sodio: 5 },
  { nombre: "Café Negro", grupo: "Otros", grupo_equivalencia: "libre", porcion_base: 250, unidad: "ml", calorias: 2, proteinas: 0.3, carbohidratos: 0, grasas: 0, sodio: 5 },
  { nombre: "Té Verde", grupo: "Otros", grupo_equivalencia: "libre", porcion_base: 250, unidad: "ml", calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, sodio: 2 },
  { nombre: "Agua de Coco Natural", grupo: "Otros", grupo_equivalencia: "libre", porcion_base: 250, unidad: "ml", calorias: 46, proteinas: 0.5, carbohidratos: 11, grasas: 0.5, sodio: 105 },
  { nombre: "Chocolate Amargo 85%", grupo: "Otros", grupo_equivalencia: "grasa", porcion_base: 20, unidad: "g", calorias: 110, proteinas: 2, carbohidratos: 8, grasas: 9, sodio: 5 },
  { nombre: "Mermelada Sin Azúcar", grupo: "Otros", grupo_equivalencia: "azucar", porcion_base: 15, unidad: "g", calorias: 10, proteinas: 0, carbohidratos: 3, grasas: 0, sodio: 5 },
  { nombre: "Cacao en Polvo Sin Azúcar", grupo: "Otros", grupo_equivalencia: "libre", porcion_base: 10, unidad: "g", calorias: 23, proteinas: 2, carbohidratos: 3, grasas: 1, sodio: 2 },
  { nombre: "Bebida de Soya Sin Azúcar", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 250, unidad: "ml", calorias: 80, proteinas: 7, carbohidratos: 4, grasas: 4, sodio: 120 },

  // —— Preparaciones simples México fitness ——
  { nombre: "Ensalada Mixta", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 150, unidad: "g", calorias: 45, proteinas: 2, carbohidratos: 8, grasas: 0.5, sodio: 35 },
  { nombre: "Pico de Gallo", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 100, unidad: "g", calorias: 25, proteinas: 1, carbohidratos: 5, grasas: 0.2, sodio: 150 },
  { nombre: "Salsa Verde", grupo: "Otros", grupo_equivalencia: "condimento", porcion_base: 30, unidad: "g", calorias: 10, proteinas: 0.3, carbohidratos: 2, grasas: 0.1, sodio: 180 },
  { nombre: "Frijoles Refritos Light", grupo: "Leguminosas", grupo_equivalencia: "legumbre", porcion_base: 100, unidad: "g", calorias: 95, proteinas: 6, carbohidratos: 14, grasas: 1.5, sodio: 320 },
  { nombre: "Atún con Verduras", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 100, unidad: "g", calorias: 105, proteinas: 18, carbohidratos: 3, grasas: 2, sodio: 280 },
  { nombre: "Bowl de Avena Proteica", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 250, unidad: "g", calorias: 280, proteinas: 18, carbohidratos: 38, grasas: 6, sodio: 120 },
  { nombre: "Smoothie Proteico", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 300, unidad: "ml", calorias: 220, proteinas: 25, carbohidratos: 22, grasas: 3, sodio: 90 },
  { nombre: "Wrap Integral de Pollo", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 1, unidad: "pieza", calorias: 320, proteinas: 28, carbohidratos: 35, grasas: 8, sodio: 480 },
  { nombre: "Ensalada de Atún", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 150, unidad: "g", calorias: 165, proteinas: 22, carbohidratos: 6, grasas: 5, sodio: 350 },
  { nombre: "Pechuga a la Plancha", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 120, unidad: "g", calorias: 198, proteinas: 37, carbohidratos: 0, grasas: 4, sodio: 90 },
  { nombre: "Tostada de Aguacate", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 1, unidad: "pieza", calorias: 195, proteinas: 6, carbohidratos: 22, grasas: 10, sodio: 220 },
  { nombre: "Yogur con Granola", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 200, unidad: "g", calorias: 210, proteinas: 16, carbohidratos: 28, grasas: 5, sodio: 95 },
  { nombre: "Batido de Plátano y Avena", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 300, unidad: "ml", calorias: 265, proteinas: 12, carbohidratos: 45, grasas: 5, sodio: 80 },
  { nombre: "Tacos de Pollo Fitness", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 2, unidad: "pieza", calorias: 280, proteinas: 28, carbohidratos: 24, grasas: 8, sodio: 380 },
  { nombre: "Bowl de Arroz y Pollo", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 300, unidad: "g", calorias: 380, proteinas: 32, carbohidratos: 45, grasas: 6, sodio: 200 },
  { nombre: "Sándwich Integral de Pavo", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 1, unidad: "pieza", calorias: 290, proteinas: 24, carbohidratos: 32, grasas: 7, sodio: 520 },
  { nombre: "Ensalada César Light", grupo: "Verduras", grupo_equivalencia: "verdura", porcion_base: 200, unidad: "g", calorias: 180, proteinas: 14, carbohidratos: 8, grasas: 10, sodio: 420 },
  { nombre: "Pescado a la Plancha", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 150, unidad: "g", calorias: 165, proteinas: 30, carbohidratos: 0, grasas: 4, sodio: 85 },
  { nombre: "Omelette de Claras", grupo: "Carnes", grupo_equivalencia: "proteina_magra", porcion_base: 150, unidad: "g", calorias: 95, proteinas: 18, carbohidratos: 2, grasas: 1, sodio: 200 },
  { nombre: "Hot Cakes de Avena", grupo: "Cereales", grupo_equivalencia: "carbohidrato_complejo", porcion_base: 2, unidad: "pieza", calorias: 210, proteinas: 10, carbohidratos: 32, grasas: 5, sodio: 180 },
  { nombre: "Parfait de Yogur y Fruta", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 250, unidad: "g", calorias: 195, proteinas: 14, carbohidratos: 28, grasas: 3, sodio: 70 },
  { nombre: "Snack de Queso y Galletas", grupo: "Lácteos", grupo_equivalencia: "lacteo", porcion_base: 1, unidad: "pieza", calorias: 145, proteinas: 8, carbohidratos: 14, grasas: 6, sodio: 280 },
  { nombre: "Barrita de Proteína", grupo: "Otros", grupo_equivalencia: "proteina_magra", porcion_base: 1, unidad: "pieza", calorias: 200, proteinas: 20, carbohidratos: 22, grasas: 6, sodio: 180 },
  { nombre: "Isopure Clear", grupo: "Otros", grupo_equivalencia: "proteina_magra", porcion_base: 1, unidad: "pieza", calorias: 90, proteinas: 20, carbohidratos: 0, grasas: 0, sodio: 45 },
  { nombre: "Electrolitos en Polvo", grupo: "Otros", grupo_equivalencia: "libre", porcion_base: 5, unidad: "g", calorias: 5, proteinas: 0, carbohidratos: 1, grasas: 0, sodio: 200 }
];

module.exports = { ALIMENTOS_METODOG };
