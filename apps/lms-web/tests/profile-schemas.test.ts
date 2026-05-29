import { describe, it, expect } from "vitest";
import {
  profileSchema,
  passwordSchema,
} from "../app/app/profile/schemas";

describe("profileSchema", () => {
  it("accepts a typical valid input", () => {
    const r = profileSchema.safeParse({
      firstName: "Anna",
      lastName: "Bauer",
      phone: "+61 400000000",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.firstName).toBe("Anna");
      expect(r.data.phone).toBe("+61 400000000");
    }
  });

  it("rejects empty firstName", () => {
    const r = profileSchema.safeParse({
      firstName: "",
      lastName: "Bauer",
      phone: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.firstName?.[0]).toMatch(/required/i);
    }
  });

  it("rejects empty lastName", () => {
    const r = profileSchema.safeParse({
      firstName: "Anna",
      lastName: "   ",
      phone: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects oversized phone (33+ chars)", () => {
    const r = profileSchema.safeParse({
      firstName: "Anna",
      lastName: "Bauer",
      phone: "x".repeat(33),
    });
    expect(r.success).toBe(false);
  });

  it("treats missing phone as empty string", () => {
    const r = profileSchema.safeParse({
      firstName: "Anna",
      lastName: "Bauer",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe("");
  });

  it("rejects firstName over 100 chars", () => {
    const r = profileSchema.safeParse({
      firstName: "x".repeat(101),
      lastName: "B",
      phone: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("accepts a typical valid input", () => {
    const r = passwordSchema.safeParse({
      current: "oldpass1",
      next: "newpass1234",
      confirm: "newpass1234",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty current password", () => {
    const r = passwordSchema.safeParse({
      current: "",
      next: "newpass1234",
      confirm: "newpass1234",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.current?.[0]).toMatch(/current/i);
    }
  });

  it("rejects a new password under 8 chars", () => {
    const r = passwordSchema.safeParse({
      current: "x",
      next: "short",
      confirm: "short",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.next?.[0]).toMatch(/8 characters/);
    }
  });

  it("rejects mismatched confirm", () => {
    const r = passwordSchema.safeParse({
      current: "x",
      next: "newpass1234",
      confirm: "newpass5678",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fe = r.error.flatten().fieldErrors;
      expect(fe.confirm?.[0]).toMatch(/don't match/i);
    }
  });
});
