import express, { type Request, type Response } from "express";

interface ProductoInferido {
  id: string;
}

export function getProducto(req: Request<{ id: string }>, res: Response<ProductoInferido>) {
  res.json({ id: req.params.id });
}

const app = express();
app.get("/productos/:id", getProducto);
app.delete("/productos/:id", (req: Request, res: Response) => res.status(204).end());
