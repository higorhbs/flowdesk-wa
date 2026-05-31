/**
 * Motor de resposta automática do FlowDesk.
 * Recebe a mensagem, detecta intenção, busca dados do negócio e retorna resposta.
 */

import {
  getBusinessForBot,
  getTenant,
  listAppointments,
  upsertConversation,
  createMessage,
  createMessages,
  updateConversationStatus,
  createAppointment,
  createPayment,
  findConflictingAppointment,
  listCustomerAppointments,
  getBusinessAsaasIntegration,
  type Conversation,
} from "@flowdesk/firebase";
import {
  APP_DISPLAY_NAME,
  detectIntent,
  isOpenNow,
  WorkingHours,
  DEFAULT_BUSINESS_TIMEZONE,
  formatCurrency,
  DAY_LABELS,
  renderTemplate,
  parseOptionNumber,
  isMenuRequest,
  isExitCommand,
  buildBotMenuEntries,
  findMatchingFaq,
  getBusinessVocabulary,
  businessRequiresBookingApproval,
  getBookingStatusLabel,
  type BotMenuAction,
  PLAN_LIMITS,
} from "@flowdesk/shared";
import { createPixCharge, resolveAsaasCredentials } from "./pix";
import { addMinutes, format } from "date-fns";
import { ptBR } from "date-fns/locale";

function voc(business: { type?: string }) {
  return getBusinessVocabulary(business.type);
}

export interface BotContext {
  businessId: string;
  customerPhone: string;
  customerName?: string;
  messageBody: string;
  replyJid?: string;
}

export interface BotResponse {
  text: string;
  imageUrl?: string;
}

// Estado simples de conversa por sessão (em memória — para MVP)
// Em produção: usar Redis com TTL
const conversationState = new Map<
  string,
  { step: string; data: Record<string, string> }
>();
const botPausedSessions = new Set<string>();

