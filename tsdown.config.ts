import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	dts: true,
	publint: true,
	format: ["esm", "cjs"],
	clean: true,
	// Emit Node 18-compatible output for consumers. The build tool itself
	// requires Node 20+ (see devEngines), but the shipped dist targets Node 18.
	target: "node18",
});
