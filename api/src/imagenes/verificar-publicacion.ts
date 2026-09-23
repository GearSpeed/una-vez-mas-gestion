export interface DatosVerificacion {
  /** La base pública: en producción, el dominio propio (`https://img.unavezmasmx.com`). */
  readonly base: string;
  /** El endpoint S3, para avisar si se confundió con la base pública. */
  readonly endpoint: string;
  /** La ruta de una imagen que ya esté guardada, sin la variante. */
  readonly clave: string;
  readonly produccion: boolean;
  /** Se inyecta para poder probar esto sin red. */
  readonly traer?: typeof fetch;
}

export interface Comprobacion {
  readonly nombre: string;
  readonly bien: boolean;
  readonly detalle: string;
}

function mismoHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/**
 * Revisa que el bucket de imágenes esté publicado como debe: que la foto se
 * descargue por la URL pública, y que nadie pueda listar el bucket ni escribir en
 * él sin credenciales. Lo usa `npm run probar-imagenes`.
 */
export async function verificarPublicacion(datos: DatosVerificacion): Promise<Comprobacion[]> {
  const traer = datos.traer ?? fetch;
  const base = datos.base.replace(/\/+$/, '');
  const comprobaciones: Comprobacion[] = [];

  if (datos.produccion && mismoHost(base, datos.endpoint)) {
    comprobaciones.push({
      nombre: 'La URL pública es un dominio propio',
      bien: false,
      detalle:
        'IMAGENES_URL_PUBLICA apunta al endpoint S3. En R2 ese endpoint no sirve lecturas ' +
        'públicas: las fotos saldrían rotas. Conecta el dominio al bucket y usa ese.',
    });
  }

  const url = `${base}/${datos.clave}-600.webp`;
  try {
    const respuesta = await traer(url);
    const tipo = respuesta.headers.get('content-type') ?? 'sin tipo';
    const cache = respuesta.headers.get('cf-cache-status');
    comprobaciones.push({
      nombre: 'La imagen se descarga por su URL pública',
      bien: respuesta.status === 200 && tipo.includes('image/webp'),
      detalle:
        respuesta.status === 200
          ? `${url} responde ${tipo}${cache ? ` (caché de Cloudflare: ${cache})` : ''}`
          : `${url} responde ${respuesta.status}`,
    });
  } catch (error) {
    comprobaciones.push({
      nombre: 'La imagen se descarga por su URL pública',
      bien: false,
      detalle: `No se pudo pedir ${url}: ${String(error)}`,
    });
  }

  // Sin credenciales no se debe poder ver qué hay guardado ni dejar nada.
  const prohibido = async (nombre: string, ruta: string, opciones?: RequestInit) => {
    try {
      const respuesta = await traer(`${base}${ruta}`, opciones);
      comprobaciones.push({
        nombre,
        bien: respuesta.status >= 400,
        detalle: `responde ${respuesta.status}${respuesta.status < 400 ? ' (debería negarlo)' : ''}`,
      });
    } catch (error) {
      // Que ni siquiera conteste también sirve.
      comprobaciones.push({ nombre, bien: true, detalle: `no responde: ${String(error)}` });
    }
  };

  await prohibido('Nadie puede listar el bucket', '/?list-type=2');
  await prohibido('Nadie puede escribir sin llaves', '/verificacion-publica.txt', {
    method: 'PUT',
    body: 'no debería guardarse',
  });

  return comprobaciones;
}
