export type FaqMatchInput = {
  active?: boolean;
  question?: string;
  answer?: string;
  keywords?: string[];
};

const FAQ_STOP_WORDS = new Set([
  "a",
  "o",
  "e",
  "de",
  "da",
  "do",
  "em",
  "um",
  "uma",
  "os",
  "as",
  "que",
  "qual",
  "quais",
  "como",
  "onde",
  "no",
  "na",
  "nos",
  "nas",
  "ao",
  "aos",
  "pra",
  "para",
  "por",
  "com",
  "sem",
  "eu",
  "voce",
  "voces",
  "vc",
]);

export function normalizeFaqText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length]!;
}

export function wordsSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 3) return false;

  const dist = levenshtein(a, b);
  if (maxLen <= 4) return dist <= 1;
  if (maxLen <= 8) return dist <= 2;
  return dist / maxLen <= 0.28;
}

function significantWords(text: string): string[] {
  return normalizeFaqText(text)
    .split(" ")
    .filter((w) => w.length > 2 && !FAQ_STOP_WORDS.has(w));
}

export function faqTextsMatch(message: string, candidate: string): boolean {
  const msg = normalizeFaqText(message);
  const cand = normalizeFaqText(candidate);
  if (!msg || !cand || cand.length < 2) return false;

  if (msg.includes(cand) || cand.includes(msg)) return true;

  const msgWords = significantWords(msg);
  const candWords = significantWords(cand);
  if (!candWords.length) return false;

  if (candWords.length === 1) {
    const kw = candWords[0]!;
    return msgWords.some((w) => wordsSimilar(w, kw));
  }

  const hits = candWords.filter((cw) => msgWords.some((mw) => wordsSimilar(mw, cw)));
  if (candWords.length === 2) return hits.length >= 2;
  return hits.length >= Math.max(2, Math.ceil(candWords.length * 0.6));
}

function faqQuestionWordOverlap(message: string, question: string): boolean {
  const mq = significantWords(message);
  const qq = significantWords(question);
  if (!qq.length) return false;

  const hits = qq.filter((qw) => mq.some((mw) => wordsSimilar(mw, qw)));
  if (qq.length <= 2) return hits.length === qq.length;
  if (hits.length >= 2 && hits.length / qq.length >= 0.5) return true;
  return hits.length / qq.length >= 0.65;
}

export function faqEntryMatches(message: string, faq: FaqMatchInput): boolean {
  const keywords = Array.isArray(faq.keywords) ? faq.keywords : [];
  for (const kw of keywords) {
    if (faqTextsMatch(message, String(kw))) return true;
  }

  const question = String(faq.question ?? "").trim();
  if (question.length >= 4) {
    if (faqTextsMatch(message, question)) return true;
    if (faqQuestionWordOverlap(message, question)) return true;
  }

  return false;
}

export function findMatchingFaq<T extends FaqMatchInput>(message: string, faqs: T[]): T | null {
  const trimmed = message.trim();
  if (!trimmed || !faqs.length) return null;

  for (const faq of faqs) {
    if (faq.active === false) continue;
    if (faqEntryMatches(trimmed, faq)) return faq;
  }
  return null;
}
