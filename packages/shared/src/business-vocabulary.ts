import { APP_DISPLAY_NAME } from "./brand.js";

export const BUSINESS_TYPE_ORDER = [
  "STORE",
  "BARBERSHOP",
  "SALON",
  "RESTAURANT",
  "DENTAL",
  "OTHER",
] as const;

export type BusinessType = (typeof BUSINESS_TYPE_ORDER)[number];

export interface BusinessVocabulary {
  typeLabel: string;
  bookingsNav: string;
  bookingsNavShort: string;
  bookingsPageTitle: string;
  bookingSingular: string;
  bookingsPlural: string;
  bookingsSectionDesc: string;
  catalogNav: string;
  catalogNavShort: string;
  catalogPageTitle: string;
  catalogPageSubtitle: string;
  catalogItemSingular: string;
  catalogItemPlural: string;
  catalogEmptyTitle: string;
  catalogEmptyHint: string;
  catalogLimitToast: string;
  catalogPanelMenu: string;
  botBookingMenuLabel: string;
  botCatalogMenuLabel: string;
  botStartBookingTitle: string;
  botStartBookingPrompt: string;
  botBookingConfirmedTitle: string;
  botBookingServiceDefault: string;
  botMyBookingPrompt: string;
  botCatalogEmpty: string;
  botCatalogHeader: string;
  botCatalogFooter: string;
  botLegacyAppointmentHint: string;
  botLegacyCatalogHint: string;
  botAppointmentKeywords: string[];
  botMyBookingKeywords: string[];
  botCatalogKeywords: string[];
  bookingRequiresApproval: boolean;
  bookingAcceptLabel: string;
  bookingRejectLabel: string;
  bookingPendingSectionTitle: string;
  botBookingAwaitingTitle: string;
  botBookingAwaitingHint: string;
  botBookingAcceptedNotify: string;
  bookingStatusPending: string;
  bookingStatusConfirmed: string;
}

