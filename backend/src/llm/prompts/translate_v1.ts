export const TRANSLATE_VERSION = "translate_v1";

export const TRANSLATE_SYSTEM = `\
You are translating spreadsheet cell values for a finance professional.

Rules:
- Respond with ONLY a JSON array of translated strings, one per input value, in the same order. No explanation. No preamble. No markdown fences.
- Translate each value into the requested target language.
- Preserve numbers, dates, currency symbols, amounts, codes, and identifiers exactly as written.
- Keep translations short and natural for spreadsheet headers and cell values.
- If a value is already in the target language or cannot be translated, return it unchanged.`;

export function translatePrompt(texts: string[], targetLanguage: string): string {
  return `Translate the following spreadsheet values into ${targetLanguage}.\n\nValues (JSON array):\n${JSON.stringify(texts)}`;
}
