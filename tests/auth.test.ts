import { describe, expect, test } from "bun:test";
import {
  assertUsablePassword,
  JARVIS_SESSION_COOKIE,
  buildExpiredSessionCookie,
  buildSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  verifyPassword,
} from "../src/server/auth";

describe("authentication primitives", () => {
  test("password hashing is salted and verifies correctly", () => {
    const password = "A-strong-Jarvis-password-2026!";
    const first = hashPassword(password);
    const second = hashPassword(password);

    expect(first).not.toBe(second);
    expect(verifyPassword(password, first)).toBe(true);
    expect(verifyPassword("wrong-password-2026!", first)).toBe(false);
  });

  test("weak passwords are rejected before storage", () => {
    expect(() => assertUsablePassword("short")).toThrow();
  });

  test("session tokens are opaque and hashed before persistence", () => {
    const token = createSessionToken();
    expect(token.length).toBeGreaterThan(20);
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  test("cookie serialization is HttpOnly, SameSite Strict, and optionally Secure", () => {
    const token = "abc123";
    const cookie = buildSessionCookie(token, true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=");
    expect(parseCookies(cookie.split("; ").slice(0, 1).join("; "))[JARVIS_SESSION_COOKIE]).toBe(token);

    const expired = buildExpiredSessionCookie(true);
    expect(expired).toContain("Max-Age=0");
  });
});
