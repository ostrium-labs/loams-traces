import * as duckdb from "@duckdb/duckdb-wasm";
import type { Span } from "./model";
const asset = (name: string) => import.meta.env.BASE_URL + "wasm/" + name;
let instance: Promise<duckdb.AsyncDuckDB> | undefined;
async function database() {
  if (!instance)
    instance = (async () => {
      const bundle = await duckdb.selectBundle({
        mvp: {
          mainModule: asset("duckdb-mvp.wasm.gz"),
          mainWorker: asset("duckdb-browser-mvp.worker.js"),
        },
        eh: {
          mainModule: asset("duckdb-eh.wasm.gz"),
          mainWorker: asset("duckdb-browser-eh.worker.js"),
        },
      });
      const db = new duckdb.AsyncDuckDB(
        new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR),
        new Worker(bundle.mainWorker!),
      );
      await db.instantiate(bundle.mainModule);
      return db;
    })().catch((error) => {
      instance = undefined;
      throw error;
    });
  return instance;
}
let active: duckdb.AsyncDuckDBConnection | undefined;
export async function loadSpans(spans: Span[]) {
  const seen = new Set<string>();
  spans = spans.filter((s) => {
    const key = s.trace_id + ":" + s.span_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const db = await database();
  if (active) await active.close();
  active = await db.connect();
  await db.registerFileText("active-spans.json", JSON.stringify(spans));
  await active.query(
    "CREATE OR REPLACE TABLE spans AS SELECT trace_id::VARCHAR AS trace_id, span_id::VARCHAR AS span_id, parent_span_id::VARCHAR AS parent_span_id, name::VARCHAR AS name, service::VARCHAR AS service, run::VARCHAR AS run, start_ns::VARCHAR AS start_ns, start_ms::DOUBLE AS start_ms, duration_ms::DOUBLE AS duration_ms, status::VARCHAR AS status, attributes::VARCHAR AS attributes FROM read_json_auto('active-spans.json', maximum_object_size=16777216)",
  );
}
export async function query(sql: string): Promise<Record<string, unknown>[]> {
  if (!active) throw new Error("Load a trace partition first.");
  const result = await active.query(sql);
  return result
    .toArray()
    .map((row) =>
      JSON.parse(JSON.stringify(row, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
    );
}
