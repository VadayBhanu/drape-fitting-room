import globals from "globals";
export default [
  {
    files: ["src/**/*.js", "tests/**/*.js", "widget/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023, sourceType: "module",
      globals: { ...globals.browser, ...globals.node, documentPictureInPicture: "readonly" },
    },
    rules: { "no-undef": "error", "no-unused-vars": ["warn", { args: "none" }], "no-redeclare": "error", "no-dupe-keys": "error" },
  },
];
