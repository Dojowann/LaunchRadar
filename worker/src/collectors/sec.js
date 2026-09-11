import { fetchJson } from "../lib/http.js";
import { isoNow, normalizeCik, normalizeWhitespace } from "../lib/normalize.js";

const DEFAULT_FORMS = new Set([
  "8-K",
  "10-Q",
  "10-K",
  "20-F",
  "6-K",
  "S-3",
  "S-3ASR",
  "424B5",
]);

function columnsToRows(recent) {
  const keys = Object.keys(recent || {}).filter((k) => Array.isArray(recent[k]));
  const len = Math.max(0, ...keys.map((k) => recent[k].length));
  const rows = [];

  for (let i = 0; i < len; i += 1) {
    const row = {};
    for (const key of keys) row[key] = recent[key][i] ?? null;
    rows.push(row);
  }
  return rows;
}

function filingUrl(cik, accessionNumber, primaryDocument) {
  if (!cik || !accessionNumber || !primaryDocument) return null;
  const cikInt = String(Number(cik));
  const accNo = String(accessionNumber).replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNo}/${primaryDocument}`;
}

export async function collectSecSubmissions(input = {}, env = {}) {
  const cik = normalizeCik(input.cik);
  if (!cik) throw new Error("SEC collector requires a CIK.");

  const userAgent = normalizeWhitespace(env.SEC_USER_AGENT || "");
  if (!userAgent) {
    throw new Error(
      "SEC_USER_AGENT is not configured. Set a descriptive Cloudflare variable such as 'Commercial Launch Radar admin@yourdomain.com'."
    );
  }

  const limit = Math.max(1, Math.min(Number(input.limit) || 40, 200));
  const requestedForms = Array.isArray(input.forms)
    ? new Set(input.forms.map((x) => normalizeWhitespace(x)).filter(Boolean))
    : DEFAULT_FORMS;

  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const { payload } = await fetchJson(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent,
      "Accept-Encoding": "gzip, deflate",
    },
  });

  const observedAt = isoNow();
  const rows = columnsToRows(payload?.filings?.recent || {})
    .filter((row) => requestedForms.has(row?.form))
    .slice(0, limit);

  const observations = rows.map((row) => {
    const directUrl = filingUrl(cik, row.accessionNumber, row.primaryDocument);
    return {
      externalId: row.accessionNumber || crypto.randomUUID(),
      observationType: "sec_filing",
      companyNameRaw: payload?.name || null,
      assetNameRaw: null,
      title: `${row.form || "SEC filing"} — ${payload?.name || cik}`,
      url: directUrl || url,
      publishedAt: row.filingDate || row.reportDate || null,
      observedAt,
      payload: {
        cik,
        companyName: payload?.name || null,
        ticker: Array.isArray(payload?.tickers) ? payload.tickers[0] || null : null,
        exchange: Array.isArray(payload?.exchanges)
          ? payload.exchanges[0] || null
          : null,
        form: row.form || null,
        filingDate: row.filingDate || null,
        reportDate: row.reportDate || null,
        acceptanceDateTime: row.acceptanceDateTime || null,
        accessionNumber: row.accessionNumber || null,
        primaryDocument: row.primaryDocument || null,
        primaryDocDescription: row.primaryDocDescription || null,
        filingUrl: directUrl,
      },
    };
  });

  return {
    sourceKey: "sec_edgar",
    tier: "A",
    query: { cik, limit, forms: [...requestedForms] },
    observations,
    upstreamUrl: url,
  };
}
