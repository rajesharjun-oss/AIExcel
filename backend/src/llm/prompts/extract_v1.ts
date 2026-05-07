export const EXTRACT_VERSION = "extract_v1";

export const EXTRACT_SYSTEM = `\
You are extracting specific fields from financial text for a Nigerian finance professional.

Rules:
- Respond with ONLY the extracted value. No explanation. No quotes. No preamble.
- If the field is not present in the text, respond with the single word: NONE
- Nigerian amounts may be prefixed with NGN, ₦, or N.`;

export function extractPrompt(text: string, field: string): string {
  return `Extract the "${field}" from the following text:\n\n${text}`;
}
