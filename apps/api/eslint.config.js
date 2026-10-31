import { nodeConfig } from "@illuminize/config/eslint/node.js";

export default [
  ...nodeConfig,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/lib/transaction.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='transaction'][callee.object.property.name='db']",
          message: "Use runInTransaction() from lib/transaction.ts so jobs and events queued inside run only after commit.",
        },
      ],
    },
  },
];
