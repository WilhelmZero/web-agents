import { writePsd, type Layer, type Psd } from "ag-psd";

export const SPOT_TIFF_WIDTH = 7717;
export const SPOT_TIFF_HEIGHT = 4346;
export const SPOT_TIFF_DPI = 800;
// Photoshop layer flags: bit 3 marks the flags as meaningful and bit 1 hides
// the layer. The flattened RGB composite still contains the white backdrop.
export const HIDDEN_BACKGROUND_LAYER_FLAGS = 0x0a;
export const DEFAULT_SPOT_PLACEMENT = {
  centerX: (2491 + 5227) / 2,
  centerY: (743 + 3603) / 2,
  frameWidth: 5227 - 2491,
  frameHeight: 3603 - 743,
} as const;

export type SpotRgbMode = "color" | "black";
export interface SpotPlacement {
  centerX: number;
  centerY: number;
  frameWidth: number;
  frameHeight: number;
}
export interface SpotLayerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface SpotTiffEncodeInput {
  width: number;
  height: number;
  dpi: number;
  layer: {
    rgba: Uint8ClampedArray;
    bounds: SpotLayerBounds;
    embeddedPng: Uint8Array;
    embeddedWidth: number;
    embeddedHeight: number;
    embeddedName: string;
  };
}

const ascii = (value: string) => new TextEncoder().encode(value);
const align = (value: number, multiple: number) =>
  Math.ceil(value / multiple) * multiple;

class ByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;
  push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
  }
  u8(value: number) {
    this.push(Uint8Array.of(value & 0xff));
  }
  u16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, false);
    this.push(bytes);
  }
  i16(value: number) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setInt16(0, value, false);
    this.push(bytes);
  }
  u32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    this.push(bytes);
  }
  i32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, false);
    this.push(bytes);
  }
  signature(value: string) {
    if (value.length !== 4) throw new Error(`Invalid signature: ${value}`);
    this.push(ascii(value));
  }
  pad(multiple: number) {
    const target = align(this.length, multiple);
    if (target > this.length) this.push(new Uint8Array(target - this.length));
  }
  finish() {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
}

export function containSpotLayer(
  imageWidth: number,
  imageHeight: number,
  placement: SpotPlacement,
  canvasWidth = SPOT_TIFF_WIDTH,
  canvasHeight = SPOT_TIFF_HEIGHT,
): SpotLayerBounds {
  if (imageWidth <= 0 || imageHeight <= 0) throw new Error("图片尺寸无效");
  const frameWidth = Math.max(1, Math.min(canvasWidth, placement.frameWidth));
  const frameHeight = Math.max(1, Math.min(canvasHeight, placement.frameHeight));
  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  const centerX = Math.max(width / 2, Math.min(canvasWidth - width / 2, placement.centerX));
  const centerY = Math.max(height / 2, Math.min(canvasHeight - height / 2, placement.centerY));
  return {
    left: Math.round(centerX - width / 2),
    top: Math.round(centerY - height / 2),
    width,
    height,
  };
}

export function clampSpotPlacement(
  placement: SpotPlacement,
  canvasWidth = SPOT_TIFF_WIDTH,
  canvasHeight = SPOT_TIFF_HEIGHT,
): SpotPlacement {
  const frameWidth = Math.max(64, Math.min(canvasWidth, Math.round(placement.frameWidth)));
  const frameHeight = Math.max(64, Math.min(canvasHeight, Math.round(placement.frameHeight)));
  return {
    frameWidth,
    frameHeight,
    centerX: Math.round(Math.max(frameWidth / 2, Math.min(canvasWidth - frameWidth / 2, placement.centerX))),
    centerY: Math.round(Math.max(frameHeight / 2, Math.min(canvasHeight - frameHeight / 2, placement.centerY))),
  };
}

/** PackBits-encodes one constant row without allocating the uncompressed row. */
function constantPackBitsRow(width: number, value: number) {
  const result = new Uint8Array(Math.ceil(width / 128) * 2);
  let remaining = width;
  let offset = 0;
  while (remaining > 0) {
    const count = Math.min(128, remaining);
    result[offset++] = 257 - count;
    result[offset++] = value;
    remaining -= count;
  }
  return result.subarray(0, offset);
}

