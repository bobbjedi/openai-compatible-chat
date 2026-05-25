export interface ParseResult {
  name: string;
  text: string;
  size: number;
}

/**
 * Parse a file into text. Reads ALL files as UTF-8 text — no MIME/extension filtering.
 * Binary files will produce garbage, but that's the LLM's problem, not ours.
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
 * Parse multiple files in parallel.
 */
export async function parseFiles(files: File[]): Promise<ParseResult[]> {
  // eslint-disable-next-line no-console
  console.log('[fileParser] parseFiles count:', files.length);
  const results = await Promise.all(files.map((f) => parseFile(f)));
  // eslint-disable-next-line no-console
  console.log('[fileParser] results:', results.map((r) => ({ name: r.name, textLen: r.text.length })));
  return results;
}
