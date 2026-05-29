import { z } from "zod";

// Pure-data zod schemas for the /app/profile forms. Lives in its own
// (non-"use server") module so unit tests can import the schemas without
// dragging in the server action graph.

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  phone: z.string().trim().max(32).optional().default(""),
});

export const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(8, "New password must be at least 8 characters"),
    confirm: z.string().min(8),
  })
  .refine((d) => d.next === d.confirm, {
    path: ["confirm"],
    message: "Passwords don't match",
  });