function constantRleChannel(width: number, height: number, value: number) {
  const row = constantPackBitsRow(width, value);
  if (row.byteLength > 0xffff) throw new Error("RLE 行数据过长");
  const result = new Uint8Array(2 + height * 2 + row.byteLength * height);
  const view = new DataView(result.buffer);
  view.setUint16(0, 1, false);
  let dataOffset = 2 + height * 2;
  for (let y = 0; y < height; y += 1) {
    view.setUint16(2 + y * 2, row.byteLength, false);
    result.set(row, dataOffset);
    dataOffset += row.byteLength;
  }
  return result;
}

function unicodeAdditionalInfo(key: string, value: string) {
  const payload = new ByteWriter();
  payload.u32(value.length);
  for (let i = 0; i < value.length; i += 1) payload.u16(value.charCodeAt(i));
  const bytes = payload.finish();
  const result = new ByteWriter();
  result.signature("8BIM");
  result.signature(key);
  result.u32(bytes.byteLength);
  result.push(bytes);
  result.pad(4);
  return result.finish();
}

function backgroundLayerRecord(width: number, height: number, channelLength: number) {
  const extra = new ByteWriter();
  extra.u32(0);
  extra.u32(0);
  const legacyName = ascii("Background");
  extra.u8(legacyName.byteLength);
  extra.push(legacyName);
  extra.pad(4);
  extra.push(unicodeAdditionalInfo("luni", "背景"));
  const extraBytes = extra.finish();

  const record = new ByteWriter();
  record.i32(0);
  record.i32(0);
  record.i32(height);
  record.i32(width);
  record.u16(3);
  for (const id of [0, 1, 2]) {
    record.i16(id);
    record.u32(channelLength);
  }
  record.signature("8BIM");
  record.signature("norm");
  record.u8(255);
  record.u8(0);
  record.u8(HIDDEN_BACKGROUND_LAYER_FLAGS);
  record.u8(0);
  record.u32(extraBytes.byteLength);
  record.push(extraBytes);
  return record.finish();
}

interface ExtractedPsdParts {
  smartRecord: Uint8Array;
  smartChannels: Uint8Array;
  globalMask: Uint8Array;
  documentAdditional: Uint8Array;
}

function extractPsdParts(buffer: ArrayBuffer): ExtractedPsdParts {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 26;
  for (let section = 0; section < 2; section += 1) {
    const length = view.getUint32(offset, false);
    offset += 4 + length;
  }
  const layerMaskLength = view.getUint32(offset, false);
  offset += 4;
  const layerMaskEnd = offset + layerMaskLength;
  const layerInfoLength = view.getUint32(offset, false);
  offset += 4;
  const layerInfoStart = offset;
  const layerInfoEnd = layerInfoStart + layerInfoLength;
  const count = Math.abs(view.getInt16(offset, false));
  offset += 2;
  if (count !== 1) throw new Error("智能对象 PSD 图层数量异常");
  const recordStart = offset;
  offset += 16;
  const channelCount = view.getUint16(offset, false);
  offset += 2;
  let channelBytes = 0;
  for (let channel = 0; channel < channelCount; channel += 1) {
    offset += 2;
    channelBytes += view.getUint32(offset, false);
    offset += 4;
  }
  offset += 12;
  const extraLength = view.getUint32(offset, false);
  offset += 4 + extraLength;
  const recordEnd = offset;
  const channelStart = recordEnd;
  const channelEnd = channelStart + channelBytes;
  if (channelEnd > layerInfoEnd) throw new Error("智能对象 PSD 通道数据损坏");
  offset = layerInfoEnd + ((4 - (layerInfoLength % 4)) % 4);
  const globalMaskLength = view.getUint32(offset, false);
  offset += 4;
  const globalMask = bytes.slice(offset, offset + globalMaskLength);
  offset += globalMaskLength;
  return {
    smartRecord: bytes.slice(recordStart, recordEnd),
    smartChannels: bytes.slice(channelStart, channelEnd),
    globalMask,
    documentAdditional: bytes.slice(offset, layerMaskEnd),
  };
}

function createSmartObjectPsd(input: SpotTiffEncodeInput) {
  const { bounds } = input.layer;
  const id = crypto.randomUUID();
  const layer: Layer = {
    name: "A",
    left: bounds.left,
    top: bounds.top,
    right: bounds.left + bounds.width,
    bottom: bounds.top + bounds.height,
    imageData: {
      width: bounds.width,
      height: bounds.height,
      data: input.layer.rgba,
    },
    placedLayer: {
      id,
      type: "raster",
      transform: [
        bounds.left,
        bounds.top,
        bounds.left + bounds.width,
        bounds.top,
        bounds.left + bounds.width,
        bounds.top + bounds.height,
        bounds.left,
        bounds.top + bounds.height,
      ],
      width: input.layer.embeddedWidth,
      height: input.layer.embeddedHeight,
    },
  };
  const psd: Psd = {
    // A tiny document avoids allocating a second full-size composite. Layer
    // coordinates and placed-layer transforms remain in final TIFF space.
    width: 1,
    height: 1,
    children: [layer],
    linkedFiles: [
      {
        id,
        name: input.layer.embeddedName,
        type: "PNGf",
        creator: "8BIM",
        data: input.layer.embeddedPng,
      },
    ],
  };
  return writePsd(psd, { noBackground: true });
}