export async function processMessage(ctx: BotContext): Promise<BotResponse[]> {
  const { businessId, customerPhone, customerName, messageBody, replyJid } = ctx;
  const sessionKey = `${businessId}:${customerPhone}`;

  // Busca negócio com relacionamentos necessários
  const business = await getBusinessForBot(businessId);

  if (!business) return [{ text: "Negócio não encontrado." }];

  const conversation = await upsertConversation(
    businessId,
    customerPhone,
    customerName,
    replyJid
  );

  await createMessage(businessId, conversation.id, {
    role: "CUSTOMER",
    content: messageBody,
  });

  if (conversation.status === "ATTENDING" && !isExitCommand(messageBody))
    return [];

  const tz =
    (typeof business.timezone === "string" && business.timezone.trim()) ||
    DEFAULT_BUSINESS_TIMEZONE;
  const open = isOpenNow(business.workingHours as WorkingHours, tz);

  if (isExitCommand(messageBody)) {
    return handleBotExit(business, conversation, sessionKey);
  }

  if (botPausedSessions.has(sessionKey)) {
    botPausedSessions.delete(sessionKey);
    if (!open) {
      const faqWhenPaused = matchFaq(messageBody, business.faqs);
      if (faqWhenPaused) {
        await saveAndReturn(business.id, conversation.id, [
          { text: faqWhenPaused.answer },
        ]);
        return [{ text: faqWhenPaused.answer }];
      }
      const response = business.awayMsg;
      await saveAndReturn(business.id, conversation.id, [{ text: response }]);
      return [{ text: response }];
    }
    return sendPresentation(business, conversation, customerName);
  }

  const state = conversationState.get(sessionKey);

  if (state?.step !== "FAQ_SELECT") {
    const faqHit = matchFaq(messageBody, business.faqs);
    if (faqHit) {
      if (state) conversationState.delete(sessionKey);
      await saveAndReturn(business.id, conversation.id, [
        { text: faqHit.answer },
      ]);
      return [{ text: faqHit.answer }];
    }
  }

  if (!open) {
    const response = business.awayMsg;
    await saveAndReturn(business.id, conversation.id, [{ text: response }]);
    return [{ text: response }];
  }

  const intent = detectIntent(messageBody, business.type);

  // ─── Fluxo de agendamento (multi-step) ────────────────────────────────────
  if (state?.step === "APPOINTMENT_DATE") {
    if (isMenuRequest(messageBody) || isExitCommand(messageBody)) {
      conversationState.delete(sessionKey);
      if (isExitCommand(messageBody)) return handleBotExit(business, conversation, sessionKey);
      const menu = buildMainMenu(business);
      await saveAndReturn(business.id, conversation.id, [{ text: menu }]);
      return [{ text: menu }];
    }
    return handleAppointmentDate(ctx, business, conversation, state, sessionKey);
  }
  if (state?.step === "APPOINTMENT_TIME") {
    if (isMenuRequest(messageBody) || isExitCommand(messageBody)) {
      conversationState.delete(sessionKey);
      if (isExitCommand(messageBody)) return handleBotExit(business, conversation, sessionKey);
      const menu = buildMainMenu(business);
      await saveAndReturn(business.id, conversation.id, [{ text: menu }]);
      return [{ text: menu }];
    }
    return handleAppointmentTime(ctx, business, conversation, state, sessionKey);
  }
  if (state?.step === "PAYMENT_AMOUNT") {
    if (isMenuRequest(messageBody) || isExitCommand(messageBody)) {
      conversationState.delete(sessionKey);
      if (isExitCommand(messageBody)) return handleBotExit(business, conversation, sessionKey);
      const menu = buildMainMenu(business);
      await saveAndReturn(business.id, conversation.id, [{ text: menu }]);
      return [{ text: menu }];
    }
    return handlePaymentAmount(ctx, business, conversation, state, sessionKey);
  }
  if (state?.step === "FAQ_SELECT") {
    return handleFAQSelect(ctx, business, conversation, sessionKey);
  }

  if (isMenuRequest(messageBody)) {
    if (!isBotMenuEnabled(business)) {
      const pres = await sendPresentation(business, conversation, customerName);
      if (pres.length) return pres;
      return [];
    }
    const menu = buildMainMenu(business);
    await saveAndReturn(business.id, conversation.id, [{ text: menu }]);
    return [{ text: menu }];
  }

  const menuPick = isBotMenuEnabled(business) ? resolveMenuSelection(messageBody, business) : null;
  if (menuPick === "EXIT") {
    return handleBotExit(business, conversation, sessionKey);
  }
  if (menuPick) {
    return handleMenuItemSelection(
      menuPick,
      ctx,
      business,
      conversation,
      sessionKey,
    );
  }

  if (!state && isGreeting(messageBody)) {
    return sendPresentation(business, conversation, customerName);
  }

  if (!state && looksLikeAppointmentDate(messageBody)) {
    const apptState = { step: "APPOINTMENT_DATE", data: { serviceName: voc(business).botBookingServiceDefault } };
    conversationState.set(sessionKey, apptState);
    return handleAppointmentDate(ctx, business, conversation, apptState, sessionKey);
  }

  if (isThanks(messageBody)) {
    const text = thanksReply(business, customerName);
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  if (!isBotMenuEnabled(business) && !state) {
    return [];
  }

  // ─── Respostas por intenção ────────────────────────────────────────────────
  switch (intent) {
    case "CATALOG":
      return handleCatalog(business, conversation);

    case "MY_APPOINTMENT":
      return handleMyAppointments(ctx, business, conversation);

    case "APPOINTMENT":
      return startAppointmentFlow(business, conversation, sessionKey);

    case "QUOTE":
      return handleQuote(business, conversation);

    case "PAYMENT":
      return startPaymentFlow(ctx, business, conversation, sessionKey);

    case "FAQ":
      return handleFAQ(messageBody, business, conversation, sessionKey);

    case "HUMAN":
      await updateConversationStatus(businessId, conversation.id, "ATTENDING");
      return saveHumanHandoff(businessId, conversation.id);

    default: {
      const fallback = buildFallbackMessage(business);
      await saveAndReturn(business.id, conversation.id, [{ text: fallback }]);
      return [{ text: fallback }];
    }
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleCatalog(business: any, conversation: Conversation): Promise<BotResponse[]> {
  const v = voc(business);
  if (!business.catalog.length) {
    const text = v.botCatalogEmpty;
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  let text = `📋 *${v.botCatalogHeader} — ${business.name}*\n\n`;
  for (const item of business.catalog) {
    text += `• *${item.name}*`;
    if (item.description) text += ` — ${item.description}`;
    text += ` — *${formatCurrency(item.price)}*\n`;
  }
  text += v.botCatalogFooter;

  await saveAndReturn(business.id, conversation.id, [{ text }]);
  return [{ text }];
}

async function startAppointmentFlow(
  business: any,
  conversation: Conversation,
  sessionKey: string,
): Promise<BotResponse[]> {
  const v = voc(business);
  conversationState.set(sessionKey, {
    step: "APPOINTMENT_DATE",
    data: { serviceName: v.botBookingServiceDefault },
  });
  const text =
    `📅 *${v.botStartBookingTitle} — ${business.name}*\n\n` +
    v.botStartBookingPrompt;
  await saveAndReturn(business.id, conversation.id, [{ text }]);
  return [{ text }];
}

async function handleAppointmentDate(
  ctx: BotContext,
  business: any,
  conversation: Conversation,
  state: any,
  sessionKey: string,
): Promise<BotResponse[]> {
  const dateStr = ctx.messageBody.trim();
  // Parse simples: dd/MM
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})/);
  let date: Date | null = null;

  if (match) {
    const [, d, m] = match;
    const year = new Date().getFullYear();
    date = new Date(year, parseInt(m) - 1, parseInt(d));
  } else if (dateStr.toLowerCase().includes("amanhã")) {
    date = new Date();
    date.setDate(date.getDate() + 1);
  }

  if (!date || isNaN(date.getTime())) {
    const text =
      "Não entendi a data. Por favor, informe no formato *dd/mm* (ex: *15/06*)";
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  state.data.date = date.toISOString();
  conversationState.set(sessionKey, {
    step: "APPOINTMENT_TIME",
    data: state.data,
  });

  const text = `Data *${format(date, "dd/MM/yyyy", { locale: ptBR })}* selecionada!\n\nQual horário prefere? (ex: *10:00* ou *14:30*)`;
  await saveAndReturn(business.id, conversation.id, [{ text }]);
  return [{ text }];
}

async function handleAppointmentTime(
  ctx: BotContext,
  business: any,
  conversation: Conversation,
  state: any,
  sessionKey: string,
): Promise<BotResponse[]> {
  const timeStr = ctx.messageBody.trim();
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);

  if (!match) {
    const text =
      "Por favor, informe o horário no formato *HH:MM* (ex: *10:00*)";
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  const [, h, min] = match;
  const baseDate = new Date(state.data.date);
  baseDate.setHours(parseInt(h), parseInt(min), 0, 0);

  const durationMins = 60;
  const conflict = await findConflictingAppointment(
    business.id,
    baseDate.toISOString(),
    durationMins,
  );
  if (conflict) {
    const text =
      `⚠️ *Horário indisponível*\n\n` +
      `Já existe um agendamento em *${format(baseDate, "dd/MM/yyyy", { locale: ptBR })}* às *${format(baseDate, "HH:mm")}*.\n\n` +
      `Envie outro horário (ex: *11:00*) ou outra data.`;
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  const tenant = await getTenant(business.tenantId);
  const plan = tenant?.plan ?? "STARTER";
  const monthlyLimit = PLAN_LIMITS[plan].appointmentsPerMonth;
  if (Number.isFinite(monthlyLimit)) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ).toISOString();
    const monthAppointments = await listAppointments(business.id, { from, to });
    if (monthAppointments.length >= monthlyLimit) {
      const text =
        `Limite de agendamentos do plano *${plan}* atingido neste mês (${monthlyLimit}).\n` +
        `Faça upgrade para continuar recebendo agendamentos automáticos.`;
      await saveAndReturn(business.id, conversation.id, [{ text }]);
      return [{ text }];
    }
  }

  const v = voc(business);
  const needsApproval = businessRequiresBookingApproval(business.type);
  const appointment = await createAppointment({
    businessId: business.id,
    conversationId: conversation.id,
    customerPhone: ctx.customerPhone,
    customerName: ctx.customerName,
    serviceName: state.data.serviceName || v.botBookingServiceDefault,
    scheduledAt: baseDate.toISOString(),
    durationMins,
    status: needsApproval ? "PENDING" : "CONFIRMED",
  });

  conversationState.delete(sessionKey);

  const dateLine = `📅 Data: *${format(baseDate, "dd/MM/yyyy", { locale: ptBR })}*\n` +
    `🕐 Horário: *${format(baseDate, "HH:mm")}*\n` +
    `🔖 Código: *${appointment.id.slice(0, 8)}*\n\n`;
  const text = needsApproval
    ? `📋 *${v.botBookingAwaitingTitle}!*\n\n${dateLine}${v.botBookingAwaitingHint}\n\nPara acompanhar: *${v.botMyBookingPrompt}*.`
    : `✅ *${v.botBookingConfirmedTitle}!*\n\n${dateLine}` +
      `Para consultar depois, digite *${v.botMyBookingPrompt}*.\n\n` +
      `Te esperamos! 😊 Qualquer dúvida é só chamar.`;

  await saveAndReturn(business.id, conversation.id, [{ text }]);
  return [{ text }];
}

async function handleMyAppointments(
  ctx: BotContext,
  business: any,
  conversation: Conversation,
): Promise<BotResponse[]> {
  const v = voc(business);
  const upcoming = await listCustomerAppointments(business.id, ctx.customerPhone, {
    upcomingOnly: true,
  });

  if (!upcoming.length) {
    const past = await listCustomerAppointments(business.id, ctx.customerPhone);
    if (!past.length) {
      const text =
        `📅 Você ainda não tem ${v.bookingSingular.toLowerCase()} em *${business.name}*.\n\n` +
        `Para solicitar, use o *menu* ou digite *${v.botAppointmentKeywords[0] ?? "agendar"}*.`;
      await saveAndReturn(business.id, conversation.id, [{ text }]);
      return [{ text }];
    }
    const last = past[past.length - 1]!;
    const when = new Date(last.scheduledAt);
    const text =
      `📅 *Seu último ${v.bookingSingular.toLowerCase()}*\n\n` +
      `Item: *${last.serviceName}*\n` +
      `Data: *${format(when, "dd/MM/yyyy", { locale: ptBR })}*\n` +
      `Horário: *${format(when, "HH:mm")}*\n` +
      `Status: *${getBookingStatusLabel(business.type, last.status)}*\n` +
      `Código: *${last.id.slice(0, 8)}*\n\n` +
      `Não há ${v.bookingsPlural.toLowerCase()} futuros. Para novo, digite *${v.botAppointmentKeywords[0] ?? "agendar"}*.`;
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  const lines = upcoming.map((apt, i) => {
    const when = new Date(apt.scheduledAt);
    return (
      `*${i + 1}.* ${apt.serviceName}\n` +
      `   📅 ${format(when, "dd/MM/yyyy", { locale: ptBR })} às ${format(when, "HH:mm")}\n` +
      `   🔖 ${apt.id.slice(0, 8)} · ${getBookingStatusLabel(business.type, apt.status)}`
    );
  });

  const text =
    `📅 *Seus ${v.bookingsPlural.toLowerCase()} — ${business.name}*\n\n` +
    lines.join("\n\n") +
    `\n\nPara solicitar outro, digite *${v.botAppointmentKeywords[0] ?? "agendar"}*.`;
  await saveAndReturn(business.id, conversation.id, [{ text }]);
  return [{ text }];
}

function tenantAllowsPix(plan?: string): boolean {
  return plan === "PRO" || plan === "UNLIMITED";
}

async function pixGate(
  business: { id: string; tenantId: string; asaasConfigured?: boolean },
  conversation: Conversation
): Promise<BotResponse[] | null> {
  if (!business.asaasConfigured) {
    const text =
      `💳 Pagamento PIX ainda não está ativo neste negócio. O dono precisa conectar a conta Asaas em *Pagamentos* no painel ${APP_DISPLAY_NAME}.`;
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }
  const tenant = await getTenant(business.tenantId);
  if (!tenantAllowsPix(tenant?.plan)) {
    const text =
      `💳 Cobrança PIX automática está disponível no plano *Pro* do ${APP_DISPLAY_NAME}. O estabelecimento pode ativar em *Meu plano*.`;
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }
  return null;
}

async function startPaymentFlow(
  ctx: BotContext,
  business: { id: string; tenantId: string },
  conversation: Conversation,
  sessionKey: string
): Promise<BotResponse[]> {
  const blocked = await pixGate(business, conversation);
  if (blocked) return blocked;
  conversationState.set(sessionKey, {
    step: "PAYMENT_AMOUNT",
    data: { customerName: ctx.customerName ?? "Cliente" },
  });
  return handlePaymentStart(conversation);
}

async function handlePaymentStart(conversation: Conversation): Promise<BotResponse[]> {
  const text = "💰 *Cobrança via PIX*\n\nQual o valor? (ex: *50* ou *150,00*)";
  await saveAndReturn(conversation.businessId, conversation.id, [{ text }]);
  return [{ text }];
}

async function handlePaymentAmount(
  ctx: BotContext,
  business: any,
  conversation: Conversation,
  state: any,
  sessionKey: string,
): Promise<BotResponse[]> {
  const raw = ctx.messageBody.replace(/[R$\s]/g, "").replace(",", ".");
  const amount = parseFloat(raw);

  if (isNaN(amount) || amount <= 0) {
    const text =
      "Por favor, informe o valor corretamente (ex: *50* ou *150,00*)";
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  conversationState.delete(sessionKey);

  let responses: BotResponse[];

  try {
    const integration = await getBusinessAsaasIntegration(business.id);
    const creds = resolveAsaasCredentials(integration);
    if (!creds) {
      throw new Error("Conta Asaas não conectada. Configure em Pagamentos no painel.");
    }

    const pix = await createPixCharge(
      {
        customerName: state.data.customerName ?? ctx.customerName ?? "Cliente",
        customerPhone: ctx.customerPhone,
        description: `Sinal - ${business.name}`,
        amount,
        externalRef: conversation.id,
      },
      creds
    );

    await createPayment({
      businessId: business.id,
      conversationId: conversation.id,
      customerPhone: ctx.customerPhone,
      customerName: ctx.customerName,
      description: `Sinal - ${business.name}`,
      amount,
      pixQrCode: pix.pixQrCode,
      pixCopyPaste: pix.pixCopyPaste,
      asaasId: pix.asaasId,
      status: "PENDING",
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const text =
      `💳 *PIX gerado com sucesso!*\n\n` +
      `Valor: *${formatCurrency(amount)}*\n\n` +
      `*Copia e cola:*\n\`${pix.pixCopyPaste}\`\n\n` +
      `O QR Code foi enviado na mensagem anterior. Validade: 3 dias.`;

    responses = [{ text, imageUrl: `data:image/png;base64,${pix.pixQrCode}` }];
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Erro ao gerar PIX.";
    const text =
      `❌ Não foi possível gerar o PIX de *${formatCurrency(amount)}*.\n\n` +
      `${reason}\n\n` +
      `Tente novamente ou digite *menu*.`;
    responses = [{ text }];
  }

  await saveAndReturn(business.id, conversation.id, responses);
  return responses;
}

async function handleQuote(
  business: any,
  conversation: Conversation,
): Promise<BotResponse[]> {
  if (!business.catalog.length) {
    const text =
      "Você pode nos enviar mais detalhes sobre o que precisa para prepararmos um orçamento personalizado!";
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  let text = `💰 *Tabela de Preços - ${business.name}*\n\n`;
  for (const item of business.catalog) {
    text += `• *${item.name}*: ${formatCurrency(item.price)}\n`;
    if (item.description) text += `  _${item.description}_\n`;
  }
  const v = voc(business);
  text += `\n\nPara ${v.bookingsPlural.toLowerCase()}, use o *menu* ou digite *${v.botAppointmentKeywords[0] ?? "agendar"}*.`;

  await saveAndReturn(business.id, conversation.id, [{ text }]);
  return [{ text }];
}

async function handleFAQ(
  messageBody: string,
  business: any,
  conversation: Conversation,
  sessionKey: string,
): Promise<BotResponse[]> {
  if (!business.faqs?.length) {
    const text =
      `Ainda não há perguntas no *FAQ*.\n\nCadastre no painel ${APP_DISPLAY_NAME} (menu FAQ) para a IA responder automaticamente.`;
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  const faq = matchFaq(messageBody, business.faqs);
  if (faq) {
    await saveAndReturn(business.id, conversation.id, [{ text: faq.answer }]);
    return [{ text: faq.answer }];
  }

  let text = `❓ *FAQ — ${business.name}*\n\n`;
  business.faqs.forEach((f: any, i: number) => {
    text += `${i + 1}. ${f.question}\n`;
  });
  text += "\nDigite o *número* da pergunta (ex: *1*) ou escreva sua dúvida:";

  conversationState.set(sessionKey, { step: "FAQ_SELECT", data: {} });
  await saveAndReturn(business.id, conversation.id, [{ text }]);
  return [{ text }];
}

async function handleFAQSelect(
  ctx: BotContext,
  business: any,
  conversation: Conversation,
  sessionKey: string,
): Promise<BotResponse[]> {
  const faqs = business.faqs ?? [];
  const choice = parseOptionNumber(ctx.messageBody, 1, faqs.length);

  if (choice === null) {
    const byKeyword = matchFaq(ctx.messageBody, faqs);
    if (byKeyword) {
      conversationState.delete(sessionKey);
      await saveAndReturn(business.id, conversation.id, [
        { text: byKeyword.answer },
      ]);
      return [{ text: byKeyword.answer }];
    }
    const text = `Digite o *número* de *1* a *${faqs.length}* ou *menu* para voltar.`;
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  const faq = faqs[choice - 1];
  conversationState.delete(sessionKey);
  await saveAndReturn(business.id, conversation.id, [{ text: faq.answer }]);
  return [{ text: faq.answer }];
}

type MenuPick = {
  num: number;
  label: string;
  response?: string;
  enabled?: boolean;
  emoji?: string;
  action?: BotMenuAction;
};

function getEnabledMenuEntries(business?: {
  botMenu?: unknown[];
  botMenuEnabled?: boolean;
  type?: string;
  asaasConfigured?: boolean;
  tenantPlan?: string;
}): MenuPick[] {
  if (business?.botMenuEnabled === false) return [];
  let entries: MenuPick[];
  if (business?.botMenu && Array.isArray(business.botMenu) && business.botMenu.length > 0) {
    entries = (business.botMenu as MenuPick[]).filter((e) => e.enabled !== false);
  } else {
    entries = buildBotMenuEntries(business?.type, business?.tenantPlan).map((e) => ({
      num: e.num,
      label: e.label,
      response: legacyMenuResponse(e.action, business?.type),
      action: e.action,
      enabled: true,
    }));
  }
  return ensurePixMenuEntry(entries, business?.asaasConfigured, business?.tenantPlan);
}

function ensurePixMenuEntry(entries: MenuPick[], asaasConfigured?: boolean, tenantPlan?: string): MenuPick[] {
  const allowsPix = tenantPlan === "PRO" || tenantPlan === "UNLIMITED";
  const filtered = allowsPix
    ? entries
    : entries.filter((e) => e.action !== "PAYMENT" && !/pix|pagar|pagamento|sinal/i.test(`${e.label} ${e.response ?? ""}`));
  if (!asaasConfigured || !allowsPix) return filtered;
  const hasPix = filtered.some(
    (e) => e.action === "PAYMENT" || /pix|pagar|pagamento|sinal/i.test(`${e.label} ${e.response ?? ""}`)
  );
  if (hasPix) return filtered;
  const maxNum = filtered.reduce((m, e) => Math.max(m, e.num), 0);
  return [
    ...filtered,
    {
      num: maxNum + 1,
      label: "Pagar com PIX",
      response: "Qual o valor? (ex: *50* ou *150,00*)",
      action: "PAYMENT",
      enabled: true,
      emoji: "💳",
    },
  ];
}

function legacyMenuResponse(action: BotMenuAction, businessType?: string): string {
  const v = getBusinessVocabulary(businessType);
  const map: Record<BotMenuAction, string> = {
    APPOINTMENT: v.botLegacyAppointmentHint,
    CATALOG: v.botLegacyCatalogHint,
    PAYMENT: "Qual o valor? (ex: *50* ou *150,00*)",
    FAQ: "Envie sua dúvida em texto ou digite *dúvida* para ver as perguntas frequentes.",
    HUMAN: "Certo! Vou chamar um atendente. Aguarde um momento... 👤",
    EXIT: "",
  };
  return map[action] ?? "";
}

function resolveMenuSelection(
  text: string,
  business?: { botMenu?: unknown[]; name?: string },
): MenuPick | "EXIT" | null {
  if (isExitCommand(text) || parseOptionNumber(text, 0, 0) === 0) return "EXIT";
  const entries = getEnabledMenuEntries(business);
  if (!entries.length) return null;
  const num = parseOptionNumber(text, 1, entries.length);
  if (num === null) return null;
  return entries[num - 1] ?? null;
}

function isAppointmentMenuItem(item: MenuPick, businessType?: string): boolean {
  if (item.action === "APPOINTMENT") return true;
  const r = (item.response ?? "").toLowerCase();
  const v = getBusinessVocabulary(businessType);
  const hints = [
    ...v.botAppointmentKeywords,
    "informe a data",
    "dd/mm",
    "qual data",
    "marque",
    "reservar",
    "horário prefere",
    "horario prefere",
    "pedido",
    "consulta",
  ];
  return hints.some((h) => r.includes(h));
}

function isCatalogMenuItem(item: MenuPick, businessType?: string): boolean {
  if (item.action === "CATALOG") return true;
  const r = (item.response ?? "").toLowerCase();
  const v = getBusinessVocabulary(businessType);
  return v.botCatalogKeywords.some((k) => r.includes(k));
}

function isFaqMenuItem(item: MenuPick): boolean {
  if (item.action === "FAQ") return true;
  const r = (item.response ?? "").toLowerCase();
  return /\bfaq\b|perguntas frequentes|dúvida|duvida/.test(r);
}

function isHumanMenuItem(item: MenuPick): boolean {
  if (item.action === "HUMAN") return true;
  const r = (item.response ?? "").toLowerCase();
  return /atendente|humano|pessoa/.test(r);
}

function isPaymentMenuItem(item: MenuPick): boolean {
  if (item.action === "PAYMENT") return true;
  const r = `${item.label} ${item.response ?? ""}`.toLowerCase();
  return /pix|pagar|pagamento|sinal/.test(r);
}

async function handleMenuItemSelection(
  item: MenuPick,
  ctx: BotContext,
  business: any,
  conversation: Conversation,
  sessionKey: string,
): Promise<BotResponse[]> {
  if (isAppointmentMenuItem(item, business.type)) {
    return startAppointmentFlow(business, conversation, sessionKey);
  }
  if (isCatalogMenuItem(item, business.type)) {
    return handleCatalog(business, conversation);
  }
  if (isFaqMenuItem(item)) {
    return handleFAQ(ctx.messageBody, business, conversation, sessionKey);
  }
  if (isPaymentMenuItem(item)) {
    return startPaymentFlow(ctx, business, conversation, sessionKey);
  }
  if (isHumanMenuItem(item)) {
    await updateConversationStatus(business.id, conversation.id, "ATTENDING");
    return saveHumanHandoff(business.id, conversation.id);
  }

  const custom = item.response?.trim();
  if (custom) {
    const text = renderTemplate(custom, {
      nome: ctx.customerName ?? "cliente",
      negocio: business.name,
    });
    await saveAndReturn(business.id, conversation.id, [{ text }]);
    return [{ text }];
  }

  if (item.action && item.action !== "EXIT") {
    return routeMenuAction(
      item.action,
      ctx,
      business,
      conversation,
      sessionKey,
    );
  }

  const fallback =
    "Opção em configuração. Digite *menu* para ver outras opções.";
  await saveAndReturn(business.id, conversation.id, [{ text: fallback }]);
  return [{ text: fallback }];
}

async function routeMenuAction(
  action: BotMenuAction,
  ctx: BotContext,
  business: any,
  conversation: Conversation,
  sessionKey: string,
): Promise<BotResponse[]> {
  switch (action) {
    case "EXIT":
      return handleBotExit(business, conversation, sessionKey);
    case "CATALOG":
      return handleCatalog(business, conversation);
    case "APPOINTMENT":
      return startAppointmentFlow(business, conversation, sessionKey);
    case "FAQ":
      return handleFAQ(ctx.messageBody, business, conversation, sessionKey);
    case "PAYMENT":
      return startPaymentFlow(ctx, business, conversation, sessionKey);
    case "HUMAN":
      await updateConversationStatus(business.id, conversation.id, "ATTENDING");
      return saveHumanHandoff(business.id, conversation.id);
    default:
      return [{ text: buildMainMenu(business) }];
  }
}

async function saveHumanHandoff(
  businessId: string,
  conversationId: string,
): Promise<BotResponse[]> {
  const msg = "Certo! Vou chamar um atendente. Aguarde um momento... 👤";
  await saveAndReturn(businessId, conversationId, [{ text: msg }]);
  return [{ text: msg }];
}

async function handleBotExit(
  business: any,
  conversation: Conversation,
  sessionKey: string,
): Promise<BotResponse[]> {
  conversationState.delete(sessionKey);
  botPausedSessions.add(sessionKey);
  if (conversation.status === "ATTENDING") {
    await updateConversationStatus(business.id, conversation.id, "OPEN");
  }
  const text =
    "👋 *Atendimento automático encerrado.*\n\n" +
    (isBotMenuEnabled(business)
      ? "Quando quiser voltar, envie qualquer mensagem que eu te apresento o menu novamente."
      : "Quando quiser voltar, envie qualquer mensagem ou sua dúvida.");
  await saveAndReturn(business.id, conversation.id, [{ text }]);
  return [{ text }];
}

function isBotMenuEnabled(business?: { botMenuEnabled?: boolean }): boolean {
  return business?.botMenuEnabled !== false;
}

function isGreetingEnabled(business?: { greetingEnabled?: boolean; greetingMsg?: string }): boolean {
  if (business?.greetingEnabled === false) return false;
  return Boolean(business?.greetingMsg?.trim());
}

function thanksReply(business: { name: string; thanksMsg?: string; botMenuEnabled?: boolean }, customerName?: string): string {
  const vars = { nome: customerName ?? "cliente", negocio: business.name };
  const custom = business.thanksMsg?.trim();
  if (custom) return renderTemplate(custom, vars);
  if (isBotMenuEnabled(business)) {
    return renderTemplate("Por nada! 😊 Se precisar de algo, digite *menu*.", vars);
  }
  return renderTemplate("Por nada! 😊 Se tiver outra dúvida, é só enviar.", vars);
}

async function sendPresentation(
  business: any,
  conversation: Conversation,
  customerName?: string,
): Promise<BotResponse[]> {
  const out: BotResponse[] = [];

  if (isGreetingEnabled(business)) {
    const text = renderTemplate(business.greetingMsg, {
      nome: customerName ?? "cliente",
      negocio: business.name,
    });
    out.push({ text });
  }

  if (isBotMenuEnabled(business)) {
    const menu = buildMainMenu(business);
    if (menu.trim()) out.push({ text: menu });
  }

  if (!out.length) return [];

  await saveAndReturn(business.id, conversation.id, out);
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMainMenu(business: {
  name: string;
  botMenu?: unknown[];
  botMenuEnabled?: boolean;
}): string {
  if (!isBotMenuEnabled(business)) return "";
  const entries = getEnabledMenuEntries(business).map((e, i) => ({
    ...e,
    num: i + 1,
  }));
  if (!entries.length) {
    return (
      `*${business.name}*\n\n` +
      `_Menu ainda não configurado no painel. Enquanto isso, envie sua mensagem que a IA tenta ajudar._`
    );
  }
  let text = `*Menu — ${business.name}*\n\n`;
  for (const e of entries) {
    const prefix = e.emoji ? `${e.emoji} ` : "";
    text += `*${e.num}* — ${prefix}${e.label}\n`;
  }
  text += `\n*0* — 👋 Sair\n\n`;
  text += `_Digite o número da opção desejada_`;
  return text;
}

function buildFallbackMessage(business?: { botMenu?: unknown[]; botMenuEnabled?: boolean }): string {
  if (!isBotMenuEnabled(business)) {
    return "Não encontrei uma resposta. Reformule sua pergunta ou use palavras das FAQs cadastradas.";
  }
  const n = getEnabledMenuEntries(business).length;
  if (n > 0) {
    return `Não entendi. 😅\n\nDigite um número de *1* a *${n}*, *menu* ou *sair*.`;
  }
  return "Não entendi. 😅\n\nDigite *menu* ou descreva o que precisa.";
}

function isGreeting(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/^[!?.,"']+|[!?.,"']+$/g, "");
  if (!normalized) return false;

  const greetings = [
    "oi",
    "olá",
    "ola",
    "bom dia",
    "boa tarde",
    "boa noite",
    "hello",
    "hi",
    "hey",
    "e aí",
    "e ai",
    "salve",
    "menu",
  ];

  return greetings.some(
    (g) => normalized === g || normalized.startsWith(`${g} `) || normalized.startsWith(`${g},`)
  );
}

function looksLikeAppointmentDate(text: string): boolean {
  return /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(text.trim());
}

function isThanks(text: string): boolean {
  const t = text.toLowerCase().trim();
  return ["obrigado", "obrigada", "valeu", "vlw", "brigadão", "brigadao"].some((w) => t.includes(w));
}

function matchFaq(text: string, faqs: any[] | undefined): any | null {
  if (!text.trim() || !faqs?.length) return null;
  return findMatchingFaq(text, faqs);
}

async function saveAndReturn(
  businessId: string,
  conversationId: string,
  responses: BotResponse[],
): Promise<void> {
  await createMessages(
    businessId,
    conversationId,
    responses.map((r) => ({ role: "IA", content: r.text })),
  );
}
