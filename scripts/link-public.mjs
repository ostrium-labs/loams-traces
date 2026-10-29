import { readdir, mkdir, link } from "node:fs/promises";
import path from "node:path";
async function copy(from, to) {
  await mkdir(to, { recursive: true });
  for (const file of await readdir(from, { withFileTypes: true })) {
    const a = path.join(from, file.name),
      b = path.join(to, file.name);
    if (file.isDirectory()) await copy(a, b);
    else await link(a, b);
  }
}
await copy("public", "dist");
