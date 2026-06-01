export type Plan = "STARTER" | "PRO" | "UNLIMITED";
export type PlanStatus = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED";
export type BusinessType = "BARBERSHOP" | "SALON" | "RESTAURANT" | "DENTAL" | "STORE" | "OTHER";
export type ConversationStatus = "OPEN" | "ATTENDING" | "CLOSED";
export type MessageRole = "CUSTOMER" | "IA" | "HUMAN";
export type AppointmentStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
export type PaymentStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";

export interface Tenant {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  planStatus: PlanStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string;
  cancellationReason?: string;
  cancellationUsageDays?: number;
  cancellationCycleDays?: number;
  cancellationRefundAmount?: number;
  cancellationRefundCurrency?: string;
  cancellationRefundId?: string;
  cancellationRefundStatus?: string;
  onboardingCompletedAt?: string;
  lgpdAcceptedAt?: string;
  lgpdPolicyVersion?: string;
  trialEndsAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BotMenuItemConfig {
  num: number;
  label: string;
  response: string;
  enabled: boolean;
  emoji?: string;
  /** Legado — ignorado em menus novos; usado só para migrar dados antigos */
  action?: "APPOINTMENT" | "CATALOG" | "FAQ" | "PAYMENT" | "HUMAN";
}

export interface Business {
  id: string;
  tenantId: string;
  name: string;
  type: BusinessType;
  typeLabel?: string;
  phone: string;
  address?: string;
  description?: string;
  logoUrl?: string;
  workingHours: Record<string, unknown>;
  timezone?: string;
  greetingMsg: string;
  awayMsg: string;
  botMenu?: BotMenuItemConfig[];
  botMenuEnabled?: boolean;
  greetingEnabled?: boolean;
  /** false = IA não envia nenhuma mensagem automática (menu, FAQ, saudação, fora do horário) */
  botAutoReplyEnabled?: boolean;
  thanksMsg?: string;
  isConnected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItem {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  available: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface FAQ {
  id: string;
  businessId: string;
  question: string;
  answer: string;
  keywords: string[];
  sortOrder: number;
  active: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  businessId: string;
  customerPhone: string;
  customerKey?: string;
  replyJid?: string;
  customerName?: string;
  status: ConversationStatus;
  lastMessageAt: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  mediaUrl?: string;
  waMessageId?: string;
  createdAt: string;
}

export interface Appointment {
  id: string;
  businessId: string;
  conversationId?: string;
  customerPhone: string;
  customerName?: string;
  serviceId?: string;
  serviceName: string;
  scheduledAt: string;
  durationMins: number;
  status: AppointmentStatus;
  notes?: string;
  reminderSent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  businessId: string;
  conversationId?: string;
  customerPhone: string;
  customerName?: string;
  description: string;
  amount: number;
  status: PaymentStatus;
  pixQrCode?: string;
  pixCopyPaste?: string;
  asaasId?: string;
  externalRef?: string;
  paidAt?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessAsaasIntegration {
  apiKey: string;
  sandbox: boolean;
  webhookToken?: string;
  updatedAt: string;
}

export type ScheduledStatusState =
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export type ScheduledStatusMediaType = "image" | "video";

export interface ScheduledStatus {
  id: string;
  businessId: string;
  mediaUrl: string;
  mediaType: ScheduledStatusMediaType;
  caption?: string;
  scheduledAt: string;
  status: ScheduledStatusState;
  error?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessWithRelations extends Business {
  catalog: CatalogItem[];
  faqs: FAQ[];
  tenantPlan?: Plan;
  /** Preenchido só no servidor (bot); nunca expor ao client web */
  asaasConfigured?: boolean;
}
