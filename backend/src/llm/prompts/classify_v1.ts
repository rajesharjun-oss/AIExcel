export const CLASSIFY_VERSION = "classify_v1";

export const CLASSIFY_SYSTEM = `\
You are classifying financial transactions for a Nigerian finance professional.

Rules:
- Respond with ONLY the category name. No explanation. No quotes. No preamble.
- If the text is ambiguous, choose the most likely category.
- Common Nigerian transaction prefixes: TRF (transfer), POS (card payment), NIP (instant transfer), USSD, NEFT, RTGS.
- Local banks include FCMB, GTB, UBA, Access, Zenith, First Bank, FMDQ, PENCOM.`;

export function classifyPrompt(text: string, categories: string): string {
  return `Classify the following text into exactly one of these categories: ${categories}\n\nText: ${text}`;
}
