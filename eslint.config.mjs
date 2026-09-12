import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated CesiumJS vendor assets copied by scripts/copy-cesium-assets.mjs
    // from node_modules/cesium/Build/Cesium — third-party, gitignored, no
    // first-party source.
    "public/cesium/**",
    // Local proof/backup trees (work/build*, calibration dumps). Not production source.
    "work/**",
    // Phase 11D packaged desktop runtime + installer output: generated copies of built
    // artifacts (scripts/prepare-desktop-runtime.mjs, electron-builder). Gitignored.
    "desktop/runtime/**",
    "desktop/dist*/**",
  ]),
  {
    // Electron main/preload and desktop build scripts are genuinely CommonJS: the Electron
    // main process loads `.cjs` via require, so ESM import syntax is not an option here.
    files: ["desktop/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
