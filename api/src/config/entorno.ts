import { z } from 'zod';

/**
 * Toda la configuración sale de variables de entorno y se valida al arrancar:
 * si falta algo, la API no levanta en vez de fallar a medio camino.
 */
const esquemaEntorno = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PUERTO: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, 'Falta DATABASE_URL'),
    /** "access": identidad de Cloudflare Access. "desarrollo": DEV_CORREO o X-Dev-Correo. */
    AUTH_MODO: z.enum(['access', 'desarrollo']).default('access'),
    DEV_CORREO: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    /** https://<team>.cloudflareaccess.com */
    CF_ACCESS_TEAM: z.url().optional(),
    /** El "Application Audience (AUD) Tag" de la aplicación en Access. */
    CF_ACCESS_AUD: z.string().min(1).optional(),
    /** Carpeta del front compilado. Si existe, la API también sirve la SPA. */
    WEB_DIST: z.string().min(1).optional(),
    LOG_NIVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((entorno, ctx) => {
    if (entorno.AUTH_MODO === 'access' && (!entorno.CF_ACCESS_TEAM || !entorno.CF_ACCESS_AUD)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODO'],
        message: 'Con AUTH_MODO=access hacen falta CF_ACCESS_TEAM y CF_ACCESS_AUD',
      });
    }
    if (entorno.NODE_ENV === 'production' && entorno.AUTH_MODO === 'desarrollo') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODO'],
        message: 'AUTH_MODO=desarrollo no se permite en producción',
      });
    }
  });

export type Entorno = z.infer<typeof esquemaEntorno>;

export const ENTORNO = Symbol('ENTORNO');

export function leerEntorno(fuente: NodeJS.ProcessEnv = process.env): Entorno {
  const resultado = esquemaEntorno.safeParse(fuente);
  if (!resultado.success) {
    throw new Error(`Configuración inválida:\n${z.prettifyError(resultado.error)}`);
  }
  return resultado.data;
}