function photoshopBlock(key: string, payload: Uint8Array) {
  const writer = new ByteWriter();
  writer.signature("8BIM");
  writer.signature(key);
  writer.u32(payload.byteLength);
  writer.push(payload);
  writer.pad(4);
  return writer.finish();
}

function createImageSourceData(input: SpotTiffEncodeInput) {
  const psd = createSmartObjectPsd(input);
  const parts = extractPsdParts(psd);
  const backgroundChannel = constantRleChannel(input.width, input.height, 255);
  const layerInfo = new ByteWriter();
  layerInfo.i16(2);
  layerInfo.push(backgroundLayerRecord(input.width, input.height, backgroundChannel.byteLength));
  layerInfo.push(parts.smartRecord);
  layerInfo.push(backgroundChannel);
  layerInfo.push(backgroundChannel);
  layerInfo.push(backgroundChannel);
  layerInfo.push(parts.smartChannels);

  const result = new ByteWriter();
  result.push(ascii("Adobe Photoshop Document Data Block"));
  result.u8(0);
  result.push(photoshopBlock("Layr", layerInfo.finish()));
  result.push(photoshopBlock("LMsk", parts.globalMask));
  result.push(parts.documentAdditional);
  return result.finish();
}

function resource(id: number, payload: Uint8Array) {
  const writer = new ByteWriter();
  writer.signature("8BIM");
  writer.u16(id);
  writer.u8(0);
  writer.u8(0);
  writer.u32(payload.byteLength);
  writer.push(payload);
  writer.pad(2);
  return writer.finish();
}

function unicodeChannelNames(names: string[]) {
  const writer = new ByteWriter();
  for (const name of names) {
    writer.u32(name.length);
    for (let i = 0; i < name.length; i += 1) writer.u16(name.charCodeAt(i));
  }
  return writer.finish();
}

function createPhotoshopResources(dpi: number) {
  const resolution = new ByteWriter();
  resolution.u32(Math.round(dpi * 65536));
  resolution.u16(1);
  resolution.u16(2);
  resolution.u32(Math.round(dpi * 65536));
  resolution.u16(1);
  resolution.u16(2);
  const names = ["专色 1 拷贝", "专色 1 拷贝 2"];
  // Legacy Photoshop channel names use the same GBK bytes as the supplied
  // reference. Resource 1045 below carries the authoritative Unicode names.
  const legacyNames = Uint8Array.from([
    0x0b, 0xd7, 0xa8, 0xc9, 0xab, 0x20, 0x31, 0x20, 0xbf, 0xbd, 0xb1, 0xb4,
    0x0d, 0xd7, 0xa8, 0xc9, 0xab, 0x20, 0x31, 0x20, 0xbf, 0xbd, 0xb1, 0xb4,
    0x20, 0x32,
  ]);
  const displayInfo = Uint8Array.from([
    0, 0, 0, 1, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 100, 2,
    0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 100, 2,
  ]);
  const writer = new ByteWriter();
  writer.push(resource(1005, resolution.finish()));
  writer.push(resource(1006, legacyNames));
  writer.push(resource(1045, unicodeChannelNames(names)));
  writer.push(resource(1077, displayInfo));
  return writer.finish();
}

function tiffEntry(view: DataView, offset: number, tag: number, type: number, count: number, value: number) {
  view.setUint16(offset, tag, false);
  view.setUint16(offset + 2, type, false);
  view.setUint32(offset + 4, count, false);
  if (type === 3 && count === 1) view.setUint16(offset + 8, value, false);
  else view.setUint32(offset + 8, value, false);
}

