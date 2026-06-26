import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest configuration for the VRP solver.
 *
 * - `environment: "jsdom"` — most code paths are React-agnostic but
 *   the test runner needs a DOM for any hook tests; jsdom is the
 *   minimal install.
 * - `globals: true` — `describe`/`it`/`expect` are exposed without
 *   an import to keep the test files terse.
 * - `tsconfigPaths()` — resolves the `@/*` alias to `./src/*` so
 *   test files can `import { … } from "@/types"` etc.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
