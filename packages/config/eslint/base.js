import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared flat-config fragments for all Illuminize packages. */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off"
    }
  },
  {
    ignores: ["**/dist/**", "**/build/**", "**/node_modules/**", "**/.expo/**", "**/drizzle/**", "**/coverage/**"]
  }
];
