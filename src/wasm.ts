/** Hosts differ on whether .gz assets are decoded before or after their header rules. */
export async function decodeWasm(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const magic = new Uint8Array(bytes);
  if (magic[0] === 31 && magic[1] === 139)
    bytes = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
  const decoded = new Uint8Array(bytes);
  if (
    decoded.length < 8 ||
    decoded[0] !== 0 ||
    decoded[1] !== 97 ||
    decoded[2] !== 115 ||
    decoded[3] !== 109
  )
    throw new Error("The query-engine asset is not a valid WebAssembly module.");
  return bytes;
}
