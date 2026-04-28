import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/time.ts"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "NewExpression[callee.name=\"Date\"]",
          message:
            "Prefer Luxon (src/lib/time.ts) instead of new Date() where business time matters.",
        },
        {
          selector:
            "CallExpression[callee.type=\"MemberExpression\"][callee.object.name=\"Date\"][callee.property.name=\"now\"]",
          message: "Use DateTime.now() or wallClockMs() from src/lib/time.ts.",
        },
      ],
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
