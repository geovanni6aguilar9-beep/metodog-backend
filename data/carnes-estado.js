/** Pares crudo/cocido. La ficha con coach_id NULL es la que ya ve la IA. El par va en coach_id 0. */
function k(p, c, g) {
  return Math.round((4 * p + 4 * (c || 0) + 9 * g) * 10) / 10;
}

function ficha(estado, p, g, c, sodio) {
  return {
    estado,
    calorias: k(p, c, g),
    proteinas: p,
    carbohidratos: c || 0,
    grasas: g,
    sodio: sodio || 0
  };
}

const CARNES_ESTADO = [
  { nombre: "Pechuga de Pollo", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 22.5, 2.6, 0, 45) },
  { nombre: "Pechuga de Pavo", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 30, 2, 0, 63) },
  { nombre: "Pescado Tilapia", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 26, 2.7, 0, 56) },
  { nombre: "Camarón", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 24, 0.3, 0.2, 120) },
  { nombre: "Bacalao", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 23, 0.9, 0, 78) },
  { nombre: "Merluza", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 20, 0.8, 0, 80) },
  { nombre: "Trucha", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 24, 7, 0, 67) },
  { nombre: "Salmón", grupo_equivalencia: "proteina_grasa", estado: "crudo", par: ficha("cocido", 22, 12, 0, 61) },
  { nombre: "Calamar", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 18, 1.5, 3, 44) },
  { nombre: "Ostión", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 9, 3, 5, 90) },
  { nombre: "Carne Molida 90/10", grupo_equivalencia: "proteina_grasa", estado: "crudo", par: ficha("cocido", 26, 10, 0, 70) },
  { nombre: "Carne Molida 80/20", grupo_equivalencia: "proteina_grasa", estado: "crudo", par: ficha("cocido", 25, 16, 0, 75) },
  { nombre: "Filete de Res", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 22, 5, 0, 50) },
  { nombre: "Bistec de Res", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 21, 8, 0, 55) },
  { nombre: "Arrachera Magra", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 19, 12, 0, 60) },
  { nombre: "Pulpa Negra", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 23, 3, 0, 52) },
  { nombre: "Pulpa Blanca", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 23, 2.5, 0, 50) },
  { nombre: "Lomo de Cerdo Magro", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 21, 2.2, 0, 52) },
  { nombre: "Chuleta de Cerdo Magra", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 21, 5, 0, 55) },
  { nombre: "Robalo", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 18, 2.3, 0, 60) },
  { nombre: "Muslo de Pollo sin Piel", grupo_equivalencia: "proteina_grasa", estado: "crudo", par: ficha("cocido", 24.8, 8.2, 0, 106) },
  { nombre: "Carne de Res Magra", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 30, 3.5, 0, 58) },
  { nombre: "Pierna de Cerdo sin Grasa", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 20, 5, 0, 55) },
  { nombre: "Pechuga de Pato sin Piel", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 19, 6, 0, 70) },
  { nombre: "Huachinango", grupo_equivalencia: "proteina_magra", estado: "cocido", par: ficha("crudo", 20.5, 1.3, 0, 50) },
  { nombre: "Mojarra", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 26, 2.7, 0, 56) },
  { nombre: "Pulpo", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 30, 2, 2.2, 230) },
  { nombre: "Mejillón", grupo_equivalencia: "proteina_magra", estado: "crudo", par: ficha("cocido", 24, 4.5, 7, 370) }
];

module.exports = { CARNES_ESTADO };
