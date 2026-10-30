import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import { baseConfig } from "./base.js";

export const reactConfig = [
  ...baseConfig,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2023 }
    },
    rules: {
      ...reactHooks.configs.recommended.rules
    }
  }
];
