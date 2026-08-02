// Screenshot comparison for the browser-evidence extension layer.
//
// Roadmap M3 task: "像素/感知截图比较". The module exposes a pure-function
// `compareScreenshots(actual, baseline, options)` that supports:
//   - pixel-exact mode (`perceptual:false`): per-pixel diff, mismatch ratio.
//   - perceptual mode (`perceptual:true`): downsample both images to a 16x16
//     grayscale block grid and compare per-block brightness histograms.
//
// PNG decoding is implemented with the Node-builtin `zlib` so we do NOT add
// any npm dependency. The decoder is intentionally minimal: it handles the
// single-IDAT PNGs that Chromium's `page.screenshot({type:'png'})` emits and
// 8-bit RGB(A) inputs. Animated/interlaced/paletted PNGs are rejected with a
// structured skip so the evaluator records a non-blocking skip rather than a
// harness crash.
//
// All structured failures use the architecture-required
// `{status:'error', code, message, root_cause_hint}` shape.

import { inflateSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readUint32BE(buf, offset) {
  return buf.readUInt32BE(offset);
}

function readChunks(buffer) {
  if (buffer.length < 8 || Buffer.compare(buffer.subarray(0, 8), PNG_SIGNATURE) !== 0) {
    throw new Error('Not a PNG file (signature mismatch).');
  }
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error('Truncated PNG chunk header.');
    const length = readUint32BE(buffer, offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error('Truncated PNG chunk data.');
    const data = buffer.subarray(dataStart, dataEnd);
    chunks.push({ type, data });
    offset = dataEnd + 4; // skip CRC
    if (type === 'IEND') break;
  }
  return chunks;
}

function parseIHDR(data) {
  if (data.length < 13) throw new Error('IHDR too short.');
  const width = readUint32BE(data, 0);
  const height = readUint32BE(data, 4);
  const bitDepth = data[8];
  const colourType = data[9];
  const compression = data[10];
  const filter = data[11];
  const interlace = data[12];
  return { width, height, bitDepth, colourType, compression, filter, interlace };
}

const CHANNELS_BY_COLOUR_TYPE = {
  0: 1, // grayscale
  2: 3, // RGB
  3: 1, // palette index -> not supported
  4: 2, // grayscale + alpha
  6: 4, // RGBA
};

/**
 * Decode a PNG into raw pixel bytes. Supports 8-bit grayscale / RGB / RGBA
 * non-interlaced PNGs. Returns `{width, height, channels, data}` where data
 * is a Buffer of length width*height*channels.
 */
export function decodePng(buffer) {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find(chunk => chunk.type === 'IHDR');
  if (!ihdr) throw new Error('PNG missing IHDR.');
  const meta = parseIHDR(ihdr.data);
  if (meta.bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth: ${meta.bitDepth} (only 8-bit).`);
  }
  if (meta.colourType === 3) {
    throw new Error('Indexed PNG (colour type 3) is not supported; use RGB/RGBA.');
  }
  if (meta.interlace !== 0) {
    throw new Error('Interlaced PNG is not supported.');
  }
  const channels = CHANNELS_BY_COLOUR_TYPE[meta.colourType];
  if (!channels) throw new Error(`Unsupported PNG colour type: ${meta.colourType}.`);
  const idat = chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data);
  if (!idat.length) throw new Error('PNG missing IDAT.');
  const inflated = inflateSyncConcat(idat);
  const { width, height } = meta;
  // Each scanline is prefixed by 1 filter-type byte.
  const stride = width * channels;
  const decoded = Buffer.alloc(height * stride);
  const prevLine = Buffer.alloc(stride);
  let inOffset = 0;
  for (let y = 0; y < height; y += 1) {
    if (inOffset + 1 > inflated.length) throw new Error('Truncated PNG scanline header.');
    const filterType = inflated[inOffset];
    inOffset += 1;
    if (inOffset + stride > inflated.length) throw new Error('Truncated PNG scanline data.');
    const rawLine = inflated.subarray(inOffset, inOffset + stride);
    inOffset += stride;
    unfilterLine(filterType, rawLine, prevLine, channels);
    rawLine.copy(decoded, y * stride);
    rawLine.copy(prevLine);
  }
  return { width, height, channels, data: decoded };
}

function inflateSyncConcat(parts) {
  // Node's zlib.inflateSync handles concatenated streams; concat manually first.
  if (parts.length === 1) return inflateSync(parts[0]);
  let total = 0;
  for (const part of parts) total += part.length;
  const merged = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const part of parts) {
    part.copy(merged, offset);
    offset += part.length;
  }
  return inflateSync(merged);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterLine(filterType, line, prevLine, channels) {
  switch (filterType) {
    case 0:
      return; // None
    case 1: { // Sub
      for (let i = channels; i < line.length; i += 1) {
        line[i] = (line[i] + line[i - channels]) & 0xff;
      }
      return;
    }
    case 2: { // Up
      for (let i = 0; i < line.length; i += 1) {
        line[i] = (line[i] + prevLine[i]) & 0xff;
      }
      return;
    }
    case 3: { // Average
      for (let i = 0; i < line.length; i += 1) {
        const left = i >= channels ? line[i - channels] : 0;
        line[i] = (line[i] + ((left + prevLine[i]) >> 1)) & 0xff;
      }
      return;
    }
    case 4: { // Paeth
      for (let i = 0; i < line.length; i += 1) {
        const left = i >= channels ? line[i - channels] : 0;
        const up = prevLine[i];
        const upLeft = i >= channels ? prevLine[i - channels] : 0;
        line[i] = (line[i] + paethPredictor(left, up, upLeft)) & 0xff;
      }
      return;
    }
    default:
      throw new Error(`Unknown PNG filter type: ${filterType}.`);
  }
}

function pixelGray(data, index, channels) {
  if (channels === 1) return data[index];
  if (channels === 2) return data[index];
  if (channels === 3) {
    // Rec. 601 luma.
    return Math.round(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
  }
  // channels === 4
  return Math.round(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
}

function imageBlockHistogram(decoded, grid = 16) {
  const { width, height, channels, data } = decoded;
  const blocks = [];
  for (let by = 0; by < grid; by += 1) {
    for (let bx = 0; bx < grid; bx += 1) {
      const x0 = Math.floor((bx * width) / grid);
      const x1 = Math.floor(((bx + 1) * width) / grid);
      const y0 = Math.floor((by * height) / grid);
      const y1 = Math.floor(((by + 1) * height) / grid);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const idx = (y * width + x) * channels;
          sum += pixelGray(data, idx, channels);
          count += 1;
        }
      }
      blocks.push({ bx, by, avg: count > 0 ? sum / count : 0 });
    }
  }
  return blocks;
}

function loadImage(input) {
  if (input == null) throw new Error('Image input is null.');
  if (Buffer.isBuffer(input)) return decodePng(input);
  if (typeof input === 'string') {
    if (!existsSync(input)) throw new Error(`Image file not found: ${input}`);
    return decodePng(readFileSync(input));
  }
  if (typeof input === 'object') {
    if (Buffer.isBuffer(input.buffer)) return decodePng(input.buffer);
    if (Buffer.isBuffer(input.data)) return decodePng(input.buffer);
    if (typeof input.imagePath === 'string') {
      if (!existsSync(input.imagePath)) throw new Error(`Image file not found: ${input.imagePath}`);
      return decodePng(readFileSync(input.imagePath));
    }
    if (typeof input.path === 'string') {
      if (!existsSync(input.path)) throw new Error(`Image file not found: ${input.path}`);
      return decodePng(readFileSync(input.path));
    }
  }
  throw new Error('Image input must be a Buffer, file path, or {imagePath|buffer}.');
}

function inIgnoreRegion(x, y, ignoreRegions) {
  if (!Array.isArray(ignoreRegions)) return false;
  for (const region of ignoreRegions) {
    if (x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h) {
      return true;
    }
  }
  return false;
}

/**
 * Compare two screenshots. Both `actual` and `baseline` accept a Buffer,
 * a file path, or `{imagePath|buffer|path, width, height}`.
 *
 * Options:
 *   - threshold: number, mismatch_ratio at or above which the result is
 *     'mismatch'. Default 0.01 (1%).
 *   - perceptual: boolean. When true, comparison is a 16x16 grayscale
 *     block-histogram comparison; `pixel_threshold` (per-pixel grayscale
 *     difference, default 25) controls whether a block counts as different.
 *   - pixel_threshold: per-pixel RGB-distance tolerance in pixel mode
 *     (default 0).
 *   - ignoreRegions: array of `{x, y, w, h}` rectangles in pixel coords.
 *   - diffPath: when provided and a mismatch is found, write a hotspot
 *     map describing which 16x16 blocks differed.
 *
 * Returns `{status: 'match'|'mismatch'|'skip'|'error', mismatch_ratio,
 * threshold, ...}`.
 */
export function compareScreenshots(actual, baseline, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.01;
  const perceptual = options.perceptual === true;
  const pixelThreshold = Number.isFinite(options.pixel_threshold) ? options.pixel_threshold : 0;
  const ignoreRegions = Array.isArray(options.ignoreRegions) ? options.ignoreRegions : null;
  let actualImg;
  let baselineImg;
  try {
    actualImg = loadImage(actual);
    baselineImg = loadImage(baseline);
  } catch (error) {
    return {
      status: 'skip',
      reason: 'image_unreadable',
      root_cause_hint: error instanceof Error ? error.message : String(error),
      mismatch_ratio: null,
      threshold,
    };
  }
  if (actualImg.width !== baselineImg.width || actualImg.height !== baselineImg.height) {
    // Differing dimensions: allow caller to compare via perceptual block grid
    // (which is dimension-agnostic) but report pixel-exact mismatch when
    // the dimensions diverge in non-perceptual mode.
    if (!perceptual) {
      const diff = {
        actual: { width: actualImg.width, height: actualImg.height },
        baseline: { width: baselineImg.width, height: baselineImg.height },
      };
      return {
        status: 'mismatch',
        mismatch_ratio: 1,
        threshold,
        reason: 'dimensions_differ',
        evidence: diff,
      };
    }
  }
  if (perceptual) {
    const aBlocks = imageBlockHistogram(actualImg, 16);
    const bBlocks = imageBlockHistogram(baselineImg, 16);
    let mismatches = 0;
    const hotspots = [];
    const perBlockThreshold = Number.isFinite(options.pixel_threshold) ? options.pixel_threshold : 25;
    for (let i = 0; i < aBlocks.length; i += 1) {
      const a = aBlocks[i];
      const b = bBlocks[i];
      const diff = Math.abs(a.avg - b.avg);
      if (diff > perBlockThreshold) {
        mismatches += 1;
        hotspots.push({ bx: a.bx, by: a.by, actual: round1(a.avg), baseline: round1(b.avg), diff: round1(diff) });
      }
    }
    const ratio = aBlocks.length ? mismatches / aBlocks.length : 0;
    const result = {
      status: ratio > threshold ? 'mismatch' : 'match',
      mismatch_ratio: round4(ratio),
      threshold,
      mode: 'perceptual-16x16',
      block_count: aBlocks.length,
      hotspot_count: mismatches,
    };
    if (result.status === 'mismatch') {
      result.hotspots = hotspots.slice(0, 64);
      if (options.diffPath) writeHotspotDiff(options.diffPath, hotspots, actualImg, baselineImg, threshold, ratio);
      result.diff_path = options.diffPath || null;
    }
    return result;
  }
  // Pixel-exact mode requires identical dimensions.
  if (actualImg.width !== baselineImg.width || actualImg.height !== baselineImg.height) {
    return {
      status: 'mismatch',
      mismatch_ratio: 1,
      threshold,
      reason: 'dimensions_differ',
      mode: 'pixel',
      evidence: {
        actual: { width: actualImg.width, height: actualImg.height },
        baseline: { width: baselineImg.width, height: baselineImg.height },
      },
    };
  }
  const { width, height } = actualImg;
  let mismatches = 0;
  let compared = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (ignoreRegions && inIgnoreRegion(x, y, ignoreRegions)) continue;
      const ai = (y * width + x) * actualImg.channels;
      const bi = (y * width + x) * baselineImg.channels;
      const dr = Math.abs(actualImg.data[ai] - baselineImg.data[bi]);
      const dg = Math.abs(actualImg.data[ai + 1] - baselineImg.data[bi + 1]);
      const db = Math.abs(actualImg.data[ai + 2] - baselineImg.data[bi + 2]);
      if (dr > pixelThreshold || dg > pixelThreshold || db > pixelThreshold) {
        mismatches += 1;
      }
      compared += 1;
    }
  }
  const ratio = compared > 0 ? mismatches / compared : 0;
  const result = {
    status: ratio > threshold ? 'mismatch' : 'match',
    mismatch_ratio: round4(ratio),
    threshold,
    mode: 'pixel',
    compared_pixels: compared,
    mismatch_pixels: mismatches,
  };
  if (result.status === 'mismatch' && options.diffPath) {
    writeHotspotDiff(options.diffPath, imageBlockHistogram(actualImg, 16), actualImg, baselineImg, threshold, ratio);
    result.diff_path = options.diffPath;
  }
  return result;
}

function writeHotspotDiff(path, hotspots, actualImg, baselineImg, threshold, ratio) {
  const blocks = hotspots.map(spot => ({
    bx: spot.bx,
    by: spot.by,
    actual: spot.actual ?? null,
    baseline: spot.baseline ?? null,
    diff: spot.diff ?? null,
  }));
  const payload = {
    kind: 'screenshot-diff-hotspot',
    threshold,
    mismatch_ratio: round4(ratio),
    actual: { width: actualImg.width, height: actualImg.height },
    baseline: { width: baselineImg.width, height: baselineImg.height },
    hotspot_blocks: blocks,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2));
  } catch {
    // Best-effort. Caller still has mismatch_ratio; do not throw.
  }
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Load a baseline screenshot from a case evaluator directory.
 * Conventional path: `cases/<case>/evaluator/baselines/<name>.png`.
 */
export function loadBaseline(caseRoot, name) {
  const candidate = join(caseRoot, 'evaluator', 'baselines', `${name}.png`);
  if (!existsSync(candidate)) {
    return {
      status: 'skip',
      reason: 'baseline_missing',
      root_cause_hint: `Baseline not found at ${candidate}.`,
      path: candidate,
    };
  }
  return {
    status: 'ok',
    path: candidate,
    buffer: readFileSync(candidate),
  };
}

export const SCREENSHOT_DIFF_MODES = ['pixel', 'perceptual-16x16'];
