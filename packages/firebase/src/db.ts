import type {
  Tenant,
  Business,
  BusinessWithRelations,
  CatalogItem,
  FAQ,
  Conversation,
  Message,
  Appointment,
  Payment,
  ConversationStatus,
  AppointmentStatus,
  PaymentStatus,
  Plan,
  PlanStatus,
  BusinessAsaasIntegration,
} from "./types.js";
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FieldValue as AdminFieldValue } from "firebase-admin/firestore";
import { getDb, newId, nowIso } from "./admin.js";

const tenants = () => getDb().collection("tenants");
const businesses = () => getDb().collection("businesses");

function businessRef(id: string) {
  return businesses().doc(id);
}

function catalogCol(businessId: string) {
  return businessRef(businessId).collection("catalog");
}

function faqsCol(businessId: string) {
  return businessRef(businessId).collection("faqs");
}

function sortBySortOrder<T extends { sortOrder?: number }>(items: T[]): T[] {
  return items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** Firestore orderBy omite docs sem sortOrder; o painel usa get() — alinhar com o bot. */
async function fetchCatalogItems(
  businessId: string,
  opts?: { availableOnly?: boolean }
): Promise<CatalogItem[]> {
  const snap = await catalogCol(businessId).get();
  let items = snap.docs.map((d) => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      businessId,
      sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
      available: data.available !== false,
    } as CatalogItem;
  });
  if (opts?.availableOnly) items = items.filter((i) => i.available);
  return sortBySortOrder(items);
}

async function fetchFaqs(businessId: string, opts?: { activeOnly?: boolean }): Promise<FAQ[]> {
  const snap = await faqsCol(businessId).get();
  let items = snap.docs.map((d) => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      businessId,
      sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
      active: data.active !== false,
    } as FAQ;
  });
  if (opts?.activeOnly) items = items.filter((f) => f.active);
  return sortBySortOrder(items);
}

function conversationsCol(businessId: string) {
  return businessRef(businessId).collection("conversations");
}

function messagesCol(businessId: string, conversationId: string) {
  return conversationsCol(businessId).doc(conversationId).collection("messages");
}

function appointmentsCol(businessId: string) {
  return businessRef(businessId).collection("appointments");
}

function paymentsCol(businessId: string) {
  return businessRef(businessId).collection("payments");
}

function asaasIntegrationRef(businessId: string) {
  return businessRef(businessId).collection("integrations").doc("asaas");
}

// ─── Tenants ─────────────────────────────────────────────────────────────────

export async function getTenant(id: string): Promise<Tenant | null> {
  const snap = await tenants().doc(id).get();
  return snap.exists ? ({ id: snap.id, ...snap.data() } as Tenant) : null;
}

export async function getTenantByEmail(email: string): Promise<Tenant | null> {
  const snap = await tenants().where("email", "==", email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return { id: doc.id, ...doc.data() } as Tenant;
}

export async function getTenantByStripeCustomerId(customerId: string): Promise<Tenant | null> {
  const snap = await tenants().where("stripeCustomerId", "==", customerId).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return { id: doc.id, ...doc.data() } as Tenant;
}

export async function createTenant(
  id: string,
  data: { name: string; email: string; plan?: Plan; planStatus?: PlanStatus }
): Promise<Tenant> {
  const ts = nowIso();
  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 14);
  const tenant: Tenant = {
    id,
    name: data.name,
    email: data.email,
    plan: data.plan ?? "STARTER",
    planStatus: data.planStatus ?? "TRIALING",
    trialEndsAt: trialEnds.toISOString(),
    createdAt: ts,
    updatedAt: ts,
  };
  await tenants().doc(id).set(tenant);
  return tenant;
}

export async function updateTenant(
  id: string,
  data: Partial<Tenant>
): Promise<Tenant | null> {
  const existing = await getTenant(id);
  if (!existing) return null;
  const patch = { ...data, updatedAt: nowIso() };
  delete (patch as { id?: string }).id;
  await tenants().doc(id).update(patch);
  return { ...existing, ...patch } as Tenant;
}

// ─── Businesses ──────────────────────────────────────────────────────────────

export async function listBusinesses(tenantId: string): Promise<Business[]> {
  const snap = await businesses().where("tenantId", "==", tenantId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Business);
}

export async function getBusiness(id: string, tenantId?: string): Promise<Business | null> {
  const snap = await businessRef(id).get();
  if (!snap.exists) return null;
  const b = { id: snap.id, ...snap.data() } as Business;
  if (tenantId && b.tenantId !== tenantId) return null;
  return b;
}

