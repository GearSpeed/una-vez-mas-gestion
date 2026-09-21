import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de punta a punta contra la app compilada: la API sirve el front
 * (como en producción) y usa su propio PostgreSQL 18 de Testcontainers, así
 * que no toca la BD de desarrollo. Antes: `npm run build` en la raíz.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/preparar.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3100',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
});
