export type MessageRole = "CUSTOMER" | "IA" | "HUMAN";

export const IA_DISPLAY_NAME = "IA";

export function isIaMessageRole(role: string): boolean {
  return role === "IA" || role === "BOT";
}
