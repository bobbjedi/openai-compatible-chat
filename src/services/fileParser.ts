export interface ParseResult {
  name: string;
  text: string;
  size: number;
  /** base64 data URL for images (PNG, JPEG, GIF, WebP) */
  dataUrl?: string;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * Check if file is a supported image for vision models.
 */
export function isImage(file: File): boolean {
  return IMAGE_TYPES.has(file.type);
}

/**
 * Encode an image file as base64 data URL for vision API.
 */
export function parseImageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read image ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Parse a file into text. Reads ALL files as UTF-8 text — no MIME/extension filtering.
 */
export function parseFile(file: File): Promise<ParseResult> {
  // eslint-disable-next-line no-console
  console.log('[fileParser] parseFile:', file.name, 'type:', file.type || '(none)', 'size:', file.size);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // eslint-disable-next-line no-console
      console.log('[fileParser] loaded:', file.name, 'text len:', (reader.result as string).length);
      resolve({
        name: file.name,
        text: reader.result as string,
        size: file.size,
      });
    };
    reader.onerror = () => {
      // eslint-disable-next-line no-console
      console.error('[fileParser] error:', file.name, reader.error);
      reject(new Error(`Failed to read ${file.name}`));
    };
    reader.readAsText(file);
  });
}

/**
 * Parse multiple files in parallel. Splits images and text files.
 * Images → base64 dataUrl, text → through parseFile.
 */
export async function parseFiles(files: File[]): Promise<ParseResult[]> {
  // eslint-disable-next-line no-console
  console.log('[fileParser] parseFiles count:', files.length);
  const results: ParseResult[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    if (isImage(f)) {
      // eslint-disable-next-line no-await-in-loop
      const dataUrl = await parseImageToBase64(f);
      // eslint-disable-next-line no-console
      console.log('[fileParser] image base64 len:', dataUrl.length);
      results.push({
        name: f.name,
        text: '',
        size: f.size,
        dataUrl,
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      results.push(await parseFile(f));
    }
  }

  // eslint-disable-next-line no-console
  console.log('[fileParser] results:', results.map((r) => ({ name: r.name, textLen: r.text.length, hasDataUrl: !!r.dataUrl })));
  return results;
}
