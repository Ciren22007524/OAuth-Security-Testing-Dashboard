// Mark the modified application honestly unsigned; never retain Node's invalid vendor signature.
export function removeWindowsSignature(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ")
    throw new Error("Invalid PE binary");
  const pe = bytes.readUInt32LE(0x3c);
  if (
    pe + 24 + 152 > bytes.length ||
    bytes.toString("ascii", pe, pe + 4) !== "PE\0\0"
  )
    throw new Error("Invalid PE header");
  const optional = pe + 24;
  const magic = bytes.readUInt16LE(optional);
  const directory =
    optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0);
  if (directory === optional) throw new Error("Unsupported PE header");
  const security = directory + 4 * 8;
  const offset = bytes.readUInt32LE(security);
  const size = bytes.readUInt32LE(security + 4);
  if (offset && (offset + size > bytes.length || offset < security + 8))
    throw new Error("Invalid PE certificate bounds");
  bytes.writeUInt32LE(0, security);
  bytes.writeUInt32LE(0, security + 4);
  bytes.writeUInt32LE(0, optional + 64);
  if (offset && size) {
    if (offset + size === bytes.length) return bytes.subarray(0, offset);
    bytes.fill(0, offset, offset + size);
  }
  return bytes;
}
