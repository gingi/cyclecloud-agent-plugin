import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const typeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ["**/*.ts"],
}));

export default tseslint.config(
  {
    ignores: ["bin/**", "coverage/**", "dist/**", "node_modules/**"],
  },
  ...typeCheckedConfigs,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: configDirectory,
      },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    rules: {
      "no-console": "error",
    },
  },
);
