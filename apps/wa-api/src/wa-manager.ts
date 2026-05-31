import { WhatsAppManager } from "@flowdesk/whatsapp-client";

export const waManager = new WhatsAppManager();

export function isWhatsAppRuntime(): boolean {
  return true;
}
