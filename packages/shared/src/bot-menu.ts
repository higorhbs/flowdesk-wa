import { getBusinessVocabulary } from "./business-vocabulary.js";

export type BotMenuAction = "APPOINTMENT" | "CATALOG" | "FAQ" | "PAYMENT" | "HUMAN" | "EXIT";

export interface BotMenuEntry {
  num: number;
  action: BotMenuAction;
  label: string;
}

function planAllowsPix(plan?: string | null): boolean {
  return plan === "PRO" || plan === "UNLIMITED";
}

export function buildBotMenuEntries(businessType?: string | null, plan?: string | null): BotMenuEntry[] {
  const v = getBusinessVocabulary(businessType);
  const entries: Omit<BotMenuEntry, "num">[] = [
    { action: "APPOINTMENT", label: v.botBookingMenuLabel },
    { action: "CATALOG", label: v.botCatalogMenuLabel },
    { action: "FAQ", label: "Dúvidas" },
    { action: "HUMAN", label: "Falar com atendente" },
  ];
  if (planAllowsPix(plan)) {
    entries.splice(2, 0, { action: "PAYMENT", label: "Pagar com PIX" });
  }
  return entries.map((e, i) => ({ num: i + 1, ...e }));
}

export function formatBotMenuText(businessName: string, businessType?: string | null, plan?: string | null): string {
  const entries = buildBotMenuEntries(businessType, plan);
  let text = `*Menu — ${businessName}*\n\n`;
  for (const e of entries) {
    text += `*${e.num}* — ${e.label}\n`;
  }
  text += `\n*0* — Sair\n\n`;
  text += `_Digite o número da opção desejada_`;
  return text;
}
