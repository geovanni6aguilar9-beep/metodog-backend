/**
 * Remitente Resend (dominio verificado metodog.lat).
 * Env: RESEND_FROM = "MétodoG Soporte <soporte@metodog.lat>"
 */
function remiteResend() {
  const from = String(process.env.RESEND_FROM || "").trim();
  if (from) return from;
  console.warn("[email] RESEND_FROM vacío — fallback soporte@metodog.lat");
  return "MétodoG Soporte <soporte@metodog.lat>";
}

module.exports = { remiteResend };
