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

    // Each Worker call scans exactly one company. That keeps Workday/API/D1
    // subrequests bounded, while the Pages function can safely fan out several
    // sequential Worker invocations so one Scan Market click still advances
    // coverage across multiple companies.
    const iterations = Math.max(
      1,
      Math.min(Number(body?.batchSize) || 5, 5)
    );

    const aggregate = {
      ok: true,
      companiesChecked: 0,
      targetsScanned: 0,
      targetsDiscovered: 0,
      jobsFound: 0,
      activeCommercialJobs: 0,
      newCommercialJobs: 0,
      runsCompleted: 0,
      warnings: [],
    };

    let discoveryVersion = null;

    for (let i = 0; i < iterations; i += 1) {
      const upstream = await fetch(WORKER_BASE + "/api/scan-hiring", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Radar-Token": token,
        },
        body: JSON.stringify({ batchSize: 1 }),
      });

      const text = await upstream.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        const message = `Hiring scan run ${i + 1} returned non-JSON HTTP ${upstream.status}.`;
        if (aggregate.runsCompleted === 0) {
          return Response.json(
            { error: message },
            { status: upstream.status || 502, headers: { "Cache-Control": "no-store" } }
          );
        }
        aggregate.warnings.push(message);
        break;
      }

      if (!upstream.ok || data?.ok === false) {
        const message = data?.detail || data?.error || `HTTP ${upstream.status}`;
        if (aggregate.runsCompleted === 0) {
          return Response.json(data, {
            status: upstream.status,
            headers: { "Cache-Control": "no-store" },
          });
        }
        aggregate.warnings.push(`Hiring scan run ${i + 1}: ${message}`);
        break;
      }

      discoveryVersion = discoveryVersion || data?.discoveryVersion || null;
      aggregate.companiesChecked += Number(data?.companiesChecked || 0);
      aggregate.targetsScanned += Number(data?.targetsScanned || 0);
      aggregate.targetsDiscovered += Number(data?.targetsDiscovered || 0);
      aggregate.jobsFound += Number(data?.jobsFound || 0);
      aggregate.activeCommercialJobs += Number(data?.activeCommercialJobs || 0);
      aggregate.newCommercialJobs += Number(data?.newCommercialJobs || 0);
      aggregate.runsCompleted += 1;
    }

    return Response.json(
      {
        ...aggregate,
        discoveryVersion,
        requestedRuns: iterations,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: error?.message || String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
