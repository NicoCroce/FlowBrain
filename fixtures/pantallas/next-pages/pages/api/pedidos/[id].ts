export default async function handler(req, res) {
  res.json({ id: req.query.id });
}
