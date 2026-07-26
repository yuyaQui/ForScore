import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // server.js と server/ 配下は node server.js から直接起動するため、意図的に
  // CommonJS（require / module.exports）で書いている。constants.js は両方式から読まれる。
  // eslint-config-next/typescript が files を絞らずに TS 向けルールを入れており、
  // これらの .js まで対象になってしまうため、該当ルールだけをここで無効化する。
  //
  // flat config の配列は「後に書いた設定が勝つ」ので、nextTs より後ろに置く必要がある。
  // ファイルごとの実効設定は `npx eslint --print-config <file>` で確認できる。
  //
  // globalIgnores で server/ を除外しないのは、no-unused-vars など他のルールは
  // server/ にも効かせたいため（実際に未使用の require を検出した実績がある）。
  {
    files: ["server.js", "server/**/*.js", "constants.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
