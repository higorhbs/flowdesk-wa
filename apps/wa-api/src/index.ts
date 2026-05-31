import { loadMonorepoEnv } from "./load-env";
import { requireEnv } from "./env";

loadMonorepoEnv();

import { installProcessGuards } from "./process-guards";
import { buildApp } from "./app";

installProcessGuards();

async function bootstrap() {
  const app = await buildApp();
  const port = parseInt(requireEnv("API_PORT"), 10);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`FlowDesk WA API running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
