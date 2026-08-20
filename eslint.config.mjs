import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The codebase's own established "destructure-to-omit" idiom
      // (`const { fieldToOmit: _fieldToOmit, ...rest } = values`, used to
      // strip fields out of a snapshot object in several routes) always
      // trips no-unused-vars otherwise -- confirmed (2026-08-20 audit) that
      // every such site is intentional, not dead code. This option exists
      // specifically for this pattern.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
