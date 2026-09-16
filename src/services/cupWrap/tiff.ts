/** Baseline little-endian TIFF, unassociated RGBA, one uncompressed strip. */
export function encodeTiff(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  dpi: number,
): ArrayBuffer {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    rgba.length !== width * height * 4 ||
    !Number.isFinite(dpi) ||
    dpi <= 0
  )
    throw new Error("无效 TIFF 参数");
  const count = 14,
    extras = 8 + 2 + count * 12 + 4,
    pixels = extras + 8 + 16;
  const buffer = new ArrayBuffer(pixels + rgba.length),
    v = new DataView(buffer);
  v.setUint16(0, 0x4949, true);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, count, true);
  let offset = 10;
  const tag = (id: number, type: number, n: number, value: number) => {
    v.setUint16(offset, id, true);
    v.setUint16(offset + 2, type, true);
    v.setUint32(offset + 4, n, true);
    if (type === 3 && n === 1) v.setUint16(offset + 8, value, true);
    else v.setUint32(offset + 8, value, true);
    offset += 12;
  };
  tag(256, 4, 1, width);
  tag(257, 4, 1, height);
  tag(258, 3, 4, extras);
  tag(259, 3, 1, 1);
  tag(262, 3, 1, 2);
  tag(273, 4, 1, pixels);
  tag(277, 3, 1, 4);
  tag(278, 4, 1, height);
  tag(279, 4, 1, rgba.length);
  tag(282, 5, 1, extras + 8);
  tag(283, 5, 1, extras + 16);
  tag(284, 3, 1, 1);
  tag(296, 3, 1, 2);
  tag(338, 3, 1, 2);
  for (let i = 0; i < 4; i++) v.setUint16(extras + i * 2, 8, true);
  for (const p of [extras + 8, extras + 16]) {
    v.setUint32(p, Math.round(dpi * 1000), true);
    v.setUint32(p + 4, 1000, true);
  }
  new Uint8Array(buffer, pixels).set(rgba);
  return buffer;
}
