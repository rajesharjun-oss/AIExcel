/**
 * Nigerian phone normalisation. Accepts the common ways people type numbers
 * (0803..., 803..., +234803..., 234803...) and returns E.164 (+234...).
 */

const NG_MOBILE = /^([789][01])\d{8}$/;

export class PhoneError extends Error {
  override name = "PhoneError";
}

export function normalizeNgPhone(raw: string): string {
  const digits = raw.replace(/[\s\-().]/g, "");
  let national: string;
  if (/^\+234\d+$/.test(digits)) {
    national = digits.slice(4);
  } else if (/^234\d+$/.test(digits)) {
    national = digits.slice(3);
  } else if (/^0\d+$/.test(digits)) {
    national = digits.slice(1);
  } else if (/^\d+$/.test(digits)) {
    national = digits;
  } else {
    throw new PhoneError("phone number contains invalid characters");
  }
  if (!NG_MOBILE.test(national)) {
    throw new PhoneError("not a valid Nigerian mobile number");
  }
  return `+234${national}`;
}

/** wa.me links use the number without '+'. */
export function toWaMeNumber(e164: string): string {
  return e164.replace(/^\+/, "");
}
