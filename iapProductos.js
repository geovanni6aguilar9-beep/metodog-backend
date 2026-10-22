/**
 * Product IDs App Store (auto-renewable) — espejo FE `frontend/src/utils/iapProductos.js`.
 * Bundle: com.metodog.app
 */

const PRODUCTO_ATLETA_MENSUAL = "com.metodog.app.pro.monthly";

const PRODUCTOS_COACH = {
  "com.metodog.app.coach.starter.monthly": "starter",
  "com.metodog.app.coach.growth.monthly": "growth",
  "com.metodog.app.coach.pro.monthly": "pro",
  "com.metodog.app.coach.studio.monthly": "studio",
  "com.metodog.app.coach.elite.monthly": "elite"
};

const TODOS_PRODUCT_IDS = [PRODUCTO_ATLETA_MENSUAL, ...Object.keys(PRODUCTOS_COACH)];

function clasificarProductId(productId) {
  const id = String(productId || "").trim();
  if (!id) return null;
  if (id === PRODUCTO_ATLETA_MENSUAL) {
    return { tipo: "atleta", plan: null, productId: id };
  }
  const plan = PRODUCTOS_COACH[id];
  if (plan) return { tipo: "coach", plan, productId: id };
  return null;
}

module.exports = {
  PRODUCTO_ATLETA_MENSUAL,
  PRODUCTOS_COACH,
  TODOS_PRODUCT_IDS,
  clasificarProductId
};
