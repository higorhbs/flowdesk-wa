import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
} from "firebase/firestore";
import type { Business, BusinessType, CatalogItem, FAQ } from "./types.js";
import { getClientDb } from "./client.js";

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

function firestoreData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

function nextSortOrder(docs: { data: () => Record<string, unknown> }[]): number {
  const max = docs.reduce((m, d) => Math.max(m, Number(d.data().sortOrder) || 0), -1);
  return max + 1;
}

function businessesCol() {
  return collection(getClientDb(), "businesses");
}

function businessRef(id: string) {
  return doc(getClientDb(), "businesses", id);
}

function catalogCol(businessId: string) {
  return collection(getClientDb(), "businesses", businessId, "catalog");
}

function faqsCol(businessId: string) {
  return collection(getClientDb(), "businesses", businessId, "faqs");
}

export async function listClientBusinesses(tenantId: string): Promise<Business[]> {
  const q = query(businessesCol(), where("tenantId", "==", tenantId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Business);
}

export async function getClientBusiness(id: string, tenantId: string): Promise<Business | null> {
  const snap = await getDoc(businessRef(id));
  if (!snap.exists()) return null;
  const b = { id: snap.id, ...snap.data() } as Business;
  return b.tenantId === tenantId ? b : null;
}

export async function createClientBusiness(
  tenantId: string,
  data: {
    name: string;
    type: BusinessType;
    typeLabel?: string;
    phone: string;
    address?: string;
    description?: string;
    greetingMsg?: string;
    awayMsg?: string;
    workingHours?: Record<string, unknown>;
  }
): Promise<Business> {
  const id = newId();
  const ts = nowIso();
  const business: Business = {
    id,
    tenantId,
    name: data.name,
    type: data.type,
    typeLabel: data.typeLabel?.trim() || undefined,
    phone: data.phone,
    address: data.address,
    description: data.description,
    workingHours: data.workingHours ?? {},
    timezone: "America/Sao_Paulo",
    greetingMsg: data.greetingMsg ?? "Olá! Como posso ajudar?",
    awayMsg: data.awayMsg ?? "No momento estamos fechados. Em breve retornaremos!",
    isConnected: false,
    createdAt: ts,
    updatedAt: ts,
  };
  await setDoc(businessRef(id), business);
  return business;
}

export async function updateClientBusiness(
  id: string,
  tenantId: string,
  data: Partial<Business>
): Promise<Business | null> {
  const exists = await getClientBusiness(id, tenantId);
  if (!exists) return null;
  const patch: Record<string, unknown> = { ...data, updatedAt: nowIso() };
  delete patch.id;
  delete patch.tenantId;
  if (patch.type && patch.type !== "OTHER") patch.typeLabel = deleteField();
  else if (typeof patch.typeLabel === "string") patch.typeLabel = patch.typeLabel.trim() || deleteField();
  await updateDoc(businessRef(id), patch);
  return getClientBusiness(id, tenantId);
}

export async function listClientCatalog(businessId: string): Promise<CatalogItem[]> {
  const snap = await getDocs(catalogCol(businessId));
  return snap.docs
    .map((d) => ({ id: d.id, businessId, sortOrder: 0, ...d.data() }) as CatalogItem)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function createClientCatalogItem(
  businessId: string,
  data: Omit<CatalogItem, "id" | "businessId" | "createdAt" | "sortOrder"> & { sortOrder?: number }
): Promise<CatalogItem> {
  const existing = await getDocs(catalogCol(businessId));
  const sortOrder = data.sortOrder ?? nextSortOrder(existing.docs);
  const id = newId();
  const createdAt = nowIso();
  const payload = firestoreData({
    name: data.name,
    price: data.price,
    available: data.available ?? true,
    sortOrder,
    createdAt,
    ...(data.description?.trim() ? { description: data.description.trim() } : {}),
    ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
  });
  await setDoc(doc(catalogCol(businessId), id), payload);
  return {
    id,
    businessId,
    name: data.name,
    price: data.price,
    available: data.available ?? true,
    sortOrder,
    createdAt,
    ...(data.description?.trim() ? { description: data.description.trim() } : {}),
    ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
  };
}

export async function updateClientCatalogItem(
  businessId: string,
  itemId: string,
  data: Partial<CatalogItem>
): Promise<CatalogItem | null> {
  const ref = doc(catalogCol(businessId), itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const { id: _id, businessId: _bid, createdAt: _ca, ...fields } = data;
  const patch = firestoreData(fields as Record<string, unknown>);
  if (!Object.keys(patch).length) {
    return { id: itemId, businessId, ...snap.data() } as CatalogItem;
  }
  await updateDoc(ref, patch);
  return { id: itemId, businessId, ...snap.data(), ...patch } as CatalogItem;
}

export async function deleteClientCatalogItem(businessId: string, itemId: string): Promise<void> {
  await deleteDoc(doc(catalogCol(businessId), itemId));
}

export async function listClientFaqs(businessId: string): Promise<FAQ[]> {
  const snap = await getDocs(faqsCol(businessId));
  return snap.docs
    .map((d) => ({ id: d.id, businessId, sortOrder: 0, ...d.data() }) as FAQ)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function createClientFaq(
  businessId: string,
  data: Omit<FAQ, "id" | "businessId" | "createdAt">
): Promise<FAQ> {
  const id = newId();
  const faq: FAQ = { id, businessId, createdAt: nowIso(), ...data };
  await setDoc(doc(faqsCol(businessId), id), faq);
  return faq;
}

export async function updateClientFaq(
  businessId: string,
  faqId: string,
  data: Partial<Omit<FAQ, "id" | "businessId" | "createdAt">>
): Promise<void> {
  await updateDoc(doc(faqsCol(businessId), faqId), data);
}

export async function deleteClientFaq(businessId: string, faqId: string): Promise<void> {
  await deleteDoc(doc(faqsCol(businessId), faqId));
}