const DEFAULT: BusinessVocabulary = {
  typeLabel: "Negócio",
  bookingsNav: "Agendamentos",
  bookingsNavShort: "Agenda",
  bookingsPageTitle: "Agendamentos",
  bookingSingular: "Agendamento",
  bookingsPlural: "Agendamentos",
  bookingsSectionDesc: "Agenda e horários",
  catalogNav: "Catálogo",
  catalogNavShort: "Catálogo",
  catalogPageTitle: "Catálogo",
  catalogPageSubtitle: "Itens exibidos quando o cliente pede o catálogo ou orçamento",
  catalogItemSingular: "item",
  catalogItemPlural: "itens",
  catalogEmptyTitle: "Nenhum item no catálogo",
  catalogEmptyHint: "Adicione serviços ou produtos para a IA enviar no WhatsApp.",
  catalogLimitToast: "itens no catálogo",
  catalogPanelMenu: "Catálogo",
  botBookingMenuLabel: "Agendamentos",
  botCatalogMenuLabel: "Catálogo",
  botStartBookingTitle: "Agendamentos",
  botStartBookingPrompt: "Qual data você prefere? (ex: *15/06* ou *amanhã*)",
  botBookingConfirmedTitle: "Agendamento confirmado",
  botBookingServiceDefault: "Agendamento",
  botMyBookingPrompt: "meu agendamento",
  botCatalogEmpty:
    `Ainda não há itens no *Catálogo*.\n\nCadastre no painel ${APP_DISPLAY_NAME} (menu Catálogo) para exibir aqui.`,
  botCatalogHeader: "Catálogo",
  botCatalogFooter:
    "\nPara agendar, digite *agendar* ou escolha a opção de agendamentos no *menu*.\nPara ver seu horário: *meu agendamento*.",
  botLegacyAppointmentHint: "Para agendar, informe a data (ex: *15/06*) ou digite *agendar*.",
  botLegacyCatalogHint: "Confira nosso catálogo — digite *catálogo* ou *preços*.",
  botAppointmentKeywords: [
    "agendamentos",
    "agendamento",
    "agendar",
    "marcar",
    "horário disponível",
    "horario disponivel",
    "reservar",
    "agenda",
  ],
  botMyBookingKeywords: [
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
  botCatalogKeywords: ["cardápio", "catálogo", "catalogo", "menu", "serviços", "produtos", "preços", "precos"],
  bookingRequiresApproval: false,
  bookingAcceptLabel: "Aceitar agendamento",
  bookingRejectLabel: "Recusar",
  bookingPendingSectionTitle: "Aguardando sua confirmação",
  botBookingAwaitingTitle: "Solicitação registrada",
  botBookingAwaitingHint: "Você receberá uma mensagem quando for confirmado.",
  botBookingAcceptedNotify: "Seu agendamento foi confirmado",
  bookingStatusPending: "Pendente",
  bookingStatusConfirmed: "Confirmado",
};

const BY_TYPE: Record<BusinessType, BusinessVocabulary> = {
  BARBERSHOP: {
    ...DEFAULT,
    typeLabel: "Barbearia",
    catalogItemSingular: "serviço",
  },
  SALON: {
    ...DEFAULT,
    typeLabel: "Salão / Manicure",
    catalogItemSingular: "serviço",
  },
  RESTAURANT: {
    ...DEFAULT,
    typeLabel: "Restaurante",
    bookingRequiresApproval: true,
    bookingAcceptLabel: "Aceitar pedido",
    bookingRejectLabel: "Recusar pedido",
    bookingPendingSectionTitle: "Pedidos aguardando aceite",
    botBookingAwaitingTitle: "Pedido recebido",
    botBookingAwaitingHint: "O restaurante vai confirmar seu pedido em breve por aqui.",
    botBookingAcceptedNotify: "Seu pedido foi aceito",
    bookingStatusPending: "Aguardando aceite",
    bookingStatusConfirmed: "Pedido aceito",
    bookingsNav: "Pedidos",
    bookingsNavShort: "Pedidos",
    bookingsPageTitle: "Pedidos",
    bookingSingular: "Pedido",
    bookingsPlural: "Pedidos",
    bookingsSectionDesc: "Pedidos e retiradas",
    catalogNav: "Cardápio",
    catalogNavShort: "Cardápio",
    catalogPageTitle: "Cardápio",
    catalogPageSubtitle: "Pratos e itens enviados quando o cliente pede o cardápio",
    catalogItemSingular: "item",
    catalogItemPlural: "itens",
    catalogEmptyTitle: "Nenhum item no cardápio",
    catalogEmptyHint: "Cadastre pratos e bebidas para a IA enviar no WhatsApp.",
    catalogLimitToast: "itens no cardápio",
    catalogPanelMenu: "Cardápio",
    botBookingMenuLabel: "Fazer pedido",
    botCatalogMenuLabel: "Cardápio",
    botStartBookingTitle: "Pedidos",
    botStartBookingPrompt: "Para qual dia é o pedido? (ex: *15/06* ou *hoje*)",
    botBookingConfirmedTitle: "Pedido registrado",
    botBookingServiceDefault: "Pedido",
    botMyBookingPrompt: "meu pedido",
    botCatalogEmpty:
      `Ainda não há itens no *Cardápio*.\n\nCadastre pratos no painel ${APP_DISPLAY_NAME} (menu Cardápio).`,
    botCatalogHeader: "Cardápio",
    botCatalogFooter:
      "\nPara pedir, digite *pedido* ou escolha a opção no *menu*.\nPara ver seu pedido: *meu pedido*.",
    botLegacyAppointmentHint: "Para fazer um pedido, informe o dia (ex: *15/06*) ou digite *pedido*.",
    botLegacyCatalogHint: "Veja nosso cardápio — digite *cardápio* ou *menu*.",
    botAppointmentKeywords: [
      "pedido",
      "pedidos",
      "fazer pedido",
      "quero pedir",
      "encomenda",
      "delivery",
      "retirada",
      "agendar",
    ],
    botMyBookingKeywords: [
      "meu pedido",
      "ver pedido",
      "status do pedido",
      "pedido marcado",
      "onde está meu pedido",
    ],
    botCatalogKeywords: ["cardápio", "cardapio", "menu", "pratos", "o que tem", "preços", "precos"],
  },
  DENTAL: {
    ...DEFAULT,
    typeLabel: "Clínica",
    bookingRequiresApproval: true,
    bookingAcceptLabel: "Aceitar consulta",
    bookingRejectLabel: "Recusar consulta",
    bookingPendingSectionTitle: "Consultas aguardando aceite",
    botBookingAwaitingTitle: "Consulta solicitada",
    botBookingAwaitingHint: "A clínica vai confirmar sua consulta em breve por aqui.",
    botBookingAcceptedNotify: "Sua consulta foi confirmada",
    bookingStatusPending: "Aguardando aceite",
    bookingStatusConfirmed: "Consulta confirmada",
    bookingsNav: "Consultas",
    bookingsNavShort: "Consultas",
    bookingsPageTitle: "Consultas",
    bookingSingular: "Consulta",
    bookingsPlural: "Consultas",
    bookingsSectionDesc: "Agenda de consultas",
    catalogNav: "Serviços",
    catalogNavShort: "Serviços",
    catalogPageTitle: "Serviços e tratamentos",
    catalogPageSubtitle: "Procedimentos exibidos no WhatsApp",
    catalogItemSingular: "serviço",
    catalogEmptyHint: "Cadastre tratamentos e valores para a IA enviar no WhatsApp.",
    catalogPanelMenu: "Serviços",
    botBookingMenuLabel: "Agendar consulta",
    botCatalogMenuLabel: "Serviços",
    botStartBookingTitle: "Consultas",
    botStartBookingPrompt: "Qual data você prefere para a consulta? (ex: *15/06*)",
    botBookingConfirmedTitle: "Consulta confirmada",
    botBookingServiceDefault: "Consulta",
    botMyBookingPrompt: "minha consulta",
    botCatalogEmpty:
      `Ainda não há *serviços* cadastrados.\n\nAdicione no painel ${APP_DISPLAY_NAME} (menu Serviços).`,
    botCatalogHeader: "Serviços",
    botCatalogFooter:
      "\nPara agendar consulta, digite *agendar* ou use o *menu*.\nPara ver sua consulta: *minha consulta*.",
    botLegacyAppointmentHint: "Para agendar consulta, informe a data (ex: *15/06*) ou digite *agendar*.",
    botLegacyCatalogHint: "Confira nossos serviços — digite *serviços* ou *valores*.",
    botAppointmentKeywords: ["consulta", "consultas", "agendar consulta", "marcar consulta", "agendar", "marcar"],
    botMyBookingKeywords: [
      "minha consulta",
      "meu agendamento",
      "ver consulta",
      "consulta marcada",
      "horário da consulta",
    ],
    botCatalogKeywords: ["serviços", "servicos", "tratamentos", "valores", "preços", "precos", "procedimentos"],
  },
  STORE: {
    ...DEFAULT,
    typeLabel: "Comércio",
    bookingRequiresApproval: true,
    bookingAcceptLabel: "Aceitar pedido",
    bookingRejectLabel: "Recusar pedido",
    bookingPendingSectionTitle: "Pedidos aguardando aceite",
    botBookingAwaitingTitle: "Pedido recebido",
    botBookingAwaitingHint: "A loja vai confirmar seu pedido em breve por aqui.",
    botBookingAcceptedNotify: "Seu pedido foi aceito",
    bookingStatusPending: "Aguardando aceite",
    bookingStatusConfirmed: "Pedido aceito",
    bookingsNav: "Pedidos",
    bookingsNavShort: "Pedidos",
    bookingsPageTitle: "Pedidos",
    bookingSingular: "Pedido",
    bookingsPlural: "Pedidos",
    bookingsSectionDesc: "Pedidos e retiradas",
    catalogNav: "Produtos",
    catalogNavShort: "Produtos",
    catalogPageTitle: "Produtos",
    catalogPageSubtitle: "Produtos exibidos quando o cliente pede preços ou lista",
    catalogItemSingular: "produto",
    catalogItemPlural: "produtos",
    catalogEmptyTitle: "Nenhum produto cadastrado",
    catalogEmptyHint: "Cadastre produtos para a IA enviar no WhatsApp.",
    catalogLimitToast: "produtos no catálogo",
    catalogPanelMenu: "Produtos",
    botBookingMenuLabel: "Fazer pedido",
    botCatalogMenuLabel: "Produtos",
    botStartBookingTitle: "Pedidos",
    botStartBookingPrompt: "Para qual dia é o pedido? (ex: *15/06* ou *hoje*)",
    botBookingConfirmedTitle: "Pedido registrado",
    botBookingServiceDefault: "Pedido",
    botMyBookingPrompt: "meu pedido",
    botCatalogEmpty:
      `Ainda não há *produtos* cadastrados.\n\nCadastre no painel ${APP_DISPLAY_NAME} (menu Produtos).`,
    botCatalogHeader: "Produtos",
    botCatalogFooter:
      "\nPara pedir, digite *pedido* ou use o *menu*.\nPara ver seu pedido: *meu pedido*.",
    botLegacyAppointmentHint: "Para fazer um pedido, informe o dia (ex: *15/06*) ou digite *pedido*.",
    botLegacyCatalogHint: "Veja nossos produtos — digite *produtos* ou *preços*.",
    botAppointmentKeywords: ["pedido", "pedidos", "quero comprar", "encomenda", "comprar", "pedir"],
    botMyBookingKeywords: ["meu pedido", "ver pedido", "status do pedido"],
    botCatalogKeywords: ["produtos", "catálogo", "catalogo", "preços", "precos", "o que vocês vendem"],
  },
  OTHER: DEFAULT,
};

export function getBusinessVocabulary(type?: string | null): BusinessVocabulary {
  if (!type) return DEFAULT;
  return BY_TYPE[type as BusinessType] ?? DEFAULT;
}

export function businessRequiresBookingApproval(type?: string | null): boolean {
  return getBusinessVocabulary(type).bookingRequiresApproval;
}

export function getBookingStatusLabel(type: string | null | undefined, status: string): string {
  const v = getBusinessVocabulary(type);
  const map: Record<string, string> = {
    PENDING: v.bookingStatusPending,
    CONFIRMED: v.bookingStatusConfirmed,
    CANCELLED: "Cancelado",
    COMPLETED: "Concluído",
    NO_SHOW: "Não compareceu",
  };
  return map[status] ?? status;
}

export function getIntentKeywordsForType(type?: string | null) {
  const v = getBusinessVocabulary(type);
  return {
    APPOINTMENT: [...new Set([...v.botAppointmentKeywords])],
    MY_APPOINTMENT: [...new Set([...v.botMyBookingKeywords])],
    CATALOG: [...new Set([...v.botCatalogKeywords, ...DEFAULT.botCatalogKeywords])],
  };
}

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  STORE: "Comércio local",
  BARBERSHOP: "Barbearia",
  SALON: "Salão / Manicure",
  RESTAURANT: "Restaurante",
  DENTAL: "Dentista / Clínica",
  OTHER: "Outro",
};

export function getBusinessTypeLabel(
  type?: BusinessType | string | null,
  typeLabel?: string | null
): string {
  const custom = typeLabel?.trim();
  if (type === "OTHER" && custom) return custom;
  if (type && type in BUSINESS_TYPE_LABELS) return BUSINESS_TYPE_LABELS[type as BusinessType];
  return custom || "Outro";
}
