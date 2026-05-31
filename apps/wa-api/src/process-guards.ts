function isBaileysTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message !== "Timed Out") return false;
  const boom = err as Error & { output?: { statusCode?: number } };
  return boom.output?.statusCode === 408;
}

export function installProcessGuards() {
  process.on("unhandledRejection", (reason) => {
    if (isBaileysTimeout(reason)) {
      console.error("[api] baileys timeout ignorado (unhandledRejection)");
      return;
    }
    console.error("[api] unhandledRejection:", reason);
  });

  process.on("uncaughtException", (err) => {
    if (isBaileysTimeout(err)) {
      console.error("[api] baileys timeout ignorado (uncaughtException)");
      return;
    }
    console.error("[api] uncaughtException:", err);
    process.exit(1);
  });
}
