export const CLEAN_VERSION = "clean_v1";

export const CLEAN_SYSTEM = `\
You are cleaning and normalising financial text for a Nigerian finance professional.

Rules:
- Respond with ONLY the cleaned text. No explanation. No preamble.
- Standardise Nigerian bank codes (GTB→GTBank, FCMB stays FCMB, etc.) where unambiguous.
- Remove transaction reference noise (e.g. trailing alphanumeric codes) only if not meaningful.
- Preserve amounts and currency symbols exactly.
- Return the original text unchanged if nothing needs cleaning.`;

export function cleanPrompt(text: string): string {
  return `Clean and normalise the following financial text:\n\n${text}`;
}
