# Loams Traces

Benchmark evidence and a browser-local trace explorer for Loams. The archive retains original results, failures, source revisions and SHA-256 checksums. Historical measurements are not claims about Loams 0.1.3 release capacity.

The app uses Vite+ and DuckDB-Wasm. It renders real trace waterfalls, span attributes, benchmark measurements and the artifact catalog. Read-only SQL runs in a WebAssembly worker against the selected partition. Local file imports stay in the browser. No query backend or account is required. Local development reads the included data. A prepared website build can set VITE_TRACE_DATA_URL to an immutable public-data revision; the SQL still runs only in the browser.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the printed `/traces/` URL. `pnpm build` creates a static distribution in `dist/`; `pnpm preview` serves it. WASM assets are generated from the locked dependency and gzip compressed. Honor `dist/_headers` when hosting: the `.wasm.gz` files require `Content-Type: application/wasm` and `Content-Encoding: gzip`.

## Evidence and limits

`public/data/manifest.json` is the provenance index. Original artifacts live under `public/data/objects/`. Identical bytes across worktrees are stored once, retaining every distinct source reference. Large zstd-compressed OpenTelemetry file-exporter outputs are stored in ordered binary parts. Reassemble without modifying the bytes:

```sh
python3 scripts/reassemble.py ARTIFACT_SHA256 /path/to/new-output-file
python3 scripts/verify_archive.py
```

`public/data/spans/` holds derived, gzip-compressed span partitions. The compressed trace catalog points to each partition. Very large traces are divided into span pages; SQL, waterfall and OTLP export apply to the displayed page. The original full exports remain available. Span identities are deduplicated by trace ID plus span ID. Original nanosecond timestamps are retained as strings; browser timelines use milliseconds. The original compressed exporter frames remain available for independent decoding. No unrelated NativeLink telemetry from the currently running collector is counted as benchmark evidence.

`public/data/measurements.json` indexes individual recorded rates. It does not add unlike units, manufacture missing results or turn offered requests into successful completions. Debug binaries, release clients, warmed read-only SQL, in-process operations and WAN bursts are different experiments. The billion-QPS and billion-concurrent-agent targets are not established. See the source reports and each raw record before comparing values. A completed campaign does not imply every engine passed a release-capacity gate.

Product names: Loams Batch is the requested Spice-based Spark engine design; existing Sail measurements do not establish Spice backend performance. Loams Flow names the Airflow integration, Loams KV is Redis-compatible, and Loams CQL is separate. Event Fabric combines a Trino-compatible query surface and connectors; broker-only measurements do not prove connector delivery or Trino conformance.

## SigNoz compatibility

This is an independent viewer, not a WASM port of SigNoz. SigNoz requires its backend and ClickHouse. Export a selected trace as OTLP JSON, then send it to your own collector:

```sh
curl -H 'Content-Type: application/json' --data-binary @trace.otlp.json http://127.0.0.1:4318/v1/traces
```

After ingestion, use the app's configurable SigNoz link to open the matching trace. Nothing is uploaded automatically. Credentials and live database files are not part of this archive.

## Validate

```sh
pnpm test
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/verify_archive.py
pnpm build
```

Migration scripts document the local sources used to produce the archive. They are explicit data-preparation tools, not part of the app startup. Install `ijson==3.4.0` in a data-tool virtual environment for streaming repartitioning. Python 3.14 is needed for normalization of framed zstd exports. The benchmark driver repository remains [loams-bench](https://github.com/ostrium-labs/loams-bench).

To mount this distribution in the Loams website, build it, then run the site's `scripts/sync-trace-explorer.mjs` with `LOAMS_TRACES_DIST` set to this `dist/` directory before building the website. Raw artifacts remain owned by this repository.

## Licenses

Loams Traces code and first-party benchmark artifacts: Apache-2.0. DuckDB-Wasm and Vite+: MIT. React: MIT. The UI is original code and does not include SigNoz source. Each external system's name remains its owner's trademark.

Primary references: [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview), [Vite+](https://www.viteplus.dev/guide), [SigNoz architecture](https://signoz.io/docs/architecture/).