export async function getBusinessWithRelations(
  id: string,
  tenantId?: string
): Promise<BusinessWithRelations | null> {
  const business = await getBusiness(id, tenantId);
  if (!business) return null;
  const [catalog, faqs] = await Promise.all([fetchCatalogItems(id), fetchFaqs(id)]);
  const tenant = await getTenant(business.tenantId);
  return { ...business, catalog, faqs, tenantPlan: tenant?.plan };
}

async function resolveCatalogForBot(business: Business): Promise<CatalogItem[]> {
  const tryIds = [business.id, ...(business.id !== "app" ? ["app"] : [])];
  for (const bid of tryIds) {
    const items = await fetchCatalogItems(bid);
    if (items.length > 0) return items.map((i) => ({ ...i, businessId: business.id }));
  }
  return [];
}

async function resolveFaqsForBot(business: Business): Promise<FAQ[]> {
  const tryIds = [business.id, ...(business.id !== "app" ? ["app"] : [])];
  for (const bid of tryIds) {
    const items = await fetchFaqs(bid, { activeOnly: true });
    if (items.length > 0) return items.map((f) => ({ ...f, businessId: business.id }));
  }
  return [];
}

export async function getBusinessAsaasIntegration(
  businessId: string
): Promise<BusinessAsaasIntegration | null> {
  const snap = await asaasIntegrationRef(businessId).get();
  if (!snap.exists) return null;
  const data = snap.data() as BusinessAsaasIntegration;
  if (!data.apiKey?.trim()) return null;
  return data;
}

export async function setBusinessAsaasIntegration(
  businessId: string,
  data: { apiKey: string; sandbox?: boolean; webhookToken?: string }
): Promise<BusinessAsaasIntegration> {
  const record: BusinessAsaasIntegration = {
    apiKey: data.apiKey.trim(),
    sandbox: data.sandbox === true,
    updatedAt: nowIso(),
  };
  const token = data.webhookToken?.trim();
  if (token) record.webhookToken = token;
  await asaasIntegrationRef(businessId).set(record);
  return record;
}

export async function deleteBusinessAsaasIntegration(businessId: string): Promise<void> {
  await asaasIntegrationRef(businessId).delete();
}

export async function getBusinessForBot(id: string): Promise<BusinessWithRelations | null> {
  const business = await getBusiness(id);
  if (!business) return null;
  const [catalog, faqs, asaas] = await Promise.all([
    resolveCatalogForBot(business),
    resolveFaqsForBot(business),
    getBusinessAsaasIntegration(id),
  ]);
  const tenant = await getTenant(business.tenantId);
  return {
    ...business,
    catalog,
    faqs,
    tenantPlan: tenant?.plan,
    asaasConfigured: Boolean(asaas?.apiKey),
  };
}

export async function createBusiness(
  tenantId: string,
  data: Omit<Business, "id" | "tenantId" | "createdAt" | "updatedAt" | "isConnected">
): Promise<Business> {
  const id = newId();
  const ts = nowIso();
  const business: Business = {
    ...data,
    id,
    tenantId,
    isConnected: false,
    workingHours: data.workingHours ?? {},
    timezone: data.timezone ?? "America/Sao_Paulo",
    greetingMsg: data.greetingMsg ?? "Olá! Como posso ajudar?",
    awayMsg: data.awayMsg ?? "No momento estamos fechados. Em breve retornaremos!",
    createdAt: ts,
    updatedAt: ts,
  };
  await businessRef(id).set(business);
  return business;
}

export async function updateBusiness(
  id: string,
  tenantId: string,
  data: Partial<Business>
): Promise<Business | null> {
  const exists = await getBusiness(id, tenantId);
  if (!exists) return null;
  const patch: Record<string, unknown> = { ...data, updatedAt: nowIso() };
  delete patch.id;
  delete patch.tenantId;
  if (patch.type && patch.type !== "OTHER") patch.typeLabel = AdminFieldValue.delete();
  else if (typeof patch.typeLabel === "string") patch.typeLabel = patch.typeLabel.trim() || AdminFieldValue.delete();
  await businessRef(id).update(patch);
  return getBusiness(id, tenantId);
}

