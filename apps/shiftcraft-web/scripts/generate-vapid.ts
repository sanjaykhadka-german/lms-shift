// One-shot VAPID key generator (AUDIT.md #12).
//
// Run once per environment; paste the output into the
// VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars and pick a
// VAPID_SUBJECT (a mailto: or https URL identifying the sender).
//
// Rotating the keys invalidates every existing browser subscription.
// Do it on intentional schedule changes only.
//
// Usage:
//   pnpm tsx apps/shiftcraft-web/scripts/generate-vapid.ts

import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log("# Paste into .env:");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=mailto:ops@yourdomain`);
