const WORKER_BASE = "https://commercial-launch-radar-v3.michaellea1234.workers.dev";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const token = String(body?.radarToken || "").trim();

    if (!token) {
      return Response.json({ error: "A scan password is required." }, { status: 400 });
    }

    const source = body?.source || "clinicaltrials_gov";
    let payload;

    if (source === "openfda_drugsfda") {
      payload = {
        source,
        days: Math.max(1, Math.min(Number(body?.days) || 90, 365)),
        limit: Math.max(1, Math.min(Number(body?.limit) || 50, 99)),
        startDate: body?.startDate || null,
        endDate: body?.endDate || null,
        applicationNumber: body?.applicationNumber || null,
        sponsor: body?.sponsor || null,
        brandName: body?.brandName || null
      };
    } else {
      payload = {
        source: "clinicaltrials_gov",
        query: body?.query || "AREA[Phase]PHASE3",
        pageSize: Math.max(1, Math.min(Number(body?.pageSize) || 25, 100)),
        pageToken: body?.pageToken || null
      };
    }

    const upstream = await fetch(WORKER_BASE + "/api/collect", {
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
