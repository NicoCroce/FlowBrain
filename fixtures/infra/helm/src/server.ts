import express from "express";
const app = express();
app.get("/catalogo/items", (_req, res) => res.json([]));
app.get("/catalogo/items/:id", (_req, res) => res.json({}));
app.get("/metricas", (_req, res) => res.send(""));
app.listen(8080);
