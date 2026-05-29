// ESLint flat-config for lms-web. Replaces the legacy .eslintrc.json
// after Next.js 16 removed `next lint` and ESLint v9 made flat config
// the default.
//
// `eslint-config-next@16` exports flat-config arrays from its
// `core-web-vitals` and `typescript` entry points. We extend
// core-web-vitals (matches the previous .eslintrc.json) plus add a few
// targeted overrides for codepaths the default rules misfire on.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...nextCoreWebVitals,
  {
    ignores: [
      ".next/**",
      ".turbo/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "public/sw.js",
      "public/workbox-*.js",
      "next-env.d.ts",
    ],
  },
  // Playwright tests use a function-parameter pattern called `use(...)` to
  // expose fixtures (`async ({ adminPage }, use) => { await use(...) }`).
  // The react-hooks/rules-of-hooks rule misfires on this because it sees
  // a function-call literal named `use`. Disable react-hooks rules for the
  // e2e directory only.
  {
    files: ["tests/e2e/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // PostCSS / ESLint configs are conventionally written as `export default
  // {...}` literals; the `import/no-anonymous-default-export` rule doesn't
  // fit the convention.
  {
    files: ["postcss.config.{js,mjs,cjs}", "eslint.config.{js,mjs,cjs}"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
  // Project-wide rule tuning — noisy rules introduced by Next 16 /
  // eslint-plugin-react-hooks v7 that misfire on common patterns.
  {
    rules: {
      // v7 new strict rule: bans `Date.now()`, `Math.random()`, etc. in
      // render. Useful aspirationally but firing on code paths where
      // purity isn't material (e.g. computing "is this expired" from
      // server-rendered timestamps in a list). Off until we have time
      // to migrate every call site to a memo or effect.
      "react-hooks/purity": "off",
      // Apostrophes in plain JSX text trigger this rule. Modern React
      // handles them fine; the &apos; suggestion is noise.
      "react/no-unescaped-entities": "off",
      // Switching from <img> to next/image is good practice but not
      // load-bearing — demote from error to warning.
      "@next/next/no-img-element": "warn",
    },
  },
];

export default config;
