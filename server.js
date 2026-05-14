const express = require("express");
const cors = require("cors");
const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(express.json());

process.on('uncaughtException', (err) => console.error("🔥 ERROR FATAL:", err));

// 🔥 CONEXIÓN A LA BASE DE DATOS INMORTAL (TURSO)
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

const db = createClient({ url, authToken });

async function inicializarBD() {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, email TEXT UNIQUE, password TEXT, 
      rol TEXT, codigo_invitacion TEXT UNIQUE, coach_id INTEGER, fecha_inicio DATETIME DEFAULT CURRENT_TIMESTAMP, calificacion REAL DEFAULT 5.0
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS rutinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER UNIQUE, datos_rutina TEXT, 
      notas_generales TEXT, ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS mediciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, peso REAL, grasa REAL, datos_extra TEXT,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS valoraciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, coach_id INTEGER, cliente_id INTEGER UNIQUE, estrellas INTEGER, 
      FOREIGN KEY(coach_id) REFERENCES usuarios(id), FOREIGN KEY(cliente_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS dietas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER UNIQUE, datos_dieta TEXT, macros_totales TEXT, 
      notas_dieta TEXT, ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS alimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, grupo TEXT, porcion_base REAL, unidad TEXT, 
      calorias REAL, proteinas REAL, carbohidratos REAL, grasas REAL, sodio REAL
    )`);

    const countRes = await db.execute("SELECT COUNT(*) as count FROM alimentos");
    if (countRes.rows[0].count === 0) {
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Pechuga de Pollo", "Carnes", 100, "g", 165, 31, 0, 3.6, 74] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Carne de Res Magra", "Carnes", 100, "g", 250, 26, 0, 15, 72] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Atún en Agua", "Carnes", 100, "g", 116, 26, 0, 1, 338] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Leche Entera", "Lácteos", 250, "ml", 150, 8, 12, 8, 105] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Yogur Griego Sin Azúcar", "Lácteos", 200, "g", 120, 20, 8, 0, 70] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Lentejas Cocidas", "Leguminosas", 100, "g", 116, 9, 20, 0.4, 2] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Frijoles Cocidos", "Leguminosas", 100, "g", 130, 8.8, 23, 0.5, 2] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Arroz Blanco Cocido", "Cereales", 100, "g", 130, 2.7, 28, 0.3, 1] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Avena en Hojuelas", "Cereales", 3, "cucharadas", 116, 4, 20, 2.5, 2] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Tortilla de Maíz", "Cereales", 1, "pieza", 52, 1.4, 11, 0.5, 11] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Almendras", "Grasas", 30, "g", 173, 6, 6, 15, 0] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Aceite de Oliva", "Grasas", 1, "cucharada", 119, 0, 0, 13.5, 0] });
      await db.execute({ sql: "INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: ["Aguacate", "Grasas", 50, "g", 80, 1, 4, 7.5, 7] });
    }
    console.log("✅ Bóveda de Turso conectada y lista.");
  } catch (error) { console.error("❌ Error al conectar con Turso:", error); }
}
inicializarBD();

app.get("/api/alimentos", async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM alimentos ORDER BY grupo, nombre ASC");
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/dietas/guardar", async (req, res) => {
  const { usuario_id, datos_dieta, macros_totales, notas_dieta } = req.body;
  try {
    await db.execute({
      sql: `INSERT INTO dietas (usuario_id, datos_dieta, macros_totales, notas_dieta) VALUES (?, ?, ?, ?)
            ON CONFLICT(usuario_id) DO UPDATE SET datos_dieta = excluded.datos_dieta, macros_totales = excluded.macros_totales, notas_dieta = excluded.notas_dieta`,
      args: [usuario_id, JSON.stringify(datos_dieta), JSON.stringify(macros_totales), JSON.stringify(notas_dieta)]
    });
    res.json({ mensaje: "Dieta asignada" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/dietas/:usuario_id", async (req, res) => {
  try {
    const result = await db.execute({ sql: "SELECT * FROM dietas WHERE usuario_id = ?", args: [req.params.usuario_id] });
    if (result.rows.length === 0) return res.json({ datos_dieta: null });
    const row = result.rows[0];
    res.json({ datos_dieta: JSON.parse(row.datos_dieta), macros_totales: JSON.parse(row.macros_totales), notas_dieta: JSON.parse(row.notas_dieta) });
  } catch (err) { res.json({ datos_dieta: null }); }
});

const generarCodigo = () => Math.random().toString(36).substring(2, 8).toUpperCase();

app.post("/api/rutinas/guardar", async (req, res) => {
  const { usuario_id, datos_rutina, notas_generales } = req.body;
  try {
    await db.execute({
      sql: `INSERT INTO rutinas (usuario_id, datos_rutina, notas_generales) VALUES (?, ?, ?)
            ON CONFLICT(usuario_id) DO UPDATE SET datos_rutina = excluded.datos_rutina, notas_generales = excluded.notas_generales`,
      args: [usuario_id, JSON.stringify(datos_rutina), JSON.stringify(notas_generales)]
    });
    res.json({ mensaje: "Ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/rutinas/:usuario_id", async (req, res) => {
  try {
    const result = await db.execute({ sql: "SELECT * FROM rutinas WHERE usuario_id = ?", args: [req.params.usuario_id] });
    if (result.rows.length === 0) return res.json({ datos_rutina: null });
    const row = result.rows[0];
    res.json({ datos_rutina: JSON.parse(row.datos_rutina), notas_generales: JSON.parse(row.notas_generales) });
  } catch (err) { res.json({ datos_rutina: null }); }
});

app.post("/api/mediciones/guardar", async (req, res) => {
  const { usuario_id, peso, grasa, datos_extra } = req.body;
  try {
    await db.execute({ sql: "INSERT INTO mediciones (usuario_id, peso, grasa, datos_extra) VALUES (?, ?, ?, ?)", args: [usuario_id, peso, grasa, datos_extra] });
    res.json({ mensaje: "Ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/clientes/:id/resumen", async (req, res) => {
  try {
    const infoRes = await db.execute({ sql: "SELECT nombre, email, fecha_inicio FROM usuarios WHERE id = ?", args: [req.params.id] });
    if (infoRes.rows.length === 0) return res.status(404).json({ error: "No" });
    const histRes = await db.execute({ sql: "SELECT peso, grasa, datos_extra, fecha FROM mediciones WHERE usuario_id = ?", args: [req.params.id] });
    res.json({ info: infoRes.rows[0], historial: histRes.rows || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/comunidad/:id", async (req, res) => {
  try {
    const userRes = await db.execute({ sql: "SELECT rol FROM usuarios WHERE id = ?", args: [req.params.id] });
    if (userRes.rows.length === 0) return res.json([]);
    const user = userRes.rows[0];
    if (user.rol === 'SUPERADMIN') {
      const allRes = await db.execute("SELECT id, nombre, email, rol, coach_id, calificacion, codigo_invitacion FROM usuarios");
      res.json(allRes.rows);
    } else if (user.rol === 'COACH') {
      const coachRes = await db.execute({ sql: "SELECT id, nombre, email, rol FROM usuarios WHERE coach_id = ?", args: [req.params.id] });
      res.json(coachRes.rows);
    } else { res.json([]); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/coach/:id", async (req, res) => {
  try {
    const coachRes = await db.execute({ sql: "SELECT id, nombre, email, calificacion FROM usuarios WHERE id = ?", args: [req.params.id] });
    if (coachRes.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(coachRes.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/calificar", async (req, res) => {
  const { coach_id, cliente_id, estrellas } = req.body;
  try {
    await db.execute({ sql: `INSERT INTO valoraciones (coach_id, cliente_id, estrellas) VALUES (?, ?, ?) ON CONFLICT(cliente_id) DO UPDATE SET estrellas = excluded.estrellas`, args: [coach_id, cliente_id, estrellas] });
    const avgRes = await db.execute({ sql: "SELECT AVG(estrellas) as promedio FROM valoraciones WHERE coach_id = ?", args: [coach_id] });
    const nuevoPromedio = avgRes.rows[0].promedio || 5.0;
    await db.execute({ sql: "UPDATE usuarios SET calificacion = ? WHERE id = ?", args: [nuevoPromedio, coach_id] });
    res.json({ mensaje: "Ok", calificacion: nuevoPromedio });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/registro", async (req, res) => {
  const { nombre, email, password, codigoIngresado } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  const emailLimpio = email.toLowerCase().trim();
  const rol = (emailLimpio === 'geovanni6aguilar9@gmail.com') ? 'SUPERADMIN' : 'CLIENTE';
  const query = `INSERT INTO usuarios (nombre, email, password, rol, codigo_invitacion, coach_id) VALUES (?, ?, ?, ?, ?, ?)`;
  
  try {
    if (codigoIngresado && codigoIngresado.trim() !== '') {
      const coachRes = await db.execute({ sql: "SELECT id FROM usuarios WHERE codigo_invitacion = ?", args: [codigoIngresado.toUpperCase()] });
      if (coachRes.rows.length === 0) return res.status(400).json({ error: "Código Inválido" });
      await db.execute({ sql: query, args: [nombre, emailLimpio, hash, 'CLIENTE', null, coachRes.rows[0].id] });
      res.json({ mensaje: "Ok" });
    } else {
      await db.execute({ sql: query, args: [nombre, emailLimpio, hash, rol, (rol === 'SUPERADMIN' ? generarCodigo() : null), null] });
      res.json({ mensaje: "Ok" });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const userRes = await db.execute({ sql: `SELECT * FROM usuarios WHERE email = ?`, args: [email.toLowerCase().trim()] });
    if (userRes.rows.length === 0) return res.status(401).json({ error: "Error" });
    const user = userRes.rows[0];
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: "Error" });
    res.json({ usuario: user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/upgrade", async (req, res) => {
  const cod = generarCodigo();
  try {
    await db.execute({ sql: "UPDATE usuarios SET rol = 'COACH', codigo_invitacion = ? WHERE id = ?", args: [cod, req.body.usuario_id] });
    res.json({ rol: 'COACH', codigo_invitacion: cod });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 MOTOR EN PUERTO ${PORT}`));