export async function setBusinessConnected(id: string, isConnected: boolean): Promise<void> {
  await businessRef(id).update({ isConnected, updatedAt: nowIso() });
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

export async function listCatalog(businessId: string): Promise<CatalogItem[]> {
  return fetchCatalogItems(businessId);
}

export async function createCatalogItem(
  businessId: string,
  data: Omit<CatalogItem, "id" | "businessId" | "createdAt">
): Promise<CatalogItem> {
  const id = newId();
  const item: CatalogItem = { id, businessId, createdAt: nowIso(), ...data };
  await catalogCol(businessId).doc(id).set(item);
  return item;
}

export async function updateCatalogItem(
  businessId: string,
  itemId: string,
  data: Partial<CatalogItem>
): Promise<CatalogItem | null> {
  const ref = catalogCol(businessId).doc(itemId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update(data);
  return { id: itemId, businessId, ...snap.data(), ...data } as CatalogItem;
}

export async function deleteCatalogItem(businessId: string, itemId: string): Promise<void> {
  await catalogCol(businessId).doc(itemId).delete();
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

export async function listFaqs(businessId: string): Promise<FAQ[]> {
  return fetchFaqs(businessId);
}

export async function createFaq(
  businessId: string,
  data: Omit<FAQ, "id" | "businessId" | "createdAt" | "sortOrder"> & { sortOrder?: number }
): Promise<FAQ> {
  const id = newId();
  const faq: FAQ = {
    id,
    businessId,
    sortOrder: data.sortOrder ?? 0,
    createdAt: nowIso(),
    ...data,
  };
  await faqsCol(businessId).doc(id).set(faq);
  return faq;
}

export async function updateFaq(
  businessId: string,
  faqId: string,
  data: Partial<Omit<FAQ, "id" | "businessId" | "createdAt">>
): Promise<FAQ | null> {
  const ref = faqsCol(businessId).doc(faqId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update(data);
  return { id: faqId, businessId, ...snap.data(), ...data } as FAQ;
}

export async function deleteFaq(businessId: string, faqId: string): Promise<void> {
  await faqsCol(businessId).doc(faqId).delete();
}

// ─── Conversations ───────────────────────────────────────────────────────────

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function customerConversationKey(phone: string): string {
  const raw = phone.trim().toLowerCase();
  if (raw.includes("@lid")) {
    const id = raw.split("@")[0]?.replace(/\D/g, "") ?? "";
    return id ? `lid:${id}` : raw;
  }
  const digits = normalizePhoneDigits(raw);
  if (digits.length >= 10) return `tel:${digits.slice(-11)}`;
  return digits ? `tel:${digits}` : raw;
}

function customerPhonesMatch(a: string, b: string): boolean {
  if (customerConversationKey(a) === customerConversationKey(b)) return true;
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return da.endsWith(db) || db.endsWith(da);
}

async function findConversationDoc(businessId: string, customerPhone: string) {
  const col = conversationsCol(businessId);
  const key = customerConversationKey(customerPhone);

  const byKey = await col.where("customerKey", "==", key).limit(1).get();
  if (!byKey.empty) return byKey.docs[0]!;

  const exact = await col.where("customerPhone", "==", customerPhone).limit(1).get();
  if (!exact.empty) return exact.docs[0]!;

  const all = await col.get();
  return all.docs.find((d) => customerPhonesMatch(String(d.data().customerPhone ?? ""), customerPhone)) ?? null;
}

export async function mergeDuplicateConversations(businessId: string): Promise<number> {
  const col = conversationsCol(businessId);
  const snap = await col.get();
  const groups = new Map<string, QueryDocumentSnapshot[]>();

  for (const doc of snap.docs) {
    const phone = String(doc.data().customerPhone ?? "");
    const key = String(doc.data().customerKey ?? customerConversationKey(phone));
    const list = groups.get(key) ?? [];
    list.push(doc);
    groups.set(key, list);
  }

  let mergedGroups = 0;
  const db = getDb();

  for (const [key, docs] of groups) {
    if (docs.length <= 1) {
      const only = docs[0]!;
      if (!only.data().customerKey) await only.ref.update({ customerKey: key });
      continue;
    }

    mergedGroups += 1;

    const scored = await Promise.all(
      docs.map(async (doc) => {
        const msgSnap = await messagesCol(businessId, doc.id).get();
        return { doc, msgCount: msgSnap.size };
      })
    );

    scored.sort((a, b) => {
      if (b.msgCount !== a.msgCount) return b.msgCount - a.msgCount;
      return String(b.doc.data().lastMessageAt ?? "").localeCompare(String(a.doc.data().lastMessageAt ?? ""));
    });

    const primary = scored[0]!.doc;
    const primaryId = primary.id;

    for (const { doc } of scored.slice(1)) {
      const dupId = doc.id;
      const msgSnap = await messagesCol(businessId, dupId).get();
      if (!msgSnap.empty) {
        const batch = db.batch();
        for (const msgDoc of msgSnap.docs) {
          const data = msgDoc.data();
          const nextId = newId();
          batch.set(messagesCol(businessId, primaryId).doc(nextId), {
            ...data,
            id: nextId,
            conversationId: primaryId,
          });
          batch.delete(msgDoc.ref);
        }
        await batch.commit();
      }

      const apts = await appointmentsCol(businessId).where("conversationId", "==", dupId).get();
      for (const apt of apts.docs) await apt.ref.update({ conversationId: primaryId });

      const pays = await paymentsCol(businessId).where("conversationId", "==", dupId).get();
      for (const pay of pays.docs) await pay.ref.update({ conversationId: primaryId });

      await doc.ref.delete();
    }

    const bestName = scored.reduce<string | undefined>((best, { doc }) => {
      const name = String(doc.data().customerName ?? "").trim();
      if (name && (!best || name.length > best.length)) return name;
      return best;
    }, String(primary.data().customerName ?? "").trim() || undefined);

    const bestReplyJid = scored.reduce<string | undefined>((best, { doc }) => {
      const reply = String(doc.data().replyJid ?? doc.data().customerPhone ?? "").trim();
      if (reply.includes("@")) return reply;
      return best;
    }, String(primary.data().replyJid ?? "").trim() || undefined);

    await primary.ref.update({
      customerKey: key,
      customerName: bestName,
      replyJid: bestReplyJid,
      lastMessageAt: nowIso(),
    });
  }

  return mergedGroups;
}

export async function listConversations(
  businessId: string,
  opts?: { status?: ConversationStatus; page?: number; limit?: number }
): Promise<{ conversations: (Conversation & { messages?: Message[] })[]; total: number }> {
  await mergeDuplicateConversations(businessId).catch(() => undefined);

  let q: Query = conversationsCol(businessId).orderBy("lastMessageAt", "desc");
  if (opts?.status) q = q.where("status", "==", opts.status);
  const snap = await q.get();
  const all = snap.docs.map((d) => ({ id: d.id, businessId, ...d.data() }) as Conversation);
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 20;
  const start = (page - 1) * limit;
  const slice = all.slice(start, start + limit);
  const withLast = await Promise.all(
    slice.map(async (c) => {
      const msgs = await messagesCol(businessId, c.id).orderBy("createdAt", "desc").limit(1).get();
      const messages = msgs.docs.map((d) => ({
        id: d.id,
        conversationId: c.id,
        ...d.data(),
      })) as Message[];
      return { ...c, messages };
    })
  );
  return { conversations: withLast, total: all.length };
}

export async function getConversation(
  businessId: string,
  conversationId: string
): Promise<(Conversation & { messages: Message[]; appointments: Appointment[]; payments: Payment[] }) | null> {
  const snap = await conversationsCol(businessId).doc(conversationId).get();
  if (!snap.exists) return null;
  const conversation = { id: snap.id, businessId, ...snap.data() } as Conversation;
  const [msgsSnap, aptsSnap, paysSnap] = await Promise.all([
    messagesCol(businessId, conversationId).orderBy("createdAt", "asc").get(),
    appointmentsCol(businessId).where("conversationId", "==", conversationId).get(),
    paymentsCol(businessId).where("conversationId", "==", conversationId).get(),
  ]);
  return {
    ...conversation,
    messages: msgsSnap.docs.map((d) => ({ id: d.id, conversationId, ...d.data() }) as Message),
    appointments: aptsSnap.docs.map((d) => ({ id: d.id, businessId, ...d.data() }) as Appointment),
    payments: paysSnap.docs.map((d) => ({ id: d.id, businessId, ...d.data() }) as Payment),
  };
}

export async function upsertConversation(
  businessId: string,
  customerPhone: string,
  customerName?: string,
  replyJid?: string
): Promise<Conversation> {
  const existing = await findConversationDoc(businessId, customerPhone);
  const key = customerConversationKey(customerPhone);
  const ts = nowIso();
  const dest = replyJid?.trim() || customerPhone;

  if (existing) {
    const patch: Record<string, unknown> = {
      customerName: customerName ?? existing.data().customerName,
      lastMessageAt: ts,
      customerKey: key,
    };
    if (dest.includes("@")) patch.replyJid = dest;
    await existing.ref.update(patch);
    return { id: existing.id, businessId, ...existing.data(), ...patch } as Conversation;
  }

  const id = newId();
  const conversation: Conversation = {
    id,
    businessId,
    customerPhone,
    customerKey: key,
    replyJid: dest.includes("@") ? dest : undefined,
    customerName,
    status: "OPEN",
    lastMessageAt: ts,
    createdAt: ts,
  };
  await conversationsCol(businessId).doc(id).set(conversation);
  return conversation;
}

export async function updateConversationStatus(
  businessId: string,
  conversationId: string,
  status: ConversationStatus
): Promise<Conversation | null> {
  const ref = conversationsCol(businessId).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ status, lastMessageAt: nowIso() });
  return { id: conversationId, businessId, ...snap.data(), status } as Conversation;
}

export async function createMessage(
  businessId: string,
  conversationId: string,
  data: Omit<Message, "id" | "conversationId" | "createdAt">
): Promise<Message> {
  const id = newId();
  const ts = nowIso();
  const message: Message = { id, conversationId, createdAt: ts, ...data };
  await messagesCol(businessId, conversationId).doc(id).set(message);
  await conversationsCol(businessId).doc(conversationId).update({ lastMessageAt: ts });
  return message;
}

export async function createMessages(
  businessId: string,
  conversationId: string,
  items: Omit<Message, "id" | "conversationId" | "createdAt">[]
): Promise<void> {
  const batch = getDb().batch();
  const ts = nowIso();
  for (const item of items) {
    const id = newId();
    batch.set(messagesCol(businessId, conversationId).doc(id), {
      id,
      conversationId,
      createdAt: ts,
      ...item,
    });
  }
  batch.update(conversationsCol(businessId).doc(conversationId), { lastMessageAt: ts });
  await batch.commit();
}

// ─── Appointments ────────────────────────────────────────────────────────────

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = ["PENDING", "CONFIRMED"];

function appointmentOverlaps(
  scheduledAt: string,
  durationMins: number,
  other: Appointment
): boolean {
  const startA = new Date(scheduledAt).getTime();
  const endA = startA + durationMins * 60_000;
  const startB = new Date(other.scheduledAt).getTime();
  const endB = startB + (other.durationMins ?? 60) * 60_000;
  return startA < endB && startB < endA;
}

export async function findConflictingAppointment(
  businessId: string,
  scheduledAt: string,
  durationMins = 60
): Promise<Appointment | null> {
  const appointments = await listAppointments(businessId);
  for (const apt of appointments) {
    if (!ACTIVE_APPOINTMENT_STATUSES.includes(apt.status)) continue;
    if (appointmentOverlaps(scheduledAt, durationMins, apt)) return apt;
  }
  return null;
}

export async function listCustomerAppointments(
  businessId: string,
  customerPhone: string,
  opts?: { upcomingOnly?: boolean }
): Promise<Appointment[]> {
  const now = Date.now();
  const appointments = await listAppointments(businessId);
  return appointments
    .filter((a) => customerPhonesMatch(a.customerPhone, customerPhone))
    .filter((a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW")
    .filter((a) => !opts?.upcomingOnly || new Date(a.scheduledAt).getTime() >= now)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export async function listAppointments(
  businessId: string,
  opts?: { from?: string; to?: string; status?: AppointmentStatus }
): Promise<Appointment[]> {
  const snap = await appointmentsCol(businessId).orderBy("scheduledAt", "asc").get();
  let list = snap.docs.map((d) => ({ id: d.id, businessId, ...d.data() }) as Appointment);
  if (opts?.status) list = list.filter((a) => a.status === opts.status);
  if (opts?.from) list = list.filter((a) => a.scheduledAt >= opts.from!);
  if (opts?.to) list = list.filter((a) => a.scheduledAt <= opts.to!);
  return list;
}

export async function createAppointment(
  data: Omit<Appointment, "id" | "createdAt" | "updatedAt" | "reminderSent">
): Promise<Appointment> {
  const id = newId();
  const ts = nowIso();
  const apt: Appointment = { id, reminderSent: false, createdAt: ts, updatedAt: ts, ...data };
  await appointmentsCol(data.businessId).doc(id).set(apt);
  return apt;
}

export async function getAppointment(
  businessId: string,
  appointmentId: string
): Promise<Appointment | null> {
  const snap = await appointmentsCol(businessId).doc(appointmentId).get();
  if (!snap.exists) return null;
  return { id: snap.id, businessId, ...snap.data() } as Appointment;
}

export async function updateAppointment(
  businessId: string,
  appointmentId: string,
  data: Partial<Appointment>
): Promise<Appointment | null> {
  const ref = appointmentsCol(businessId).doc(appointmentId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const patch = { ...data, updatedAt: nowIso() };
  await ref.update(patch);
  return { id: appointmentId, businessId, ...snap.data(), ...patch } as Appointment;
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function createPayment(
  data: Omit<Payment, "id" | "createdAt" | "updatedAt">
): Promise<Payment> {
  const id = newId();
  const ts = nowIso();
  const payment: Payment = { id, createdAt: ts, updatedAt: ts, ...data };
  await paymentsCol(data.businessId).doc(id).set(payment);
  return payment;
}

export async function getPaymentsByAsaasId(asaasId: string): Promise<Payment[]> {
  const snap = await getDb().collectionGroup("payments").where("asaasId", "==", asaasId).get();
  return snap.docs.map((d) => {
    const businessId = d.ref.parent.parent!.id;
    return { id: d.id, businessId, ...d.data() } as Payment;
  });
}

export async function updatePaymentsByAsaasId(
  asaasId: string,
  data: Partial<Payment>
): Promise<Payment[]> {
  const snap = await getDb().collectionGroup("payments").where("asaasId", "==", asaasId).get();
  if (snap.empty) return [];

  const batch = getDb().batch();
  const updated: Payment[] = [];
  const ts = nowIso();

  for (const doc of snap.docs) {
    const businessId = doc.ref.parent.parent!.id;
    const current = { id: doc.id, businessId, ...doc.data() } as Payment;
    const patch = { ...data, updatedAt: ts };
    batch.update(doc.ref, patch);
    updated.push({ ...current, ...patch } as Payment);
  }

  await batch.commit();
  return updated;
}

export async function listPayments(businessId: string, limit = 50): Promise<Payment[]> {
  const snap = await paymentsCol(businessId).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, businessId, ...d.data() }) as Payment);
}

// ─── Analytics ─────────────────────────────────────────────────────────────

export async function getAnalytics(businessId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

  const [convSnap, aptSnap, paySnap] = await Promise.all([
    conversationsCol(businessId).get(),
    appointmentsCol(businessId).get(),
    paymentsCol(businessId).get(),
  ]);

  const conversations = convSnap.docs.map((d) => d.data());
  const appointments = aptSnap.docs.map((d) => d.data());
  const payments = paySnap.docs.map((d) => d.data());

  let totalMessages = 0;
  let monthMessages = 0;
  for (const c of convSnap.docs) {
    const msgs = await messagesCol(businessId, c.id).get();
    totalMessages += msgs.size;
    monthMessages += msgs.docs.filter((m) => (m.data().createdAt as string) >= monthStart).length;
  }

  const monthConversations = conversations.filter(
    (c) => c.createdAt >= monthStart && c.createdAt <= monthEnd
  ).length;
  const lastMonthConversations = conversations.filter(
    (c) => c.createdAt >= lastMonthStart && c.createdAt <= lastMonthEnd
  ).length;

  const revenueThisMonth = payments
    .filter((p) => p.status === "PAID" && p.paidAt && p.paidAt >= monthStart && p.paidAt <= monthEnd)
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);

  const conversationGrowth =
    lastMonthConversations > 0
      ? Math.round(((monthConversations - lastMonthConversations) / lastMonthConversations) * 100)
      : 100;

  return {
    conversations: {
      total: conversations.length,
      open: conversations.filter((c) => c.status === "OPEN").length,
      thisMonth: monthConversations,
      growth: conversationGrowth,
    },
    messages: { total: totalMessages, thisMonth: monthMessages },
    appointments: {
      pending: appointments.filter((a) => a.status === "PENDING" || a.status === "CONFIRMED").length,
      thisMonth: appointments.filter(
        (a) => a.scheduledAt >= monthStart && a.scheduledAt <= monthEnd
      ).length,
    },
    payments: {
      pending: payments.filter((p) => p.status === "PENDING").length,
      revenueThisMonth,
    },
  };
}
