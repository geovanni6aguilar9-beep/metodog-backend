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
    await db.execute(`CREATE TABLE IF NOT EXISTS dietas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER UNIQUE, datos_dieta TEXT, macros_totales TEXT, 
      notas_dieta TEXT, ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS alimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, grupo TEXT, porcion_base REAL, unidad TEXT, 
      calorias REAL, proteinas REAL, carbohidratos REAL, grasas REAL, sodio REAL
    )`);
    console.log("✅ Bóveda de Turso conectada y lista.");
  } catch (error) { console.error("❌ Error al conectar con Turso:", error); }
}
inicializarBD();

// --- AQUÍ VAN TUS RUTAS DE API IGUAL QUE ANTES PERO CON db.execute ---
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const resDB = await db.execute({ sql: "SELECT * FROM usuarios WHERE email = ?", args: [email.toLowerCase().trim()] });
    if (resDB.rows.length === 0) return res.status(401).json({ error: "Error" });
    const user = resDB.rows[0];
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: "Error" });
    res.json({ usuario: user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/registro", async (req, res) => {
  const { nombre, email, password, codigoIngresado } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  const emailLimpio = email.toLowerCase().trim();
  const rol = (emailLimpio === 'geovanni6aguilar9@gmail.com') ? 'SUPERADMIN' : 'CLIENTE';
  try {
    if (codigoIngresado) {
      const coach = await db.execute({ sql: "SELECT id FROM usuarios WHERE codigo_invitacion = ?", args: [codigoIngresado.toUpperCase()] });
      if (coach.rows.length === 0) return res.status(400).json({ error: "Código Inválido" });
      await db.execute({ sql: "INSERT INTO usuarios (nombre, email, password, rol, coach_id) VALUES (?, ?, ?, ?, ?)", args: [nombre, emailLimpio, hash, 'CLIENTE', coach.rows[0].id] });
    } else {
      const cod = rol === 'SUPERADMIN' ? Math.random().toString(36).substring(2, 8).toUpperCase() : null;
      await db.execute({ sql: "INSERT INTO usuarios (nombre, email, password, rol, codigo_invitacion) VALUES (?, ?, ?, ?, ?)", args: [nombre, emailLimpio, hash, rol, cod] });
    }
    res.json({ mensaje: "Ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/comunidad/:id", async (req, res) => {
  try {
    const user = await db.execute({ sql: "SELECT rol FROM usuarios WHERE id = ?", args: [req.params.id] });
    if (user.rows[0].rol === 'SUPERADMIN') {
      const all = await db.execute("SELECT id, nombre, email, rol, codigo_invitacion FROM usuarios");
      res.json(all.rows);
    } else {
      const clientes = await db.execute({ sql: "SELECT id, nombre, email, rol FROM usuarios WHERE coach_id = ?", args: [req.params.id] });
      res.json(clientes.rows);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 MOTOR EN PUERTO ${PORT}`));
