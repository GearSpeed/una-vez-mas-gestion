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
    CF_ACCESS_TEAM: z
      .url()
      // Por http, quien esté en el camino sirve sus propias llaves y firma tokens
      // con el correo que quiera. Solo se admite sin cifrar contra la misma máquina,
      // que es como corren las pruebas.
      .refine(
        (url) =>
          url.startsWith('https://') || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url),
        'Debe ser https',
      )
      .optional(),
    /** El "Application Audience (AUD) Tag" de la aplicación en Access. */
    CF_ACCESS_AUD: z.string().min(1).optional(),
    /** Carpeta del front compilado. Si existe, la API también sirve la SPA. */
    WEB_DIST: z.string().min(1).optional(),
    /**
     * Bucket S3 de las imágenes de producto (Object Storage de Contabo; MinIO en
     * desarrollo). Sin él, la app funciona pero no deja subir imágenes.
     */
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY: z.string().min(1).optional(),
    S3_SECRET_KEY: z.string().min(1).optional(),
    /** De dónde se sirven: la base a la que se le agrega la clave de cada imagen. */
    IMAGENES_URL_PUBLICA: z
      .url()
      .transform((url) => url.replace(/\/+$/, ''))
      .optional(),
    /** Peticiones por minuto y por usuario (o por IP si no hay sesión). */
    LIMITE_PETICIONES: z.coerce.number().int().positive().default(300),
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
    const bucket = [
      entorno.S3_ENDPOINT,
      entorno.S3_BUCKET,
      entorno.S3_ACCESS_KEY,
      entorno.S3_SECRET_KEY,
      entorno.IMAGENES_URL_PUBLICA,
    ];
    if (bucket.some(Boolean) && !bucket.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_ENDPOINT'],
        message:
          'Para las imágenes hacen falta todas: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY e IMAGENES_URL_PUBLICA',
      });
    }
    // Lista blanca, no lista negra: si NODE_ENV llega vacío o con otra cosa, el modo
    // desarrollo (que confía en una cabecera) no arranca.
    if (entorno.AUTH_MODO === 'desarrollo' && entorno.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODO'],
        message: 'AUTH_MODO=desarrollo solo se permite con NODE_ENV=development o test',
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
