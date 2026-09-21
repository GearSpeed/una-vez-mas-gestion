import { defineConfig } from 'drizzle-kit';

/**
 * `npm run generar-migracion` compara `src/db/esquema.ts` con la última
 * migración y escribe el SQL nuevo en `drizzle/`. Las migraciones que ya se
 * aplicaron no se editan nunca: cualquier cambio va en una nueva.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/esquema.ts',
  out: './drizzle',
  casing: 'snake_case',
  schemaFilter: ['gestion'],
});
