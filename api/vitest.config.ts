import { defineConfig } from 'vitest/config';

/** Pruebas unitarias: no tocan la BD. */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
