import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/common/time.ts",
      "src/common/time-engine.ts",
      "src/**/*.spec.ts",
      "src/main.ts",
    ],
    languageOptions: {
      parser: tsParser,
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "NewExpression[callee.name=\"Date\"]",
          message:
            "Prefer Luxon via src/common/time.ts instead of new Date() (allowed in time.ts / time-engine.ts / tests / main).",
        },
        {
          selector:
            "CallExpression[callee.type=\"MemberExpression\"][callee.object.name=\"Date\"][callee.property.name=\"now\"]",
          message: "Use wallClockMs() or DateTime.now() from Luxon (src/common/time.ts).",
        },
      ],
    },
  },
];
