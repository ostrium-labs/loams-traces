export type Span = {
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  name: string;
  service: string;
  run: string;
  start_ns: string;
  start_ms: number;
  duration_ms: number;
  status: string;
  attributes: string;
};
export type Trace = {
  trace_id: string;
  service: string;
  run: string;
  name: string;
  spans: number;
  duration_ms: number;
  start_ms: number;
  chunk: string;
  chunks?: string[];
};
export type Artifact = {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
  path?: string;
  parts?: { path: string; sha256: string; bytes: number }[];
  sources: { repository: string; path: string; revision: string }[];
  sanitized: boolean;
};
export type Measurement = {
  id: string;
  engine: string;
  workload: string;
  rate: number | null;
  unit: string;
  errors: number | null;
  p99_ms: number | null;
  clients: number | null;
  build: string;
  note: string;
  source: string;
  path: string;
};

function attributes(values: any[] = []): Record<string, unknown> {
  return Object.fromEntries(values.map((a) => [a.key, Object.values(a.value ?? {})[0]]));
}
export function normalizeOTLP(payload: any): Span[] {
  if (!Array.isArray(payload?.resourceSpans))
    throw new Error("Expected an OTLP JSON export with resourceSpans.");
  const rows: Span[] = [];
  for (const r of payload.resourceSpans) {
    const resource = attributes(r.resource?.attributes);
    for (const scope of r.scopeSpans ?? [])
      for (const span of scope.spans ?? []) {
        if (
          !span.traceId ||
          !span.spanId ||
          !/^\d+$/.test(String(span.startTimeUnixNano)) ||
          !/^\d+$/.test(String(span.endTimeUnixNano))
        )
          throw new Error("A span is missing identifiers or nanosecond timestamps.");
        const start = BigInt(span.startTimeUnixNano),
          end = BigInt(span.endTimeUnixNano);
        if (end < start) throw new Error("A span ends before it starts.");
        rows.push({
          trace_id: span.traceId,
          span_id: span.spanId,
          parent_span_id: span.parentSpanId ?? "",
          name: span.name ?? "span",
          service: String(resource["service.name"] ?? "unknown"),
          run: String(resource["rbench.run"] ?? resource["cfb.run"] ?? "imported"),
          start_ns: start.toString(),
          start_ms: Number(start) / 1e6,
          duration_ms: Number(end - start) / 1e6,
          status: String(span.status?.code ?? 0),
          attributes: JSON.stringify({ resource, span: attributes(span.attributes) }),
        });
      }
  }
  if (!rows.length) throw new Error("The export contains no spans.");
  const seen = new Set<string>();
  return rows.filter((s) => {
    const key = s.trace_id + ":" + s.span_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function kv(record: Record<string, unknown>) {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: { stringValue: typeof value === "string" ? value : JSON.stringify(value) },
  }));
}
export function exportOTLP(spans: Span[]) {
  return {
    resourceSpans: spans.map((s) => {
      const a = JSON.parse(s.attributes || "{}");
      return {
        resource: { attributes: kv({ ...a.resource, "service.name": s.service }) },
        scopeSpans: [
          {
            scope: { name: "loams-traces" },
            spans: [
              {
                traceId: s.trace_id,
                spanId: s.span_id,
                parentSpanId: s.parent_span_id,
                name: s.name,
                startTimeUnixNano: s.start_ns,
                endTimeUnixNano: (
                  BigInt(s.start_ns) + BigInt(Math.round(s.duration_ms * 1e6))
                ).toString(),
                status: { code: Number(s.status) || 0 },
                attributes: kv(a.span ?? {}),
              },
            ],
          },
        ],
      };
    }),
  };
}
export function readOnlySQL(sql: string) {
  const clean = sql.trim().replace(/;\s*$/, "");
  if (
    !/^(SELECT|WITH)\b/i.test(clean) ||
    clean.includes(";") ||
    /\b(INSERT|UPDATE|DELETE|DROP|CREATE|COPY|ATTACH|INSTALL|LOAD|EXPORT|IMPORT)\b/i.test(clean)
  )
    throw new Error("Use one read-only SELECT or WITH query.");
  return clean;
}
export function spanDepth(s: Span, spans: Span[] | Map<string, Span>) {
  const map = spans instanceof Map ? spans : new Map(spans.map((x) => [x.span_id, x]));
  const seen = new Set([s.span_id]);
  let depth = 0,
    parent = s.parent_span_id;
  while (parent && map.has(parent) && depth < 12 && !seen.has(parent)) {
    seen.add(parent);
    depth++;
    parent = map.get(parent)!.parent_span_id;
  }
  return depth;
}
