import { mkdir, copyFile, readFile, writeFile, unlink } from "node:fs/promises";
import { gzipSync } from "node:zlib";
await mkdir("public/wasm", { recursive: true });
for (const name of ["duckdb-mvp", "duckdb-eh"]) {
  const raw = await readFile(`node_modules/@duckdb/duckdb-wasm/dist/${name}.wasm`);
  await writeFile(`public/wasm/${name}.wasm.gz`, gzipSync(raw, { level: 9 }));
  await unlink(`public/wasm/${name}.wasm`).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
}
for (const file of ["duckdb-browser-mvp.worker.js", "duckdb-browser-eh.worker.js"])
  await copyFile(`node_modules/@duckdb/duckdb-wasm/dist/${file}`, `public/wasm/${file}`);
await writeFile(
  "public/_headers",
  `/traces/wasm/duckdb-mvp.wasm.gz\n  Content-Type: application/wasm\n  Content-Encoding: gzip\n\n/traces/wasm/duckdb-eh.wasm.gz\n  Content-Type: application/wasm\n  Content-Encoding: gzip\n`,
);
