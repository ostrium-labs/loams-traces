import { describe, it, expect } from "vite-plus/test";
import { gzipSync } from "node:zlib";
import { decodeWasm } from "./wasm";
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
describe("WASM asset transport", () => {
  it("accepts a module already decoded by HTTP", async () => {
    expect(new Uint8Array(await decodeWasm(bytes.buffer))).toEqual(bytes);
  });
  it("decodes a gzip body left after a hosting layer handles content encoding", async () => {
    const compressed = gzipSync(bytes);
    expect(new Uint8Array(await decodeWasm(Uint8Array.from(compressed).buffer))).toEqual(bytes);
  });
  it("rejects an HTML response before worker instantiation", async () => {
    await expect(
      decodeWasm(new TextEncoder().encode("<html>Not found</html>").buffer),
    ).rejects.toThrow("WebAssembly");
  });
});
