import { describe, expect, it } from "vitest";
import { normalizeNgPhone, PhoneError, toWaMeNumber } from "../src/domain/phone.js";

describe("normalizeNgPhone", () => {
  it("accepts the common Nigerian formats", () => {
    expect(normalizeNgPhone("08031234567")).toBe("+2348031234567");
    expect(normalizeNgPhone("+2348031234567")).toBe("+2348031234567");
    expect(normalizeNgPhone("2348031234567")).toBe("+2348031234567");
    expect(normalizeNgPhone("8031234567")).toBe("+2348031234567");
    expect(normalizeNgPhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizeNgPhone("0703-123-4567")).toBe("+2347031234567");
    expect(normalizeNgPhone("0913 123 4567")).toBe("+2349131234567");
  });

  it("rejects non-Nigerian and malformed numbers", () => {
    expect(() => normalizeNgPhone("+14155552671")).toThrow(PhoneError);
    expect(() => normalizeNgPhone("0123456789")).toThrow(PhoneError);
    expect(() => normalizeNgPhone("080312345")).toThrow(PhoneError); // too short
    expect(() => normalizeNgPhone("080312345678")).toThrow(PhoneError); // too long
    expect(() => normalizeNgPhone("not a phone")).toThrow(PhoneError);
  });
});

describe("toWaMeNumber", () => {
  it("strips the plus for wa.me links", () => {
    expect(toWaMeNumber("+2348031234567")).toBe("2348031234567");
  });
});
