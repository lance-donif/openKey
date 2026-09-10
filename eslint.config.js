const globals = require("globals");

module.exports = [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        Buffer: "readonly",
        module: "readonly",
        require: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "prefer-const": "error",
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "prefer-const": "error",
    },
  },
];
