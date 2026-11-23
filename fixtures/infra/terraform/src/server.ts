import express from "express";
const app = express();
app.get("/productos", (_req, res) => res.json([]));
app.delete("/productos/:id", (_req, res) => res.json({}));
export default app;
