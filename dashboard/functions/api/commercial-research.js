const WORKER_BASE = "https://commercial-launch-radar-v3.michaellea1234.workers.dev";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const token = String(body?.radarToken || "").trim();

    if (!token) {
      return Response.json(
        { error: "A scan password is required." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const payload = {
      batchSize: Math.max(1, Math.min(Number(body?.batchSize) || 5, 10))
    };

    const upstream = await fetch(WORKER_BASE + "/api/research-commercial", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Radar-Token": token
      },
      body: JSON.stringify(payload)
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
