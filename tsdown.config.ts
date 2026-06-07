import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  dts: true,
  publint: true,
  format: ['esm', 'cjs'],
  clean: true,
  // target: xxx, follows the engine in package.json or specify here
  // exports: true,
})
