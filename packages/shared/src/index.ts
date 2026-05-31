import { getIntentKeywordsForType } from "./business-vocabulary.js";

// ─── Intent detection keywords ────────────────────────────────────────────────

export const INTENT_KEYWORDS = {
  CATALOG: ["cardápio", "catálogo", "catalogo", "menu", "serviços", "produtos", "o que vocês fazem", "o que voces fazem"],
  MY_APPOINTMENT: [
    "meu agendamento",
    "ver agendamento",
    "ver meu agendamento",
    "consultar agendamento",
    "agendamento marcado",
    "qual meu horario",
    "qual meu horário",
    "horario marcado",
    "horário marcado",
  ],
  APPOINTMENT: ["agendamentos", "agendamento", "agendar", "marcar", "horário disponível", "horario disponivel", "quando tem", "quero marcar", "reservar", "agenda"],
  QUOTE: ["orçamento", "orcamento", "quanto custa", "valor", "preço", "preco", "tabela de preços"],
  PAYMENT: ["pix", "pagar", "pagamento", "sinal", "entrada", "link de pagamento"],
  FAQ: ["faq", "dúvida", "duvida", "perguntas", "horário", "horario", "onde fica", "endereço", "endereco", "funcionamento", "abre", "fecha", "telefone", "contato"],
  HUMAN: ["falar com atendente", "falar com humano", "atendente", "pessoa", "responsável"],
  CANCEL: ["cancelar", "desmarcar", "cancelamento"],
  CONFIRM: ["confirmar", "confirmo", "sim", "ok", "pode ser", "certo"],
} as const;

export type Intent = keyof typeof INTENT_KEYWORDS;

const INTENT_DETECT_ORDER: Intent[] = [
  "MY_APPOINTMENT",
  "APPOINTMENT",
  "CATALOG",
  "QUOTE",
  "PAYMENT",
  "FAQ",
  "HUMAN",
  "CANCEL",
  "CONFIRM",
];

export function detectIntent(text: string, businessType?: string | null): Intent | null {
  const normalized = text.toLowerCase().trim();
  const typeKw = businessType ? getIntentKeywordsForType(businessType) : null;

  for (const intent of INTENT_DETECT_ORDER) {
    const base = INTENT_KEYWORDS[intent] as readonly string[];
    const extra =
      typeKw && intent in typeKw
        ? typeKw[intent as keyof typeof typeKw]
        : [];
    const keywords = [...base, ...extra];
    if (keywords.some((kw) => normalized.includes(kw))) return intent;
  }
  return null;
}

export function appointmentsOverlap(
  startA: Date,
  durationMinsA: number,
  startB: Date,
  durationMinsB: number
): boolean {
  const endA = startA.getTime() + durationMinsA * 60_000;
  const endB = startB.getTime() + durationMinsB * 60_000;
  return startA.getTime() < endB && startB.getTime() < endA;
}

export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export {
  normalizeFaqText,
  findMatchingFaq,
  faqEntryMatches,
  faqTextsMatch,
  wordsSimilar,
  type FaqMatchInput,
} from "./faq-match.js";

export function phonesMatch(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return da.endsWith(db) || db.endsWith(da);
}

export function customerConversationKey(phone: string): string {
  const raw = phone.trim().toLowerCase();
  if (raw.includes("@lid")) {
    const id = raw.split("@")[0]?.replace(/\D/g, "") ?? "";
    return id ? `lid:${id}` : raw;
  }
  const digits = phoneDigits(raw);
  if (digits.length >= 10) return `tel:${digits.slice(-11)}`;
  return digits ? `tel:${digits}` : raw;
}

export function formatCustomerLabel(phone: string, name?: string | null): string {
  if (name?.trim()) return name.trim();
  const raw = phone.trim();
  if (raw.includes("@lid")) return "Contato WhatsApp";
  return formatPhone(raw);
}

/** Opção numérica do menu WhatsApp (ex: "1", "2.", "3)") */
export function parseOptionNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  const direct = trimmed.match(/^(\d{1,2})[\.\)\s]*$/);
  if (direct) {
    const n = parseInt(direct[1], 10);
    return n >= min && n <= max ? n : null;
  }
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (!digitsOnly || digitsOnly.length > 2) return null;
  if (trimmed.replace(/[\d\s\.\)\-]/g, "").length > 0) return null;
  const n = parseInt(digitsOnly, 10);
  return !Number.isNaN(n) && n >= min && n <= max ? n : null;
}

