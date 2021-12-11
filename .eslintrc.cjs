module.exports = {
  env: {
    es2021: true,
    node: true,
  },
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier", "plugin:import/recommended", "plugin:import/typescript"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 13,
    sourceType: "module",
    project: "tsconfig.json"
  },
  plugins: ["@typescript-eslint", "prettier", "import"],
  rules: {
    "prettier/prettier": "error",
    "@typescript-eslint/strict-boolean-expressions": ["error", {allowNullableBoolean: true, allowAny: true}],
    "import/no-unresolved": "error",
    "import/order": "warn",
    "import/no-namespace": "error",
    "import/no-named-as-default-member": "off",
    "import/default": "off"
  },
  settings: {
    "import/parsers": {
      "@typescript-eslint/parser": [".ts", ".tsx"]
    },
    "import/resolver": {
      typescript: {
        alwaysTryTypes: true
      }
    }
  }
};
