import React, { useEffect, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { loadSpans, query } from "./database";
import {
  normalizeOTLP,
  exportOTLP,
  readOnlySQL,
  spanDepth,
  type Span,
  type Trace,
  type Artifact,
  type Measurement,
} from "./model";
import "./style.css";

const number = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(v);
const size = (v: number) => (v > 1e6 ? `${number(v / 1e6)} MB` : `${number(v / 1e3)} kB`);
function save(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const asset = (path: string) => import.meta.env.BASE_URL + path.replace(/^\//, "");
const dataAsset = (path: string) =>
  import.meta.env.VITE_TRACE_DATA_URL
    ? String(import.meta.env.VITE_TRACE_DATA_URL).replace(/\/$/, "") + "/" + path.replace(/^\//, "")
    : asset(path);
async function json(url: string) {
  const r = await fetch(dataAsset(url));
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const bytes = await r.arrayBuffer();
  const magic = new Uint8Array(bytes);
  const text =
    magic[0] === 31 && magic[1] === 139
      ? await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).text()
      : new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

function App() {
  const [tab, setTab] = useState("Traces"),
    [catalog, setCatalog] = useState<Trace[]>([]),
    [manifest, setManifest] = useState<any>(),
    [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [spans, setSpans] = useState<Span[]>([]),
    [selected, setSelected] = useState<Trace>(),
    [span, setSpan] = useState<Span>(),
    [partition, setPartition] = useState(""),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState("Loading the evidence catalog…"),
    [error, setError] = useState(""),
    [wasm, setWasm] = useState(false);
  const [sql, setSql] = useState(
      "SELECT service, name, count(*) AS spans, round(quantile_cont(duration_ms, 0.99), 3) AS p99_ms FROM spans GROUP BY service, name ORDER BY spans DESC LIMIT 100",
    ),
    [result, setResult] = useState<Record<string, unknown>[]>([]),
    [signoz, setSignoz] = useState("http://localhost:3301");
  useEffect(() => {
    Promise.all([
      json("/data/trace-index.json.gz"),
      json("/data/manifest.json"),
      json("/data/measurements.json"),
    ])
      .then(([t, m, r]) => {
        setCatalog(t);
        setManifest(m);
        setMeasurements(r);
        setBusy("");
        if (t[0]) void selectTrace(t[0]);
      })
      .catch((e) => {
        setError(String(e));
        setBusy("");
      });
  }, []);
  async function selectTrace(trace: Trace, targetPage = 0) {
    const chunk = trace.chunks?.[targetPage] ?? trace.chunk;
    setError("");
    setBusy("Opening a trace partition in WebAssembly…");
    try {
      if (partition !== chunk) {
        const response = await fetch(dataAsset(chunk));
        if (!response.ok) throw new Error(`Trace partition: HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const magic = new Uint8Array(bytes);
        const text =
          magic[0] === 31 && magic[1] === 139
            ? await new Response(
                new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
              ).text()
            : new TextDecoder().decode(bytes);
        const rows: Span[] = JSON.parse(text);
        await loadSpans(rows);
        setPartition(chunk);
        setWasm(true);
      }
      const rows = await query(
        `SELECT * FROM spans WHERE trace_id = '${trace.trace_id.replaceAll("'", "''")}' ORDER BY start_ms,span_id`,
      );
      setSpans(rows as unknown as Span[]);
      setSelected(trace);
      setPage(targetPage);
      setSpan(undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy("Importing OTLP locally…");
    setError("");
    try {
      const rows = normalizeOTLP(JSON.parse(await file.text()));
      await loadSpans(rows);
      setPartition("local file");
      setWasm(true);
      const traces = await query(
        "SELECT trace_id,any_value(service) AS service,any_value(run) AS run,any_value(name) AS name,count(*) AS spans,min(start_ms) AS start_ms,max(start_ms+duration_ms)-min(start_ms) AS duration_ms FROM spans GROUP BY trace_id",
      );
      setCatalog(
        traces.map((t) => ({ ...t, spans: Number(t.spans), chunk: "local file" })) as Trace[],
      );
      setSpans(rows.filter((s) => s.trace_id === traces[0].trace_id));
      setSelected({ ...traces[0], chunk: "local file" } as Trace);
      setSpan(undefined);
      setTab("Traces");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function runSQL() {
    setBusy("Querying in DuckDB-Wasm…");
    setError("");
    try {
      setResult(await query(readOnlySQL(sql)));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  const visible = catalog.filter((t) =>
    `${t.service} ${t.run} ${t.name} ${t.trace_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const rows = measurements.filter((m) =>
    `${m.engine} ${m.workload} ${m.source}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const artifacts: Artifact[] = (manifest?.artifacts ?? []).filter((a: Artifact) =>
    `${a.name} ${a.sources[0].repository} ${a.sources[0].path}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const parentMap = useMemo(() => new Map(spans.map((s) => [s.span_id, s])), [spans]);
  const first = spans.length ? spans.reduce((n, s) => Math.min(n, s.start_ms), Infinity) : 0,
    total = spans.length
      ? spans.reduce((n, s) => Math.max(n, s.start_ms + s.duration_ms), -Infinity) - first
      : 1;
  return (
    <>
      <header>
        <a className="brand" href={import.meta.env.BASE_URL}>
          ▥ Loams <span>Traces</span>
        </a>
        <div className="local">
          <i className={wasm ? "ready" : ""} />
          {wasm ? "DuckDB-Wasm ready" : "Browser-local evidence"}
        </div>
        <a href="/benchmarks" target="_blank" rel="noreferrer">
          Benchmark methodology ↗
        </a>
      </header>
      <div className="shell">
        <aside>
          <p className="eyebrow">Evidence explorer</p>
          <nav aria-label="Trace explorer">
            {["Traces", "Benchmarks", "Archive", "SQL"].map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => {
                  setTab(t);
                  setFilter("");
                }}
              >
                {t}
                <span>
                  {t === "Traces"
                    ? number(catalog.length)
                    : t === "Benchmarks"
                      ? number(measurements.length)
                      : t === "Archive"
                        ? number(manifest?.artifacts?.length)
                        : "WASM"}
                </span>
              </button>
            ))}
          </nav>
          <div className="asideNote">
            Your browser does the querying.
            <br />
            No account. No query server.
          </div>
          <label className="import">
            Import OTLP JSON
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
          </label>
          <p className="fine">
            Uploaded files stay on this device. Catalog artifacts are downloaded only when selected.
          </p>
          <a
            className="source"
            href="https://github.com/ostrium-labs/loams-traces"
            target="_blank"
            rel="noreferrer"
          >
            Archive & source ↗
          </a>
        </aside>
        <main>
          <div className="pageHead">
            <div>
              <p className="eyebrow">Loams / {tab.toLowerCase()}</p>
              <h1>
                {tab === "Traces"
                  ? "Follow the work."
                  : tab === "Benchmarks"
                    ? "Measurements, with context."
                    : tab === "Archive"
                      ? "Every artifact has a source."
                      : "Ask the loaded partition."}
              </h1>
            </div>
            <span className="pill">2026-10-29 campaign archive</span>
          </div>
          <div className="stats">
            <div>
              <span>Archived spans</span>
              <strong>{number(manifest?.traceExport?.spans)}</strong>
            </div>
            <div>
              <span>Recorded traces</span>
              <strong>{number(manifest?.traceExport?.traces)}</strong>
            </div>
            <div>
              <span>Measurements indexed</span>
              <strong>{number(measurements.length)}</strong>
            </div>
            <div>
              <span>Raw artifacts</span>
              <strong>{number(manifest?.artifacts?.length)}</strong>
            </div>
          </div>
          {busy && (
            <p className="notice" role="status">
              {busy}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {tab === "Traces" && (
            <>
              <div className="toolbar">
                <label>
                  Find a trace
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Service, run, operation or trace ID"
                  />
                </label>
                <span>{number(visible.length)} matches</span>
              </div>
              <div className="traceLayout">
                <section className="traceList" aria-label="Recorded traces">
                  {visible.slice(0, 150).map((t) => (
                    <button
                      key={t.trace_id}
                      disabled={!!busy}
                      className={selected?.trace_id === t.trace_id ? "selected" : ""}
                      onClick={() => void selectTrace(t)}
                    >
                      <strong>{t.name}</strong>
                      <span>
                        {t.service} · {t.run}
                      </span>
                      <small>
                        {number(t.spans)} spans <b>{number(t.duration_ms)} ms</b>
                      </small>
                    </button>
                  ))}
                  {visible.length > 150 && (
                    <p className="fine">
                      Showing 150. Refine the search to find any trace in the archive.
                    </p>
                  )}
                </section>
                <section className="traceDetail" aria-label="Trace waterfall">
                  <div className="detailHead">
                    <h2>{selected?.name ?? "Select a trace"}</h2>
                    <code>{selected?.trace_id}</code>
                    <p>
                      {selected?.service} · {selected?.run}
                    </p>
                    <button
                      disabled={!spans.length}
                      onClick={() => save(`${selected?.trace_id}.otlp.json`, exportOTLP(spans))}
                    >
                      Export displayed spans as OTLP
                    </button>
                  </div>
                  {selected && (selected.chunks?.length ?? 1) > 1 && (
                    <div className="pageControls">
                      <p>
                        Span page {page + 1} of {selected.chunks!.length}. This trace has{" "}
                        {number(selected.spans)} spans in total; SQL and export apply to the current
                        page.
                      </p>
                      <button
                        disabled={!!busy || page === 0}
                        onClick={() => void selectTrace(selected, page - 1)}
                      >
                        Previous span page
                      </button>
                      <button
                        disabled={!!busy || page + 1 >= selected.chunks!.length}
                        onClick={() => void selectTrace(selected, page + 1)}
                      >
                        Next span page
                      </button>
                    </div>
                  )}
                  <div className="waterfallScale">
                    <span>Operation</span>
                    <span>0 → {number(total)} ms</span>
                  </div>
                  {spans.slice(0, 1000).map((s) => (
                    <button
                      className={`spanRow ${span?.span_id === s.span_id ? "active" : ""}`}
                      key={s.span_id}
                      onClick={() => setSpan(s)}
                    >
                      <span
                        className="spanName"
                        style={{ paddingLeft: `${8 + spanDepth(s, parentMap) * 10}px` }}
                      >
                        {s.name}
                        <small>{s.service}</small>
                      </span>
                      <span className="track">
                        <i
                          style={{
                            left: `${Math.max(0, ((s.start_ms - first) / Math.max(total, 0.001)) * 100)}%`,
                            width: `${Math.max(0.3, (s.duration_ms / Math.max(total, 0.001)) * 100)}%`,
                          }}
                        />
                        <b>{number(s.duration_ms)} ms</b>
                      </span>
                    </button>
                  ))}
                  {spans.length > 1000 && (
                    <p className="fine">
                      Waterfall shows the first 1,000 spans. All selected spans are retained in SQL
                      and OTLP export.
                    </p>
                  )}
                  {span && (
                    <div className="spanAttributes">
                      <h3>{span.name}</h3>
                      <p>
                        {number(span.duration_ms)} ms · status {span.status} ·{" "}
                        <code>{span.span_id}</code>
                      </p>
                      <pre>{JSON.stringify(JSON.parse(span.attributes || "{}"), null, 2)}</pre>
                    </div>
                  )}
                  <details className="signoz">
                    <summary>View this trace in your SigNoz instance</summary>
                    <p>
                      Import the OTLP export into your collector first. SigNoz needs its own
                      backend; this browser explorer queries the same span format locally.
                    </p>
                    <label>
                      SigNoz instance URL
                      <input value={signoz} onChange={(e) => setSignoz(e.target.value)} />
                    </label>
                    {/^https?:\/\//.test(signoz) && selected && (
                      <a
                        href={`${signoz.replace(/\/$/, "")}/trace/${encodeURIComponent(selected.trace_id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open matching trace in SigNoz ↗
                      </a>
                    )}
                  </details>
                </section>
              </div>
            </>
          )}
          {tab === "Benchmarks" && (
            <>
              <p className="notice">
                These measurements cover different dates, source revisions, hardware and units.
                Never add them into one QPS total. A blank rate means successful throughput was not
                established. Historical results are not Loams 0.1.3 capacity claims.
              </p>
              <div className="toolbar">
                <label>
                  Filter measurements
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Engine, workload or source"
                  />
                </label>
                <button onClick={() => save("loams-measurements.json", rows)}>
                  Download filtered results
                </button>
              </div>
              <div className="tableScroll">
                <table>
                  <thead>
                    <tr>
                      <th>Engine / workload</th>
                      <th>Rate</th>
                      <th>Unit</th>
                      <th>Errors</th>
                      <th>p99 ms</th>
                      <th>Source / conditions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 1000).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.engine}</strong>
                          <span>{r.workload}</span>
                        </td>
                        <td>{number(r.rate)}</td>
                        <td>{r.unit}</td>
                        <td className={r.errors ? "bad" : ""}>{number(r.errors)}</td>
                        <td>{number(r.p99_ms)}</td>
                        <td>
                          <a href={dataAsset(r.path)} target="_blank" rel="noreferrer">
                            Raw artifact ↗
                          </a>
                          <small>
                            {r.build}. {r.note}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === "Archive" && (
            <>
              <p className="notice">
                Content-addressed originals with SHA-256 checksums and source revisions. Large
                compressed OTLP exports are split into ordered parts; concatenate them to
                reconstruct the original file. Browser partitions are derived from these exports.
              </p>
              <div className="toolbar">
                <label>
                  Find an artifact
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="File, repository or source path"
                  />
                </label>
                <a className="button" href={dataAsset("/data/manifest.json")} download>
                  Download full manifest
                </a>
              </div>
              <div className="tableScroll">
                <table>
                  <thead>
                    <tr>
                      <th>Artifact</th>
                      <th>Source</th>
                      <th>Size</th>
                      <th>Integrity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artifacts.slice(0, 250).map((a) => (
                      <tr key={a.id + (a.path ?? a.name)}>
                        <td>
                          {a.path ? (
                            <a href={dataAsset(a.path)} download={a.name}>
                              {a.name} ↓
                            </a>
                          ) : (
                            <details>
                              <summary>
                                {a.name} · {a.parts?.length} parts
                              </summary>
                              {a.parts?.map((p, i) => (
                                <a className="part" href={dataAsset(p.path)} key={p.path} download>
                                  {i + 1}. {size(p.bytes)} ↓
                                </a>
                              ))}
                            </details>
                          )}
                        </td>
                        <td>
                          {a.sources[0].repository}
                          <small>{a.sources[0].path}</small>
                          <small>revision {a.sources[0].revision}</small>
                        </td>
                        <td>{size(a.bytes)}</td>
                        <td>
                          <code title={a.sha256}>{a.sha256.slice(0, 16)}…</code>
                          <small>
                            {a.sanitized ? "Sanitized export" : "Original bytes"} ·{" "}
                            {a.sources.length} source references
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="fine">
                Showing {Math.min(250, artifacts.length)} of {number(artifacts.length)} matches.
                Search narrows the complete archive.
              </p>
            </>
          )}
          {tab === "SQL" && (
            <>
              <p className="notice">
                SQL runs in a WebAssembly worker on the currently loaded trace partition. It does
                not query the entire archive. Table: <code>spans</code>. Load another trace to
                switch partitions.
              </p>
              <label className="sqlLabel">
                Read-only SQL
                <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={6} />
              </label>
              <button className="primary" disabled={!!busy || !wasm} onClick={() => void runSQL()}>
                Run in browser
              </button>
              <div className="tableScroll">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(result[0] ?? {}).map((k) => (
                        <th key={k}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.slice(0, 1000).map((r, i) => (
                      <tr key={i}>
                        {Object.keys(r).map((k) => (
                          <td key={k}>{String(r[k] ?? "NULL")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.length > 0 && (
                <button onClick={() => save("query-result.json", result)}>
                  Download all {number(result.length)} rows
                </button>
              )}
            </>
          )}
          <footer>
            Loams Traces · Apache-2.0 · DuckDB-Wasm is MIT licensed. An independent browser explorer
            with SigNoz-compatible OTLP export; not the SigNoz application.
          </footer>
        </main>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
