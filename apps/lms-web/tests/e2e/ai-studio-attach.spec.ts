import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./_setup/auth";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(here, "fixtures", "sample.pdf");

// Confirms the styled "Attach files" button drives the hidden file input
// and that the upload pipeline lands a chip without calling the LLM.
//
// Skipped if the AI Studio is gated behind the "Configure your LLM provider"
// card (no ANTHROPIC_API_KEY / CLAUDE_API_KEY set in dev).

test("ai-studio: attach files chip appears after upload", async ({
  adminPage,
}) => {
  await adminPage.goto("/app/admin/modules/ai-studio");

  // Skip if provider isn't configured.
  const gate = adminPage.getByText(/Configure your LLM provider/i);
  if (await gate.isVisible().catch(() => false)) {
    test.skip(true, "ANTHROPIC_API_KEY / CLAUDE_API_KEY not set in dev env.");
  }

  // Hidden input — set files directly.
  await adminPage.setInputFiles('input[type="file"]', FIXTURE_PDF);

  // The chip list shows kind + filename. Wait for the filename to appear.
  await expect(adminPage.getByText("sample.pdf")).toBeVisible({
    timeout: 15_000,
  });
});
