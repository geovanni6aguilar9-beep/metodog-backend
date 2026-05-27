/**
 * Programa Meso 2 — Geovanni Aguilar (SUPERADMIN).
 * Sesiones 1–6 → Lunes–Sábado en GestorRutinas.
 */

const SUPERADMIN_EMAIL = "geovanni6aguilar9@gmail.com";

const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const PROGRAMA_MESO2 = {
  nombre_rutina: "Programa de entrenamiento Meso 2",
  notas_generales:
    "1. 40 min de cardio programado (7 RPE). 2. 12k pasos diarios. 3. Calentamiento: 3 sets crunch abdominal <2 RIR (Lun, Mié, Vie). 4. Descanso: 2 min o recuperación completa.",
  preguntas_checkin: [
    "En escala del 1 al 10 ¿qué tan fatigante sentiste la semana?",
    "En escala del 1 al 10, nivel de energía promedio.",
    "Promedio de horas de sueño diarias."
  ],
  sesiones: [
    {
      dia: 1,
      titulo: "Sesión 1",
      ejercicios: [
        { musculo: "Hombro", nombre: "Press de hombro en máquina", sets: 2, reps: "10-15", rir: 2 },
        { musculo: "Hombro", nombre: "Elevaciones laterales con mancuerna", sets: 3, reps: "10-15", rir: 1 },
        { musculo: "Pectoral", nombre: "Press inclinado con mancuernas", sets: 2, reps: "10-15", rir: 2 },
        { musculo: "Pectoral", nombre: "Press horizontal máquina", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Pectoral", nombre: "Pec fly", sets: 2, reps: "10-15", rir: 1 },
        { musculo: "Tríceps", nombre: "Press francés con mancuernas", sets: 2, reps: "10-15", rir: 2 },
        { musculo: "Tríceps", nombre: "Extensión de tríceps con barra recta en polea alta", sets: 3, reps: "10-15", rir: 2 }
      ]
    },
    {
      dia: 2,
      titulo: "Sesión 2",
      ejercicios: [
        { musculo: "Espalda", nombre: "Pull down al frente agarre prono", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Espalda", nombre: "Pull over con soga", sets: 2, reps: "10-15", rir: 1 },
        { musculo: "Espalda", nombre: "Remo T abierto", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Hombro post", nombre: "Pec fly invertido", sets: 3, reps: "10-15", rir: 1 },
        { musculo: "Bíceps", nombre: "Curl con barra recta", sets: 2, reps: "10-15", rir: 2 },
        { musculo: "Bíceps", nombre: "Curl martillo con mancuernas", sets: 2, reps: "10-15", rir: 2 },
        { musculo: "Trapecio", nombre: "Encogimiento con mancuernas", sets: 3, reps: "10-15", rir: 1 }
      ]
    },
    {
      dia: 3,
      titulo: "Sesión 3",
      ejercicios: [
        { musculo: "Cuádriceps", nombre: "Sentadilla hack", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Cuádriceps", nombre: "Extensión de cuads en máquina", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Isquiosurales", nombre: "Peso muerto rumano con barra", sets: 2, reps: "10-15", rir: 2 },
        { musculo: "Isquiosurales", nombre: "Curl isquiosurales recostado", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Glúteo", nombre: "Hip thrust con barra", sets: 3, reps: "10-15", rir: 1 },
        { musculo: "Aductores", nombre: "Aducción en máquina", sets: 3, reps: "10-15", rir: 1 },
        { musculo: "Pantorrilla", nombre: "Pantorrilla de pie en máquina", sets: 3, reps: "10-15", rir: 1 }
      ]
    },
    {
      dia: 4,
      titulo: "Sesión 4",
      ejercicios: [
        { musculo: "Hombro", nombre: "Press militar con mancuernas", sets: 2, reps: "10-15", rir: 2 },
        { musculo: "Hombro", nombre: "Elevaciones laterales con mancuerna", sets: 3, reps: "10-15", rir: 1 },
        { musculo: "Hombro", nombre: "Elevaciones frontales con mancuerna", sets: 2, reps: "10-15", rir: 1 },
        { musculo: "Pectoral", nombre: "Press inclinado con mancuernas", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Pectoral", nombre: "Apertura con mancuernas en banco horizontal", sets: 2, reps: "10-15", rir: 2 },
        { musculo: "Tríceps", nombre: "Extensión francesa con soga en polea alta", sets: 2, reps: "10-15", rir: 1 },
        { musculo: "Tríceps", nombre: "Extensión de tríceps con barra recta en polea alta", sets: 3, reps: "10-15", rir: 1 }
      ]
    },
    {
      dia: 5,
      titulo: "Sesión 5",
      ejercicios: [
        { musculo: "Espalda", nombre: "Pull down al frente agarre supino", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Espalda", nombre: "Remo con mancuerna a 1 mano", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Hombro post", nombre: "Pec fly invertido", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Bíceps", nombre: "Curl con barra recta en polea baja", sets: 2, reps: "10-15", rir: 2 },
        { musculo: "Bíceps", nombre: "Predicador máquina", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Trapecio", nombre: "Encogimiento con mancuernas", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Pantorrilla", nombre: "Pantorrilla de pie en máquina", sets: 3, reps: "10-15", rir: 1 }
      ]
    },
    {
      dia: 6,
      titulo: "Sesión 6",
      ejercicios: [
        { musculo: "Isquiosurales", nombre: "Curl isquiosurales sentado", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Isquiosurales", nombre: "Curl isquiosurales recostado", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Cuádriceps", nombre: "Sentadilla hack", sets: 3, reps: "10-15", rir: 2 },
        { musculo: "Cuádriceps", nombre: "Extensión de cuads en máquina", sets: 3, reps: "10-15", rir: 1 },
        { musculo: "Glúteo", nombre: "Sentadilla búlgara con mancuernas", sets: 3, reps: "10-15", rir: 1 },
        { musculo: "Glúteo", nombre: "Abducción en máquina", sets: 3, reps: "15-20", rir: 1 },
        { musculo: "Aductores", nombre: "Aducción en máquina", sets: 3, reps: "15-20", rir: 1 }
      ]
    }
  ]
};

function buildEjercicioDesdeSeed(ej, id) {
  const numSets = Math.max(1, parseInt(ej.sets, 10) || 3);
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
    rir: String(ej.rir ?? 2),
    peso: "",
    bloque: null,
    colorId: null,
    sets
  };
}

/** Construye payload listo para tabla rutinas (datos_rutina + notas_generales). */
function buildMeso2Payload(programa = PROGRAMA_MESO2) {
  const datos_rutina = {};
  const notas_generales = {};
  let ejId = 1;

  for (const diaNombre of DIAS_SEMANA) {
    datos_rutina[diaNombre] = [];
    notas_generales[diaNombre] = "";
  }

  for (const sesion of programa.sesiones || []) {
    const diaNombre = DIAS_SEMANA[(sesion.dia || 1) - 1];
    if (!diaNombre) continue;

    datos_rutina[diaNombre] = (sesion.ejercicios || []).map((ej) => {
      const built = buildEjercicioDesdeSeed(ej, ejId);
      ejId += 1;
      return built;
    });

    const lineasNota = [`🏋️ ${sesion.titulo || `Sesión ${sesion.dia}`}`];
    if (sesion.dia === 1) {
      lineasNota.unshift(`📋 ${programa.nombre_rutina}`);
      lineasNota.push("");
      lineasNota.push(programa.notas_generales);
    }
    if (sesion.dia === 6) {
      lineasNota.push("");
      lineasNota.push("📝 Al cerrar la semana, completa el check-in semanal abajo.");
    }
    notas_generales[diaNombre] = lineasNota.join("\n");
  }

  datos_rutina._meta = {
    nombre_rutina: programa.nombre_rutina,
    notas_programa: programa.notas_generales,
    preguntas_checkin: programa.preguntas_checkin || [],
    checkin_respuestas: (programa.preguntas_checkin || []).map(() => "")
  };

  return { datos_rutina, notas_generales };
}

module.exports = {
  SUPERADMIN_EMAIL,
  PROGRAMA_MESO2,
  DIAS_SEMANA,
  buildMeso2Payload
};
