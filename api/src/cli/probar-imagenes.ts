/**
 * `npm run probar-imagenes`: revisa que el bucket de imágenes esté publicado como
 * debe. Toma una foto que ya esté guardada y comprueba que se descarga por su URL
 * pública, y que sin llaves nadie puede listar el bucket ni escribir en él.
 *
 * Se corre después de conectar el bucket (docs/despliegue.md) y cada vez que se
 * cambie el dominio o el proveedor de almacenamiento.
 */
import { isNotNull } from 'drizzle-orm';
import { cargarArchivoEnv } from '../config/cargar-env.js';
import { leerEntorno } from '../config/entorno.js';
import { crearBaseDatos } from '../db/conexion.js';
import { productos } from '../db/esquema.js';
import { verificarPublicacion } from '../imagenes/verificar-publicacion.js';

cargarArchivoEnv();
const entorno = leerEntorno();
const { S3_ENDPOINT, IMAGENES_URL_PUBLICA } = entorno;
if (!S3_ENDPOINT || !IMAGENES_URL_PUBLICA) {
  console.error('Faltan las variables S3_* e IMAGENES_URL_PUBLICA (ver .env.example).');
  process.exit(1);
}

const db = crearBaseDatos(entorno.DATABASE_URL, { maximo: 1 });
let clave: string | null = null;
try {
  const [fila] = await db
    .select({ clave: productos.imagenClave })
    .from(productos)
    .where(isNotNull(productos.imagenClave))
    .limit(1);
  clave = fila?.clave ?? null;
} finally {
  await db.$client.end();
}

if (!clave) {
  console.error(
    'Ningún producto tiene imagen todavía: sube una desde Productos y vuelve a correr esto.',
  );
  process.exit(1);
}

console.log(`Imágenes en ${IMAGENES_URL_PUBLICA}\n`);
const comprobaciones = await verificarPublicacion({
  base: IMAGENES_URL_PUBLICA,
  endpoint: S3_ENDPOINT,
  clave,
  produccion: entorno.NODE_ENV === 'production',
});

for (const { nombre, bien, detalle } of comprobaciones) {
  console.log(`${bien ? '✓' : '✗'} ${nombre}: ${detalle}`);
}

const fallaron = comprobaciones.filter((c) => !c.bien).length;
console.log(
  fallaron === 0
    ? '\nTodo bien: las fotos se sirven y el bucket no acepta nada de fuera.'
    : `\n${fallaron} comprobación(es) sin pasar: revisa docs/despliegue.md.`,
);
process.exit(fallaron === 0 ? 0 : 1);
