/**
 * PNG encoder (RGBA8, non-interlaced, zlib stored blocks).
 * Used so a screenshot can be read in the same turn as the render, without
 * preserveDrawingBuffer or a blob callback racing the next clear.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data) {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a += data[i];
    if (a >= MOD) a -= MOD;
    b += a;
    if (b >= MOD) b -= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(n) {
  const out = new Uint8Array(4);
  const v = n >>> 0;
  out[0] = (v >>> 24) & 255;
  out[1] = (v >>> 16) & 255;
  out[2] = (v >>> 8) & 255;
  out[3] = v & 255;
  return out;
}

function chunk(type, data) {
  const name = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) name[i] = type.charCodeAt(i);
  const body = new Uint8Array(4 + data.length);
  body.set(name, 0);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  out.set(body, 4);
  out.set(u32be(crc32(body)), 8 + data.length);
  return out;
}

/** zlib wrapper around stored (uncompressed) deflate blocks. */
function zlibStore(data) {
  /** @type {Uint8Array[]} */
  const blocks = [];
  let offset = 0;
  do {
    const n = Math.min(65535, data.length - offset);
    const last = offset + n >= data.length;
    const block = new Uint8Array(5 + n);
    block[0] = last ? 1 : 0;
    block[1] = n & 255;
    block[2] = (n >> 8) & 255;
    const nlen = (~n) & 0xffff;
    block[3] = nlen & 255;
    block[4] = (nlen >> 8) & 255;
    if (n > 0) block.set(data.subarray(offset, offset + n), 5);
    blocks.push(block);
    offset += n;
  } while (offset < data.length);
  const checksum = u32be(adler32(data));
  let size = 2 + checksum.length;
  for (const block of blocks) size += block.length;
  const out = new Uint8Array(size);
  out[0] = 0x78;
  out[1] = 0x01;
  let cursor = 2;
  for (const block of blocks) {
    out.set(block, cursor);
    cursor += block.length;
  }
  out.set(checksum, cursor);
  return out;
}

/**
 * @param {Uint8Array} rgba top-down RGBA, length = width * height * 4
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
export function encodePNG(rgba, width, height) {
  const w = width | 0;
  const h = height | 0;
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), row + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(w), 0);
  ihdr.set(u32be(h), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibStore(raw)), chunk('IEND', new Uint8Array(0))];
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
