import globals from "globals";
import { baseConfig } from "./base.js";

export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 }
    }
  }
];
