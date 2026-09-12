export function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[™®]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(incorporated|inc|corp|corporation|company|co|limited|ltd|plc|llc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCik(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.padStart(10, "0").slice(-10);
}

export function isoNow() {
  return new Date().toISOString();
}

export function safeIsoDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toISOString();
}

export function stripHtml(value) {
  return normalizeWhitespace(
    String(value ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

export function classifyCommercialRole(title) {
  const t = normalizeWhitespace(title).toLowerCase();

  const leadership = [
    /chief commercial officer/,
    /\bcco\b/,
    /head of commercial/,
    /vp.*sales/,
    /vice president.*sales/,
    /national sales/,
    /regional business director/,
    /regional sales director/,
    /area business director/,
    /area sales director/,
    /district (sales )?manager/,
    /regional (sales )?manager/,
  ];

  const marketAccess = [
    /market access/,
    /payer/,
    /reimbursement/,
    /field reimbursement/,
    /access and reimbursement/,
    /patient access/,
    /pricing/,
  ];

  const field = [
    /account executive/,
    /key account manager/,
    /strategic account manager/,
    /regional account manager/,
    /hospital account manager/,
    /clinical account specialist/,
    /territory business manager/,
    /territory business leader/,
    /therapeutic business manager/,
    /territory manager/,
    /area business manager/,
    /sales representative/,
    /specialty sales/,
    /field sales/,
    /sales specialist/,
    /therapeutic specialist/,
    /oncology specialist/,
    /executive sales specialist/,
    /business manager/,
  ];

  if (leadership.some((r) => r.test(t))) {
    return { family: "sales_leadership", level: "leadership", commercial: true };
  }
  if (marketAccess.some((r) => r.test(t))) {
    return { family: "market_access", level: "infrastructure", commercial: true };
  }
  if (field.some((r) => r.test(t))) {
    return { family: "field_sales", level: "field", commercial: true };
  }
  return { family: "other", level: "other", commercial: false };
}

export async function sha256Hex(value) {
  const input =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function makeId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}
