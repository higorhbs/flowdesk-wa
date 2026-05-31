import axios, { type AxiosInstance } from "axios";
import { optionalEnv } from "../env";

export type AsaasCredentials = {
  apiKey: string;
  baseUrl: string;
};

const SANDBOX_URL = "https://sandbox.asaas.com/api/v3";
const PRODUCTION_URL = "https://api.asaas.com/api/v3";

export function asaasBaseUrl(sandbox: boolean): string {
  if (sandbox) return SANDBOX_URL;
  return optionalEnv("ASAAS_BASE_URL") ?? PRODUCTION_URL;
}

export function isPlatformAsaasConfigured(): boolean {
  return Boolean(optionalEnv("ASAAS_API_KEY"));
}

export function resolveAsaasCredentials(integration?: {
  apiKey?: string;
  sandbox?: boolean;
} | null): AsaasCredentials | null {
  if (integration?.apiKey?.trim()) {
    return {
      apiKey: integration.apiKey.trim(),
      baseUrl: asaasBaseUrl(integration.sandbox === true),
    };
  }
  const platformKey = optionalEnv("ASAAS_API_KEY");
  if (!platformKey) return null;
  const baseUrl = optionalEnv("ASAAS_BASE_URL") ?? PRODUCTION_URL;
  return { apiKey: platformKey, baseUrl };
}

export function isAsaasConfigured(integration?: { apiKey?: string } | null): boolean {
  return resolveAsaasCredentials(integration) !== null;
}

function asaasClient(creds: AsaasCredentials): AxiosInstance {
  return axios.create({
    baseURL: creds.baseUrl,
    headers: {
      access_token: creds.apiKey,
      "Content-Type": "application/json",
    },
  });
}

function normalizeBrPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return digits;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

function defaultCpfCnpj(): string {
  return optionalEnv("ASAAS_DEFAULT_CPF") ?? "24971563792";
}

export interface PixChargeInput {
  customerName: string;
  customerPhone: string;
  description: string;
  amount: number;
  dueDate?: string;
  externalRef?: string;
}

export interface PixChargeResult {
  asaasId: string;
  pixQrCode: string;
  pixCopyPaste: string;
  amount: number;
  status: string;
}

export async function createPixCharge(
  input: PixChargeInput,
  creds: AsaasCredentials
): Promise<PixChargeResult> {
  const client = asaasClient(creds);
  const mobilePhone = normalizeBrPhone(input.customerPhone);
  const cpfCnpj = defaultCpfCnpj();
  let customerId: string;

  const existing = await client.get("/customers", { params: { mobilePhone } });
  if (existing.data.data?.length > 0) {
    customerId = existing.data.data[0].id;
  } else {
    const created = await client.post("/customers", {
      name: input.customerName,
      mobilePhone,
      cpfCnpj,
    });
    customerId = created.data.id;
  }

  const dueDate =
    input.dueDate ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const charge = await client.post("/payments", {
    customer: customerId,
    billingType: "PIX",
    value: input.amount,
    dueDate,
    description: input.description,
    externalReference: input.externalRef,
  });

  const chargeId = charge.data.id as string;
  const qrRes = await client.get(`/payments/${chargeId}/pixQrCode`);

  return {
    asaasId: chargeId,
    pixQrCode: qrRes.data.encodedImage,
    pixCopyPaste: qrRes.data.payload,
    amount: input.amount,
    status: charge.data.status,
  };
}

export async function checkPixStatus(asaasId: string, creds: AsaasCredentials): Promise<string> {
  const res = await asaasClient(creds).get(`/payments/${asaasId}`);
  return res.data.status;
}
