export async function main(): Promise<void> {
  const { default: express } = await import("express");
  const payments = await import("./routes/payments.js");
  const webhooks = await import("./routes/webhooks.js");
  const app = express();
  app.use(payments.router, webhooks.router);
  app.listen(3002);
}