export function encodeSpotColorTiff(input: SpotTiffEncodeInput): ArrayBuffer {
  const { width, height, dpi, layer } = input;
  if (layer.rgba.byteLength !== layer.bounds.width * layer.bounds.height * 4)
    throw new Error("Logo 图层像素尺寸不匹配");
  const resources = createPhotoshopResources(dpi);
  const imageSource = createImageSourceData(input);
  const entryCount = 19;
  const ifdEnd = 8 + 2 + entryCount * 12 + 4;
  const bitsOffset = ifdEnd;
  const xResolutionOffset = bitsOffset + 10;
  const yResolutionOffset = xResolutionOffset + 8;
  const software = ascii("Scene Studio\0");
  const softwareOffset = yResolutionOffset + 8;
  const resourcesOffset = align(softwareOffset + software.byteLength, 4);
  const pixelOffset = align(resourcesOffset + resources.byteLength, 4);
  const pixelLength = width * height * 5;
  const imageSourceOffset = align(pixelOffset + pixelLength, 4);
  const buffer = new ArrayBuffer(imageSourceOffset + imageSource.byteLength);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set(ascii("MM"), 0);
  view.setUint16(2, 42, false);
  view.setUint32(4, 8, false);
  view.setUint16(8, entryCount, false);
  let entryOffset = 10;
  const add = (tag: number, type: number, count: number, value: number) => {
    tiffEntry(view, entryOffset, tag, type, count, value);
    entryOffset += 12;
  };
  add(254, 4, 1, 0);
  add(256, 4, 1, width);
  add(257, 4, 1, height);
  add(258, 3, 5, bitsOffset);
  add(259, 3, 1, 1);
  add(262, 3, 1, 2);
  add(273, 4, 1, pixelOffset);
  add(274, 3, 1, 1);
  add(277, 3, 1, 5);
  add(278, 4, 1, height);
  add(279, 4, 1, pixelLength);
  add(282, 5, 1, xResolutionOffset);
  add(283, 5, 1, yResolutionOffset);
  add(284, 3, 1, 1);
  add(296, 3, 1, 2);
  add(305, 2, software.byteLength, softwareOffset);
  // Two unspecified extra samples are interpreted by Photoshop as spot channels.
  add(338, 3, 2, 0);
  add(34377, 1, resources.byteLength, resourcesOffset);
  add(37724, 7, imageSource.byteLength, imageSourceOffset);
  view.setUint32(10 + entryCount * 12, 0, false);
  for (let index = 0; index < 5; index += 1) view.setUint16(bitsOffset + index * 2, 8, false);
  for (const offset of [xResolutionOffset, yResolutionOffset]) {
    view.setUint32(offset, dpi, false);
    view.setUint32(offset + 4, 1, false);
  }
  bytes.set(software, softwareOffset);
  bytes.set(resources, resourcesOffset);

  const { left, top, width: layerWidth, height: layerHeight } = layer.bounds;
  const source = layer.rgba;
  let target = pixelOffset;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= left && x < left + layerWidth && y >= top && y < top + layerHeight) {
        const sourceOffset = ((y - top) * layerWidth + (x - left)) * 4;
        const alpha = source[sourceOffset + 3] / 255;
        const inverse = 1 - alpha;
        const red = Math.round(source[sourceOffset] * alpha + 255 * inverse);
        const green = Math.round(source[sourceOffset + 1] * alpha + 255 * inverse);
        const blue = Math.round(source[sourceOffset + 2] * alpha + 255 * inverse);
        bytes[target++] = red;
        bytes[target++] = green;
        bytes[target++] = blue;
        bytes[target++] = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
        bytes[target++] = 255 - source[sourceOffset + 3];
      } else {
        bytes[target++] = 255;
        bytes[target++] = 255;
        bytes[target++] = 255;
        bytes[target++] = 255;
        bytes[target++] = 255;
      }
    }
  }
  bytes.set(imageSource, imageSourceOffset);
  return buffer;
}

export function inspectSpotTiff(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const bigEndian = String.fromCharCode(view.getUint8(0), view.getUint8(1)) === "MM";
  const littleEndian = !bigEndian;
  const ifd = view.getUint32(4, littleEndian);
  const count = view.getUint16(ifd, littleEndian);
  const tags = new Map<number, { type: number; count: number; value: number }>();
  for (let index = 0; index < count; index += 1) {
    const offset = ifd + 2 + index * 12;
    const type = view.getUint16(offset + 2, littleEndian);
    const itemCount = view.getUint32(offset + 4, littleEndian);
    tags.set(view.getUint16(offset, littleEndian), {
      type,
      count: itemCount,
      value: type === 3 && itemCount === 1
        ? view.getUint16(offset + 8, littleEndian)
        : view.getUint32(offset + 8, littleEndian),
    });
  }
  return { bigEndian, tags };
}
