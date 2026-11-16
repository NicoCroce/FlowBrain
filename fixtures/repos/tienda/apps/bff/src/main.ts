export async function main(): Promise<void> {
  const { default: express } = await import("express");
  const { router } = await import("./routes/checkout.js");
  const app = express();
  app.use(router);
  app.listen(3001);
}
