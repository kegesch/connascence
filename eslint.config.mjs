// @ts-check
import babel from "@babel/eslint-parser";

// Keep files small enough to understand at a glance.
// These rules are purely syntactic; the Babel parser is used because
// typescript-eslint does not yet support the project's TypeScript 7.
// Unused vars / undefined globals are TS's job — only size rules live here.
const FILE_SIZE_RULES = {
  // Total file length (blank lines and comments don't count)
  "max-lines": [
    "error",
    { max: 300, skipBlankLines: true, skipComments: true },
  ],
  // Any single function (incl. arrow functions assigned to consts)
  "max-lines-per-function": [
    "error",
    { max: 60, skipBlankLines: true, skipComments: true },
  ],
  // Statements per function (top-level module code exempt)
  "max-statements": ["error", 30, { ignoreTopLevelFunctions: true }],
  // Complexity per function
  complexity: ["error", { max: 15, variant: "classic" }],
  // Parameters per function
  "max-params": ["error", { max: 4 }],
  // Depth of nested blocks
  "max-depth": ["error", 4],
  "max-nested-callbacks": ["error", { max: 4 }],
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      // Fixtures intentionally demonstrate bad coupling (long param lists,
      // tangled functions) — size rules would defeat their purpose.
      "tests/fixtures/**",
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: babel,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-typescript"],
        },
      },
    },
    rules: FILE_SIZE_RULES,
  },
  {
    // Test files get looser limits: setup/fixture code runs long but is
    // still worth keeping an eye on.
    files: ["tests/**/*.ts"],
    languageOptions: {
      parser: babel,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-typescript"],
        },
      },
    },
    rules: {
      ...FILE_SIZE_RULES,
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
      "max-statements": ["error", 50, { ignoreTopLevelFunctions: true }],
      "max-params": ["error", { max: 7 }],
    },
  },
];
