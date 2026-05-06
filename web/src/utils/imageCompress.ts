// #06 Client-side image preprocessing.
//
// 1. Decode any browser-readable image (incl. iPhone HEIC on Safari
//    16+, where createImageBitmap handles it transparently).
// 2. Downscale so the long edge is ≤ MAX_LONG_EDGE px — Qwen-VL-Max
//    bills image tokens by total pixels, and 1024×1024 is plenty for
//    "Rocky looks at your photo" semantics. Larger doesn't help quality.
// 3. Re-encode to JPEG quality 0.85 — strips HEIC/PNG/WEBP wrappers,
//    normalizes wire format, hits the server's mime-type whitelist.
//
// Returns a JPEG Blob and base64 string ready for /api/chat body.

const MAX_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export interface CompressedImage {
  blob: Blob;
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

export type CompressError =
  | 'unsupported_format'
  | 'decode_failed'
  | 'encode_failed'
  | 'too_large_after_compress';

export class ImageCompressError extends Error {
  code: CompressError;
  constructor(code: CompressError, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** Decode → downscale → JPEG → base64. */
export async function compressForUpload(file: File | Blob): Promise<CompressedImage> {
  // createImageBitmap handles JPEG/PNG/WEBP/GIF/SVG everywhere; HEIC
  // on Safari 16+ (which is iOS 16+, our floor). Fallback to
  // <img> + canvas if createImageBitmap throws — rare in 2026 but
  // possible for very old browsers.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new ImageCompressError('decode_failed', String(err));
  }

  const { width: srcW, height: srcH } = bitmap;
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  // Prefer OffscreenCanvas where available (Workers-style, no DOM
  // attachment). Fall back to a regular canvas for older browsers.
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(dstW, dstH);
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) throw new ImageCompressError('encode_failed', 'no 2d context');
    ctx2d.drawImage(bitmap, 0, 0, dstW, dstH);
    bitmap.close();
    try {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    } catch (err) {
      throw new ImageCompressError('encode_failed', String(err));
    }
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) throw new ImageCompressError('encode_failed', 'no 2d context');
    ctx2d.drawImage(bitmap, 0, 0, dstW, dstH);
    bitmap.close();
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new ImageCompressError('encode_failed', 'toBlob null'))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  }

  // Server caps at 4 MB after compress — should be impossible to hit
  // with 1600px JPEG quality 0.85, but guard anyway.
  if (blob.size > 4 * 1024 * 1024) {
    throw new ImageCompressError('too_large_after_compress');
  }

  const base64 = await blobToBase64Plain(blob);
  return {
    blob,
    base64,
    mimeType: 'image/jpeg',
    width: dstW,
    height: dstH,
  };
}

/** Convert a Blob to a base64 string (chunked to dodge stack overflow
 * on large arrays — same pattern as utils/asr.ts). */
async function blobToBase64Plain(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 32 * 1024;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
