const FIREBASE_HOST =
  /^https:\/\/[a-z0-9][a-z0-9-]*[a-z0-9]\.(web\.app|firebaseapp\.com)$/i;

const LOCAL_HOST =
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export function collectCorsAllowList(envValue?: string): Set<string> {
  const list = new Set<string>();
  const web = process.env.WEB_ORIGIN?.trim();
  if (web) list.add(web);
  if (!envValue?.trim()) return list;
  if (envValue.trim() === "*") return list;
  for (const part of envValue.split(",")) {
    const o = part.trim();
    if (o) list.add(o);
  }
  return list;
}

export function isCorsOriginAllowed(origin: string, envValue?: string): boolean {
  if (envValue?.trim() === "*") return true;
  if (FIREBASE_HOST.test(origin)) return true;
  if (LOCAL_HOST.test(origin)) return true;
  return collectCorsAllowList(envValue).has(origin);
}
