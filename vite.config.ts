/**
 * Vite config for the demo only (the package itself is built with `tsc`).
 *
 * - `pnpm run dev` and the GitHub Pages build serve the same pages: the portal `index.html`
 *   and `demo/worldfile-fit.html`. The only difference is `base` (`/Daedalus/` on Pages).
 * - The demo imports `src` directly, so no package build is needed before `dev`.
 * - No `test` section here: `vitest.config.ts` owns the test settings.
 */
import { resolve } from "node:path";
import process from "node:process";
import { defineConfig } from "vite";

const isPagesBuild = process.env.GITHUB_PAGES === "true";

export default defineConfig({
  base: isPagesBuild ? "/Daedalus/" : "/",
  build: {
    outDir: "dist-demo",
    copyPublicDir: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        worldfileFit: resolve(__dirname, "demo/worldfile-fit.html"),
      },
    },
  },
});
