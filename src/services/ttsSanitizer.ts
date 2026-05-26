/**
 * TTS Sanitizer — очищает текст перед отправкой в SpeechSynthesis.
 * Удаляет markdown-символы, бэкслеши, управляющие последовательности.
 */

export function sanitizeForTts(text: string): string {
  // eslint-disable-next-line no-console
  console.log('[TTS] Raw:', JSON.stringify(text));

  const clean = text
    // Remove markdown special chars and backslash
    .replace(/[#*_`[\]()>|~\\]/g, '')
    // Remove all types of quotes (including typographic)
    .replace(/[""''«»„“”]/g, '')
    // Replace literal \n with space
    .replace(/\\n/g, ' ')
    // Replace double newlines with period
    .replace(/\n{2,}/g, '. ')
    // Replace single newlines with space
    .replace(/\n/g, ' ')
    // Replace em-dash with space-dash-space
    .replace(/—/g, ' - ')
    // Remove multiple spaces
    .replace(/\s{2,}/g, ' ')
    .trim();

  // eslint-disable-next-line no-console
  console.log('[TTS] Clean:', JSON.stringify(clean));

  return clean;
}
