export const MATCH_VERSION = "match_v1";

export const MATCH_SYSTEM = `\
You are fuzzy-matching financial names and identifiers for a Nigerian finance professional.

Rules:
- Respond with ONLY the best matching item from the list. Copy it exactly as given in the list.
- If no item is a reasonable match, respond with the single word: NONE
- Nigerian names, bank names, and company names may have variant spellings.`;

export function matchPrompt(value: string, list: string): string {
  return `Find the best match for "${value}" in this list:\n${list}`;
}
