/**
 * Recordatorios de fin de trial coach — campanita + email (cron diario).
 */
const { crearNotificacion } = require("./notificaciones");
const { trialExpirado, TRIAL_DIAS } = require("./planesSuscripcion");

const UMBRALES_DIAS = [3, 1, 0];

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function diasRestantesCalendario(trialEndIso) {
  if (!trialEndIso) return null;
  const end = new Date(trialEndIso);
  if (Number.isNaN(end.getTime())) return null;
  const diff = startOfLocalDay(end) - startOfLocalDay(new Date());
  return Math.round(diff / (24 * 60 * 60 * 1000));
}

function fmtFechaEs(iso) {
  try {
    return new Date(iso).toLocaleDateString("es-MX", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  } catch {
    return String(iso || "");
  }
}

function urlSuscripcionCoach() {
  const raw = (process.env.FRONTEND_URL || process.env.CORS_ORIGINS || "https://metodog-frontend.vercel.app").trim();
  const base = raw.split(",")[0].trim().replace(/\/$/, "");
  return `${base}/?coach_suscripcion=1`;
}

function mensajesRecordatorio(diasRestantes, nombre, trialEndIso) {
  const fecha = fmtFechaEs(trialEndIso);
  const link = urlSuscripcionCoach();
  const saludo = nombre ? `Hola <b>${nombre}</b>,` : "Hola,";

  if (diasRestantes === 0) {
    return {
      titulo: "Tu trial coach vence hoy",
      cuerpo: `Tu prueba de ${TRIAL_DIAS} días termina hoy (${fecha}). Elige un plan para seguir vinculando alumnos. Cancela cuando quieras desde Stripe.`,
      emailSubject: "⏰ Tu trial MétodoG Coach vence hoy",
      emailHtml: `<p>${saludo}</p>
        <p>Tu periodo de prueba de <b>${TRIAL_DIAS} días</b> en MétodoG Coach termina <b>hoy (${fecha})</b>.</p>
        <p>Para seguir usando el software con tus alumnos, elige un plan en la app. Si prefieres no continuar, puedes <b>cancelar cuando quieras</b> desde el portal de Stripe — sin permanencia.</p>
        <p><a href="${link}">Abrir suscripción Coach →</a></p>
        <p style="color:#888;font-size:12px;">MétodoG · Coach PRO</p>`
    };
  }

  if (diasRestantes === 1) {
    return {
      titulo: "Tu trial coach vence mañana",
      cuerpo: `Mañana termina tu prueba (${fecha}). Actualiza tu plan o cancela cuando quieras desde Stripe — sin permanencia.`,
      emailSubject: "⏳ Tu trial MétodoG Coach vence mañana",
      emailHtml: `<p>${saludo}</p>
        <p>Te queda <b>1 día</b> de tu prueba Coach PRO (vence el <b>${fecha}</b>).</p>
        <p>Elige un plan para no interrumpir el acceso a tus alumnos. Puedes cancelar en cualquier momento desde Stripe si decides no continuar.</p>
        <p><a href="${link}">Ver planes Coach →</a></p>
        <p style="color:#888;font-size:12px;">MétodoG · Coach PRO</p>`
    };
  }

  return {
    titulo: "Tu trial coach termina en 3 días",
    cuerpo: `Tu acceso de prueba vence el ${fecha}. Elige un plan para no perder acceso a tus alumnos. Cancela cuando quieras — sin permanencia.`,
    emailSubject: "📅 Tu trial MétodoG Coach termina en 3 días",
    emailHtml: `<p>${saludo}</p>
      <p>Tu acceso VIP de prueba termina en <b>3 días</b> (el <b>${fecha}</b>).</p>
      <p>Añade o confirma tu plan para seguir vinculando alumnos sin interrupciones. <b>Cancela cuando quieras</b> desde Stripe — no hay plazos forzosos.</p>
      <p><a href="${link}">Ir a Suscripción Coach →</a></p>
      <p style="color:#888;font-size:12px;">MétodoG · Coach PRO</p>`
  };
}

async function yaNotificado(db, usuarioId, diasUmbral) {
  const r = await db.execute({
    sql: `SELECT id FROM notificaciones
          WHERE usuario_id = ? AND tipo = 'trial_por_vencer'
            AND ref_tipo = 'trial_dias' AND ref_id = ?
          LIMIT 1`,
    args: [usuarioId, diasUmbral]
  });
  return r.rows.length > 0;
}

async function enviarEmailCoachTrial(resend, coach, msg) {
  if (!resend || !coach?.email) return false;
  try {
    await resend.emails.send({
      from: "MétodoG Coach <onboarding@resend.dev>",
      to: coach.email,
      subject: msg.emailSubject,
      html: msg.emailHtml
    });
    return true;
  } catch (err) {
    console.warn("Email recordatorio trial falló:", coach.email, err?.message || err);
    return false;
  }
}

/** Cron diario: coaches en trialing con 3, 1 o 0 días restantes (calendario). */
async function procesarRecordatoriosTrialCoach(db, resend) {
  const r = await db.execute({
    sql: `SELECT u.id, u.nombre, u.email, s.trial_end, s.status
          FROM suscripciones_coach s
          JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.status = 'trialing'
            AND s.trial_end IS NOT NULL
            AND u.rol = 'COACH'`
  });

  const stats = { revisados: 0, campanita: 0, emails: 0, omitidos: 0 };

  for (const row of r.rows || []) {
    stats.revisados++;
    if (trialExpirado(row.trial_end)) continue;

    const dias = diasRestantesCalendario(row.trial_end);
    if (dias == null || !UMBRALES_DIAS.includes(dias)) {
      stats.omitidos++;
      continue;
    }

    if (await yaNotificado(db, row.id, dias)) {
      stats.omitidos++;
      continue;
    }

    const msg = mensajesRecordatorio(dias, row.nombre, row.trial_end);
    await crearNotificacion(db, {
      usuarioId: row.id,
      tipo: "trial_por_vencer",
      titulo: msg.titulo,
      cuerpo: msg.cuerpo,
      refTipo: "trial_dias",
      refId: dias
    });
    stats.campanita++;

    if (await enviarEmailCoachTrial(resend, row, msg)) {
      stats.emails++;
    }
  }

  return stats;
}

module.exports = {
  procesarRecordatoriosTrialCoach,
  diasRestantesCalendario,
  UMBRALES_DIAS
};
