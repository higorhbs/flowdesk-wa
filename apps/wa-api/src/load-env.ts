import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

function loadEnvFile(filePath: string) {
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadMonorepoEnv() {
  const candidates = [
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), ".env"),
  ];
  for (const filePath of candidates) {
    if (existsSync(filePath)) loadEnvFile(filePath);
  }
}
