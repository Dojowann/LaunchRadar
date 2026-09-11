export function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Radar-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(body, status = 200, env = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(env),
    },
  });
}

export function isAuthorized(request, env) {
  if (!env.RADAR_ACCESS_TOKEN) return true;
  return request.headers.get("X-Radar-Token") === env.RADAR_ACCESS_TOKEN;
}

export async function fetchJson(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 5000) };
    }

    if (!response.ok) {
      const detail =
        payload?.error?.message ||
        payload?.message ||
        payload?.raw ||
        `${response.status} ${response.statusText}`;
      throw new Error(`Upstream request failed: ${detail}`);
    }

    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}
