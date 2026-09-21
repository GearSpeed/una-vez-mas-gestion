import { defineConfig } from 'vitest/config';

/**
 * Pruebas de integración contra un PostgreSQL 18 de verdad (Testcontainers).
 * El contenedor se levanta una sola vez para todos los archivos; cada archivo
 * limpia y vuelve a sembrar la BD antes de cada prueba.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.int-spec.ts'],
    globalSetup: ['test/preparar-bd.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
