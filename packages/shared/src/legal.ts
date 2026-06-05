export type LegalEntityType = "CNPJ" | "PF";

export const DEFAULT_LEGAL_ENTITY_TYPE: LegalEntityType = "CNPJ";
export const DEFAULT_LEGAL_ENTITY_NAME = "FlowDesk IA";
export const DEFAULT_LEGAL_ENTITY_DOCUMENT = "";
export const DEFAULT_PRIVACY_EMAIL = "privacidade@flowdesk.ia.br";
export const DEFAULT_SUPPORT_EMAIL = "suporte@flowdesk.ia.br";
export const DEFAULT_LEGAL_WEBSITE = "https://flowdesk.ia.br";

export type LegalEntityConfig = {
  type: LegalEntityType;
  name: string;
  document: string;
  privacyEmail: string;
  supportEmail: string;
  website: string;
};

export function formatLegalDocument(type: LegalEntityType, document: string): string {
  const digits = document.replace(/\D/g, "");
  if (!digits) return "";
  if (type === "CNPJ" && digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (type === "PF" && digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return document;
}

export function defaultLegalEntityConfig(): LegalEntityConfig {
  return {
    type: DEFAULT_LEGAL_ENTITY_TYPE,
    name: DEFAULT_LEGAL_ENTITY_NAME,
    document: DEFAULT_LEGAL_ENTITY_DOCUMENT,
    privacyEmail: DEFAULT_PRIVACY_EMAIL,
    supportEmail: DEFAULT_SUPPORT_EMAIL,
    website: DEFAULT_LEGAL_WEBSITE,
  };
}

export function supportMailtoUrl(email: string, subject: string): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", to: email, su: subject });
  return `https://mail.google.com/mail/?${q.toString()}`;
}
