export function listar() {
  return [];
}

export default function handler(req, res) {
  switch (req.method) {
    case "GET":
      return res.json(listar());
    case "POST":
      return res.status(201).json({});
  }
}
