import { describe, expect, it } from 'vitest';
import { type Comprobacion, verificarPublicacion } from './verificar-publicacion.js';

const BASE = 'https://img.unavezmasmx.com';
const ENDPOINT = 'https://abc123.r2.cloudflarestorage.com';
const CLAVE = 'productos/1/3f9a1c2b7d8e6f50';

/** Un `fetch` de mentira: responde según lo que se pida. */
function traerFalso(respuestas: {
  imagen?: { estado: number; tipo?: string; cache?: string };
  listado?: number;
  escritura?: number;
}) {
  return async (entrada: string | URL | Request, opciones?: RequestInit) => {
    const url = entrada instanceof Request ? entrada.url : String(entrada);
    if (opciones?.method === 'PUT')
      return new Response('', { status: respuestas.escritura ?? 403 });
    if (url.includes('list-type')) return new Response('', { status: respuestas.listado ?? 403 });
    const imagen = respuestas.imagen ?? { estado: 200, tipo: 'image/webp' };
    const cabeceras: Record<string, string> = { 'content-type': imagen.tipo ?? 'image/webp' };
    if (imagen.cache) cabeceras['cf-cache-status'] = imagen.cache;
    return new Response('', { status: imagen.estado, headers: cabeceras });
  };
}

const porNombre = (comprobaciones: Comprobacion[], parte: string) =>
  comprobaciones.find((c) => c.nombre.includes(parte));

const verificar = (
  respuestas: Parameters<typeof traerFalso>[0],
  extra: { base?: string; produccion?: boolean } = {},
) =>
  verificarPublicacion({
    base: extra.base ?? BASE,
    endpoint: ENDPOINT,
    clave: CLAVE,
    produccion: extra.produccion ?? true,
    traer: traerFalso(respuestas),
  });

describe('verificarPublicacion', () => {
  it('da todo por bueno cuando el bucket está bien publicado', async () => {
    const comprobaciones = await verificar({ imagen: { estado: 200, cache: 'HIT' } });
    expect(comprobaciones.every((c) => c.bien)).toBe(true);
    expect(porNombre(comprobaciones, 'se descarga')?.detalle).toContain('caché de Cloudflare: HIT');
  });

  it('avisa si la imagen no se puede descargar', async () => {
    const comprobaciones = await verificar({ imagen: { estado: 404 } });
    expect(porNombre(comprobaciones, 'se descarga')?.bien).toBe(false);
  });

  it('avisa si el bucket deja listar o escribir sin llaves', async () => {
    const comprobaciones = await verificar({ listado: 200, escritura: 200 });
    expect(porNombre(comprobaciones, 'listar')?.bien).toBe(false);
    expect(porNombre(comprobaciones, 'escribir')?.bien).toBe(false);
    expect(porNombre(comprobaciones, 'escribir')?.detalle).toContain('debería negarlo');
  });

  it('en producción avisa si la URL pública es el endpoint S3', async () => {
    const comprobaciones = await verificar({}, { base: `${ENDPOINT}/imagenes` });
    expect(porNombre(comprobaciones, 'dominio propio')?.bien).toBe(false);
  });

  it('en desarrollo no se queja del endpoint: MinIO sirve por el mismo host', async () => {
    const comprobaciones = await verificar({}, { base: `${ENDPOINT}/imagenes`, produccion: false });
    expect(porNombre(comprobaciones, 'dominio propio')).toBeUndefined();
    expect(comprobaciones.every((c) => c.bien)).toBe(true);
  });
});
