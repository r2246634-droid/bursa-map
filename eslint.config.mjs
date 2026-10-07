import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint 9 "flat config".
 *  - core-web-vitals: Next.js + React + React Hooks + erişilebilirlik (jsx-a11y) kuralları,
 *    performansı etkileyen hatalar uyarı değil hata seviyesinde.
 *  - typescript: typescript-eslint önerilen kuralları.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      // Kullanılmayan değişken hata; bilerek kullanılmayanlar "_" ile başlayabilir
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Tip içe aktarımları ayrı yazılsın: `import type { X }` (paket boyutuna etki etmez, okunur)
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  // Veri betikleri Node.js'te çalışır, tarayıcıdaki toplayıcı ise sitenin konsolunda
  {
    files: ["scripts/**/*.{js,mjs}"],
    rules: {
      "no-console": "off",
      "import/no-anonymous-default-export": "off",
    },
  },

  globalIgnores([
    // Next.js / derleme çıktıları
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // PWA ve MapLibre tarafından üretilen dosyalar
    "public/sw.js",
    "public/workbox-*.js",
    "public/swe-worker-*.js",
    "public/vendor/**",
  ]),
]);
