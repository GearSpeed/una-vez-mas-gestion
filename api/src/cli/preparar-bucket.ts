/**
 * `npm run preparar-bucket`: solo para desarrollo. Crea en el MinIO local
 * (docker compose) el bucket de las imágenes y lo deja de lectura pública.
 * En producción el bucket se crea en el panel de Contabo (docs/despliegue.md).
 */
import { cargarArchivoEnv } from '../config/cargar-env.js';
import { leerEntorno } from '../config/entorno.js';
import { prepararBucketPublico } from '../imagenes/preparar-bucket.js';

cargarArchivoEnv();
const entorno = leerEntorno();
if (entorno.NODE_ENV === 'production') {
  console.error('preparar-bucket es solo para desarrollo.');
  process.exit(1);
}
const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = entorno;
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  console.error('Faltan las variables S3_* en el .env (ver .env.example).');
  process.exit(1);
}
await prepararBucketPublico({
  endpoint: S3_ENDPOINT,
  region: entorno.S3_REGION,
  bucket: S3_BUCKET,
  accessKey: S3_ACCESS_KEY,
  secretKey: S3_SECRET_KEY,
});
console.log(`Bucket «${S3_BUCKET}» listo y de lectura pública.`);
