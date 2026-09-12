const WORKER_BASE = "https://commercial-launch-radar-v3.michaellea1234.workers.dev";

export async function onRequestGet(context) {
  try {
    const incomingUrl = new URL(context.request.url);
    const upstreamUrl = new URL(WORKER_BASE + "/api/opportunities");

    for (const [key, value] of incomingUrl.searchParams) {
      upstreamUrl.searchParams.append(key, value);
    }

    const upstream = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    const text = await upstream.text();

    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return Response.json(
      { error: error?.message || String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
