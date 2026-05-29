// Vitest stub for the `server-only` package.
// In production this package throws when imported into a client bundle, which
// is how Next.js prevents server code leaking to the browser. In Node tests
// there is no client/server boundary, so this is a no-op.
export {};
