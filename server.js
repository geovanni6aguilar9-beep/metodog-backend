const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(express.json());

process.on('uncaughtException', (err) => console.error("🔥 ERROR FATAL:", err));

const db = new sqlite3.Database("./metodog.db", (err) => {
  if (err) console.error("❌ Error DB:", err.message);
  console.log("🛡️ Base de datos SQLite conectada.");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, email TEXT UNIQUE, password TEXT, 
    rol TEXT, codigo_invitacion TEXT UNIQUE, coach_id INTEGER, fecha_inicio DATETIME DEFAULT CURRENT_TIMESTAMP, calificacion REAL DEFAULT 5.0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rutinas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER UNIQUE, datos_rutina TEXT, 
    notas_generales TEXT, ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  // 🔥 TABLA ACTUALIZADA CON "datos_extra" PARA GUARDAR PLIEGUES Y PERÍMETROS 🔥
  db.run(`CREATE TABLE IF NOT EXISTS mediciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, peso REAL, grasa REAL, datos_extra TEXT,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS valoraciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT, coach_id INTEGER, cliente_id INTEGER UNIQUE, estrellas INTEGER, 
    FOREIGN KEY(coach_id) REFERENCES usuarios(id), FOREIGN KEY(cliente_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS dietas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER UNIQUE, datos_dieta TEXT, macros_totales TEXT, 
    notas_dieta TEXT, ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS alimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, grupo TEXT, porcion_base REAL, unidad TEXT, 
    calorias REAL, proteinas REAL, carbohidratos REAL, grasas REAL, sodio REAL
  )`);

  db.get("SELECT COUNT(*) as count FROM alimentos", (err, row) => {
    if (row && row.count === 0) {
      const insert = db.prepare(`INSERT INTO alimentos (nombre, grupo, porcion_base, unidad, calorias, proteinas, carbohidratos, grasas, sodio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      insert.run("Pechuga de Pollo", "Carnes", 100, "g", 165, 31, 0, 3.6, 74);
      insert.run("Carne de Res Magra", "Carnes", 100, "g", 250, 26, 0, 15, 72);
      insert.run("Atún en Agua", "Carnes", 100, "g", 116, 26, 0, 1, 338);
      insert.run("Leche Entera", "Lácteos", 250, "ml", 150, 8, 12, 8, 105);
      insert.run("Yogur Griego Sin Azúcar", "Lácteos", 200, "g", 120, 20, 8, 0, 70);
      insert.run("Lentejas Cocidas", "Leguminosas", 100, "g", 116, 9, 20, 0.4, 2);
      insert.run("Frijoles Cocidos", "Leguminosas", 100, "g", 130, 8.8, 23, 0.5, 2);
      insert.run("Arroz Blanco Cocido", "Cereales", 100, "g", 130, 2.7, 28, 0.3, 1);
      insert.run("Avena en Hojuelas", "Cereales", 3, "cucharadas", 116, 4, 20, 2.5, 2);
      insert.run("Tortilla de Maíz", "Cereales", 1, "pieza", 52, 1.4, 11, 0.5, 11);
      insert.run("Almendras", "Grasas", 30, "g", 173, 6, 6, 15, 0);
      insert.run("Aceite de Oliva", "Grasas", 1, "cucharada", 119, 0, 0, 13.5, 0);
      insert.run("Aguacate", "Grasas", 50, "g", 80, 1, 4, 7.5, 7);
      insert.finalize();
    }
  });
});

app.get("/api/alimentos", (req, res) => {
  db.all("SELECT * FROM alimentos ORDER BY grupo, nombre ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message }); res.json(rows);
  });
});

app.post("/api/dietas/guardar", (req, res) => {
  const { usuario_id, datos_dieta, macros_totales, notas_dieta } = req.body;
  db.run(`INSERT INTO dietas (usuario_id, datos_dieta, macros_totales, notas_dieta) VALUES (?, ?, ?, ?)
          ON CONFLICT(usuario_id) DO UPDATE SET datos_dieta = excluded.datos_dieta, macros_totales = excluded.macros_totales, notas_dieta = excluded.notas_dieta`,
    [usuario_id, JSON.stringify(datos_dieta), JSON.stringify(macros_totales), JSON.stringify(notas_dieta)],
    function(err) { if (err) return res.status(500).json({ error: err.message }); res.json({ mensaje: "Dieta asignada" }); }
  );
});

app.get("/api/dietas/:usuario_id", (req, res) => {
  db.get("SELECT * FROM dietas WHERE usuario_id = ?", [req.params.usuario_id], (err, row) => {
    if (err || !row) return res.json({ datos_dieta: null });
    res.json({ datos_dieta: JSON.parse(row.datos_dieta), macros_totales: JSON.parse(row.macros_totales), notas_dieta: JSON.parse(row.notas_dieta) });
  });
});

const generarCodigo = () => Math.random().toString(36).substring(2, 8).toUpperCase();

app.post("/api/rutinas/guardar", (req, res) => {
  const { usuario_id, datos_rutina, notas_generales } = req.body;
  db.run(`INSERT INTO rutinas (usuario_id, datos_rutina, notas_generales) VALUES (?, ?, ?)
          ON CONFLICT(usuario_id) DO UPDATE SET datos_rutina = excluded.datos_rutina, notas_generales = excluded.notas_generales`,
    [usuario_id, JSON.stringify(datos_rutina), JSON.stringify(notas_generales)],
    function(err) { if (err) return res.status(500).json({ error: err.message }); res.json({ mensaje: "Ok" }); }
  );
});

app.get("/api/rutinas/:usuario_id", (req, res) => {
  db.get("SELECT * FROM rutinas WHERE usuario_id = ?", [req.params.usuario_id], (err, row) => {
    if (err || !row) return res.json({ datos_rutina: null });
    res.json({ datos_rutina: JSON.parse(row.datos_rutina), notas_generales: JSON.parse(row.notas_generales) });
  });
});

app.post("/api/mediciones/guardar", (req, res) => {
  const { usuario_id, peso, grasa, datos_extra } = req.body;
  db.run("INSERT INTO mediciones (usuario_id, peso, grasa, datos_extra) VALUES (?, ?, ?, ?)", [usuario_id, peso, grasa, datos_extra], (err) => {
    if (err) return res.status(500).json({ error: err.message }); res.json({ mensaje: "Ok" });
  });
});

app.get("/api/clientes/:id/resumen", (req, res) => {
  db.get("SELECT nombre, email, fecha_inicio FROM usuarios WHERE id = ?", [req.params.id], (err, info) => {
    if (err || !info) return res.status(404).json({ error: "No" });
    db.all("SELECT peso, grasa, datos_extra, fecha FROM mediciones WHERE usuario_id = ?", [req.params.id], (err, hist) => {
      res.json({ info, historial: hist || [] });
    });
  });
});

app.get("/api/comunidad/:id", (req, res) => {
  db.get("SELECT rol FROM usuarios WHERE id = ?", [req.params.id], (err, user) => {
    if (user.rol === 'SUPERADMIN') db.all("SELECT id, nombre, email, rol, coach_id, calificacion, codigo_invitacion FROM usuarios", [], (err, rows) => res.json(rows));
    else if (user.rol === 'COACH') db.all("SELECT id, nombre, email, rol FROM usuarios WHERE coach_id = ?", [req.params.id], (err, rows) => res.json(rows));
    else res.json([]);
  });
});

app.get("/api/coach/:id", (req, res) => {
  db.get("SELECT id, nombre, email, calificacion FROM usuarios WHERE id = ?", [req.params.id], (err, coach) => {
    if (err || !coach) return res.status(404).json({ error: "No encontrado" }); res.json(coach);
  });
});

app.post("/api/calificar", (req, res) => {
  const { coach_id, cliente_id, estrellas } = req.body;
  db.run(`INSERT INTO valoraciones (coach_id, cliente_id, estrellas) VALUES (?, ?, ?) ON CONFLICT(cliente_id) DO UPDATE SET estrellas = excluded.estrellas`, 
    [coach_id, cliente_id, estrellas], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get("SELECT AVG(estrellas) as promedio FROM valoraciones WHERE coach_id = ?", [coach_id], (err, row) => {
        const nuevoPromedio = row.promedio || 5.0;
        db.run("UPDATE usuarios SET calificacion = ? WHERE id = ?", [nuevoPromedio, coach_id], () => res.json({ mensaje: "Ok", calificacion: nuevoPromedio }));
      });
  });
});

app.post("/api/registro", (req, res) => {
  const { nombre, email, password, codigoIngresado } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  const emailLimpio = email.toLowerCase().trim();
  const rol = (emailLimpio === 'geovanni6aguilar9@gmail.com') ? 'SUPERADMIN' : 'CLIENTE';
  const query = `INSERT INTO usuarios (nombre, email, password, rol, codigo_invitacion, coach_id) VALUES (?, ?, ?, ?, ?, ?)`;
  
  if (codigoIngresado && codigoIngresado.trim() !== '') {
    db.get("SELECT id FROM usuarios WHERE codigo_invitacion = ?", [codigoIngresado.toUpperCase()], (err, coach) => {
      if (!coach) return res.status(400).json({ error: "Código Inválido" });
      db.run(query, [nombre, emailLimpio, hash, 'CLIENTE', null, coach.id], function() { res.json({ mensaje: "Ok" }); });
    });
  } else {
    db.run(query, [nombre, emailLimpio, hash, rol, (rol === 'SUPERADMIN' ? generarCodigo() : null), null], function() { res.json({ mensaje: "Ok" }); });
  }
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM usuarios WHERE email = ?`, [email.toLowerCase().trim()], (err, user) => {
    if (err || !user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: "Error" });
    res.json({ usuario: user });
  });
});

app.post("/api/upgrade", (req, res) => {
  const cod = generarCodigo();
  db.run("UPDATE usuarios SET rol = 'COACH', codigo_invitacion = ? WHERE id = ?", [cod, req.body.usuario_id], () => res.json({ rol: 'COACH', codigo_invitacion: cod }));
});

app.listen(4000, () => console.log("🚀 MOTOR EN PUERTO 4000"));