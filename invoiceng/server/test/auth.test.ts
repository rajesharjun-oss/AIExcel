import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, signup, type TestContext } from "./helpers.js";

describe("auth", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestApp();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("signs up, sets an HttpOnly session cookie, and serves /me", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: {
        businessName: "Ada Stores",
        name: "Ada",
        phone: "0803 123 4567",
        password: "long-enough-1",
      },
    });
    expect(res.statusCode).toBe(201);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");

    const cookie = setCookie.split(";")[0]!;
    const me = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ name: "Ada", businessName: "Ada Stores", phone: "+2348031234567" });
  });

  it("rejects duplicate phone signup with 409", async () => {
    await signup(ctx.app);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { businessName: "Other Ltd", name: "Other", phone: "08031234567", password: "long-enough-1" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects a wrong password and an unknown phone identically", async () => {
    await signup(ctx.app);
    const wrongPassword = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: "08031234567", password: "wrong-password" },
    });
    const unknownPhone = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: "08099999999", password: "wrong-password" },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownPhone.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownPhone.json());
  });

  it("logs in with any accepted phone format", async () => {
    await signup(ctx.app);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: "+234 803 123 4567", password: "correct-horse-9" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("revokes the session on logout", async () => {
    const { cookie } = await signup(ctx.app);
    const out = await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(200);
    const me = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("expires sessions after the TTL", async () => {
    const { cookie } = await signup(ctx.app);
    ctx.clock.now += 31 * 24 * 3_600_000; // default TTL is 30 days
    const me = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("requires auth for business endpoints", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/invoices" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects state-changing requests from disallowed origins", async () => {
    const { cookie } = await signup(ctx.app);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/customers",
      headers: { cookie, origin: "https://evil.example" },
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects weak passwords", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { businessName: "Valid Ltd", name: "Ngozi", phone: "08031234568", password: "short" },
    });
    expect(res.statusCode).toBe(400);
  });
});
