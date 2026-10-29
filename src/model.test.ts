import { describe, it, expect } from "vite-plus/test";
import { normalizeOTLP, exportOTLP, readOnlySQL, spanDepth } from "./model";
const payload = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: "service.name", value: { stringValue: "bench" } }] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: "a".repeat(32),
              spanId: "b".repeat(16),
              name: "operation",
              startTimeUnixNano: "1793154380372851444",
              endTimeUnixNano: "1793154380372852445",
            },
          ],
        },
      ],
    },
  ],
};
describe("trace integrity", () => {
  it("preserves nanosecond timestamps through OTLP export", () => {
    const spans = normalizeOTLP(payload);
    expect(spans[0].duration_ms).toBe(0.001001);
    const out = exportOTLP(spans);
    expect(out.resourceSpans[0].scopeSpans[0].spans[0].endTimeUnixNano).toBe("1793154380372852445");
  });
  it("deduplicates span identities", () => {
    const duplicated = structuredClone(payload);
    duplicated.resourceSpans.push(structuredClone(payload.resourceSpans[0]));
    expect(normalizeOTLP(duplicated)).toHaveLength(1);
  });
  it("rejects negative durations and empty exports", () => {
    expect(() => normalizeOTLP({ resourceSpans: [] })).toThrow();
    const bad = structuredClone(payload);
    bad.resourceSpans[0].scopeSpans[0].spans[0].endTimeUnixNano = "0";
    expect(() => normalizeOTLP(bad)).toThrow();
  });
  it("does not loop on cyclic parents", () => {
    const s = normalizeOTLP(payload)[0];
    s.parent_span_id = s.span_id;
    expect(spanDepth(s, [s])).toBe(0);
  });
  it("only accepts a single read-only SQL statement", () => {
    expect(readOnlySQL("SELECT * FROM spans;")).toBe("SELECT * FROM spans");
    expect(() => readOnlySQL("SELECT 1; DROP TABLE spans")).toThrow();
    expect(() => readOnlySQL("COPY spans TO x")).toThrow();
  });
});
