import express from "express";
const app = express();
app.get("/api/productos", (_req, res) => res.json([]));
app.post("/api/pedidos", (_req, res) => res.json({}));
app.get("/salud", (_req, res) => res.send("ok"));
app.listen(3000);
