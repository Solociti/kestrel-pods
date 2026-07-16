import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["server.ts"],
  platform: "node",
  target: "node22",
  format: ["cjs"],
  outDir: "dist",
  outExtension() {
    return {
      js: ".cjs"
    };
  },
  bundle: true,
  splitting: false,
  sourcemap: true,
  minify: true,
  clean: true,
  noExternal: [/.*/]
});
