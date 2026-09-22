/**
 * `npm run subir-imagenes -- <carpeta del sitio>`: sube al bucket las fotos que hoy
 * tiene el sitio (public/img/productos) y se las asigna a cada producto por su
 * slug, con el texto alternativo de products.json. Se puede correr varias veces:
 * una foto que el producto ya tiene no se vuelve a subir.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { asc } from 'drizzle-orm';
import { cargarArchivoEnv } from '../config/cargar-env.js';
import { leerEntorno } from '../config/entorno.js';
import { ProductosService } from '../catalogo/productos.service.js';
import { crearBaseDatos } from '../db/conexion.js';
import { productos } from '../db/esquema.js';
import { AlmacenImagenes } from '../imagenes/almacen-imagenes.js';

interface ProductoDelSitio {
  readonly id: string;
  readonly imagen?: string;
  readonly alt?: string;
}

cargarArchivoEnv();
const argumento = process.argv[2];
if (!argumento) {
  console.error('Uso: npm run subir-imagenes -- <carpeta del sitio>');
  process.exit(1);
}
// npm corre el script dentro de api/: la ruta es relativa a donde se escribió el comando.
const carpeta = resolve(process.env['INIT_CWD'] ?? process.cwd(), argumento);
const entorno = leerEntorno();
const almacen = new AlmacenImagenes(entorno);
if (!almacen.configurado) {
  console.error('Faltan las variables S3_* e IMAGENES_URL_PUBLICA (ver .env.example).');
  process.exit(1);
}

const delSitio = JSON.parse(
  await readFile(resolve(carpeta, 'src/app/content/products.json'), 'utf8'),
) as ProductoDelSitio[];
const porSlug = new Map(delSitio.map((p) => [p.id, p]));

const db = crearBaseDatos(entorno.DATABASE_URL, { maximo: 2 });
const servicio = new ProductosService(db, almacen);
const sinFoto: string[] = [];
let subidas = 0;
try {
  const nuestros = await db
    .select({ id: productos.id, slug: productos.slug, nombre: productos.nombre })
    .from(productos)
    .orderBy(asc(productos.id));

  for (const producto of nuestros) {
    const delProducto = porSlug.get(producto.slug);
    porSlug.delete(producto.slug);
    if (!delProducto?.imagen) {
      sinFoto.push(`${producto.id} ${producto.slug}`);
      continue;
    }
    const archivo = await readFile(resolve(carpeta, 'public/img', delProducto.imagen));
    await servicio.subirImagen(null, producto.id, archivo, {
      alt: delProducto.alt?.trim() || producto.nombre,
    });
    subidas++;
    console.log(`✓ ${producto.id} ${producto.slug}`);
  }
} finally {
  await db.$client.end();
  almacen.onModuleDestroy();
}

console.log(`\n${subidas} productos con foto.`);
if (sinFoto.length) {
  console.log(`\nSin foto en el sitio (súbela desde Productos):\n  ${sinFoto.join('\n  ')}`);
}
const sobrantes = [...porSlug.values()].filter((p) => p.imagen);
if (sobrantes.length) {
  console.log(
    `\nFotos del sitio sin producto con ese slug (no se subieron):\n  ${sobrantes
      .map((p) => `${p.id} → ${p.imagen}`)
      .join('\n  ')}`,
  );
}
