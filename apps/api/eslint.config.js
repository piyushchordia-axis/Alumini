import { nodeConfig } from "@illuminize/config/eslint/node.js";

const STORED_FEATURES_MESSAGE = "A stored features map can lack keys, so reading one directly gets undefined for them. Use resolveFeatures(type, stored) and read the result.";

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
        // The Partial type stops a stored map being passed as a full one, but not `settings.features.jobs`, which still compiles.
        { selector: "MemberExpression[object.type='MemberExpression'][object.property.name='features']", message: STORED_FEATURES_MESSAGE },
        { selector: "VariableDeclarator[id.type='ObjectPattern'][init.type='MemberExpression'][init.property.name='features']", message: STORED_FEATURES_MESSAGE },
      ],
    },
  },
];