export function isExitCommand(text: string): boolean {
  const t = text.toLowerCase().trim();
  return ["sair", "exit", "parar", "encerrar", "fim", "#sair"].includes(t);
}

export function isMenuRequest(text: string): boolean {
  const t = text.toLowerCase().trim();
  return ["menu", "opções", "opcoes", "opção", "opcao", "ajuda", "voltar", "início", "inicio"].some(
    (w) => t === w || t.startsWith(`${w} `)
  );
}

// ─── Formatação de mensagens ───────────────────────────────────────────────────

export function formatCurrency(value: number | string): string {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13) {
    // +55 11 99999-9999
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return phone;
}

export function parseWhatsAppPhone(jid: string): string {
  return jid.split("@")[0];
}

// ─── Horário de funcionamento ─────────────────────────────────────────────────

export type WorkingHours = {
  [day: string]: [string, string] | null; // ["09:00", "18:00"] ou null = fechado
};

export const DAY_LABELS: Record<string, string> = {
  sun: "Domingo",
  mon: "Segunda",
  tue: "Terça",
  wed: "Quarta",
  thu: "Quinta",
  fri: "Sexta",
  sat: "Sábado",
};

const DAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const WEEKDAY_TO_KEY: Record<string, string> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

export const DEFAULT_BUSINESS_TIMEZONE = "America/Sao_Paulo";

export function getLocalTimeParts(
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
  date = new Date()
): { day: string; hours: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
  const day = WEEKDAY_TO_KEY[parts.weekday ?? ""] ?? DAY_ORDER[date.getUTCDay()];
  return {
    day,
    hours: Number(parts.hour ?? 0),
    minutes: Number(parts.minute ?? 0),
  };
}

export function isOpenNow(
  workingHours: WorkingHours,
  timeZone = DEFAULT_BUSINESS_TIMEZONE
): boolean {
  const { day, hours, minutes } = getLocalTimeParts(timeZone);
  const slot = workingHours[day];
  if (!slot) return false;

  const [openH, openM] = slot[0].split(":").map(Number);
  const [closeH, closeM] = slot[1].split(":").map(Number);

  const currentMinutes = hours * 60 + minutes;
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

// ─── Template helpers ─────────────────────────────────────────────────────────

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// ─── Planos ───────────────────────────────────────────────────────────────────

export const PLAN_LIMITS = {
  STARTER: { phones: 1, messagesPerMonth: 500, catalogItems: 3, appointmentsPerMonth: 30 },
  PRO: { phones: 3, messagesPerMonth: 5000, catalogItems: 100, appointmentsPerMonth: 500 },
  UNLIMITED: {
    phones: 10,
    messagesPerMonth: Infinity,
    catalogItems: Infinity,
    appointmentsPerMonth: Infinity,
  },
} as const;

export type PlanTier = keyof typeof PLAN_LIMITS;

export function formatPlanLimit(value: number): string {
  if (!Number.isFinite(value)) return "Ilimitado";
  return value.toLocaleString("pt-BR");
}

export function planMarketingFeatures(plan: PlanTier): string[] {
  const l = PLAN_LIMITS[plan];
  return [
    `${l.phones} número${l.phones > 1 ? "s" : ""} WhatsApp`,
    l.messagesPerMonth === Infinity
      ? "Mensagens ilimitadas"
      : `${formatPlanLimit(l.messagesPerMonth)} mensagens/mês`,
    `${formatPlanLimit(l.catalogItems)} itens no catálogo`,
    `${formatPlanLimit(l.appointmentsPerMonth)} agendamentos/mês`,
  ];
}

export const PLAN_PRICES = {
  STARTER: { brl: 9.99, label: "Starter" },
  PRO: { brl: 99, label: "Pro" },
  UNLIMITED: { brl: 199, label: "Unlimited" },
} as const;

export * from "./brand.js";
export * from "./bot-menu.js";
export * from "./business-vocabulary.js";
export * from "./message-role.js";
export * from "./trial.js";
