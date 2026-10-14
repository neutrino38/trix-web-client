import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * The minimal example, built on its own: into its own `dist/`, so that
 * `deploy.sh` never ships it with the client.
 */
export default defineConfig({
  root: __dirname,
  // no public/: a `config.json` dropped next to index.html is served in dev
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
