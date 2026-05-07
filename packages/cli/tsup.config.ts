import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  outExtension() {
    return {
      js: '.js',
    };
  },
});
