import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("isPlatformAdmin", () => {
  const original = process.env.PLATFORM_ADMIN_EMAILS;

  beforeEach(() => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    } else {
      process.env.PLATFORM_ADMIN_EMAILS = original;
    }
  });

  async function load() {
    const mod = await import("../lib/auth/platform-allowlist");
    return mod.isPlatformAdmin;
  }

  it("returns false when PLATFORM_ADMIN_EMAILS is unset", async () => {
    const isPlatformAdmin = await load();
    expect(isPlatformAdmin("anyone@example.com")).toBe(false);
  });

  it("returns false when PLATFORM_ADMIN_EMAILS is empty", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "";
    const isPlatformAdmin = await load();
    expect(isPlatformAdmin("anyone@example.com")).toBe(false);
  });

  it("matches a single email exactly", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "sanjay.khadka@germanbutchery.com.au";
    const isPlatformAdmin = await load();
    expect(isPlatformAdmin("sanjay.khadka@germanbutchery.com.au")).toBe(true);
    expect(isPlatformAdmin("someone.else@germanbutchery.com.au")).toBe(false);
  });

  it("is case-insensitive on both sides", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Sanjay.Khadka@GermanButchery.com.au";
    const isPlatformAdmin = await load();
    expect(isPlatformAdmin("sanjay.khadka@germanbutchery.com.au")).toBe(true);
    expect(isPlatformAdmin("SANJAY.KHADKA@GERMANBUTCHERY.COM.AU")).toBe(true);
  });

  it("supports multiple emails (comma-separated, whitespace tolerated)", async () => {
    process.env.PLATFORM_ADMIN_EMAILS =
      "alice@example.com, bob@example.com , carol@example.com";
    const isPlatformAdmin = await load();
    expect(isPlatformAdmin("alice@example.com")).toBe(true);
    expect(isPlatformAdmin("bob@example.com")).toBe(true);
    expect(isPlatformAdmin("carol@example.com")).toBe(true);
    expect(isPlatformAdmin("dave@example.com")).toBe(false);
  });

  it("rejects empty or whitespace input", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "alice@example.com";
    const isPlatformAdmin = await load();
    expect(isPlatformAdmin("")).toBe(false);
    expect(isPlatformAdmin("   ")).toBe(false);
  });
});
