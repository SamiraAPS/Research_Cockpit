const baseUrl = process.env.RADAR_INGESTION_URL;
const token = process.env.INGESTION_TOKEN;

if (!baseUrl || !token) {
  console.error("Setze RADAR_INGESTION_URL und INGESTION_TOKEN in der Prozessumgebung.");
  process.exit(1);
}

const target = process.argv[2] ?? "all";
const requests = target === "all"
  ? [
      { layer: "core", scope: "ai" },
      { layer: "broad", scope: "ai" },
      { layer: "frontier", scope: "ai" },
      { layer: "core", scope: "field" },
      { layer: "broad", scope: "field" },
      { layer: "frontier", scope: "field" },
      { dataset: "calls" },
      { dataset: "trends", scope: "all" },
    ]
  : [JSON.parse(target)];

for (const payload of requests) {
  const response = await fetch(new URL("/api/ingest", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  console.log(JSON.stringify({ request: payload, status: response.status, result }, null, 2));
  if (!response.ok && response.status !== 207) process.exitCode = 1;
}
