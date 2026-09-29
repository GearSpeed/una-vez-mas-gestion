/**
 * `npm run importar-fichas -- <carpeta del sitio>`: copia a la aplicación los textos que
 * hoy tiene escritos el sitio, emparejando por slug. De `products.json`, la ficha
 * (resumen, descripción e ingredientes); de `featured.json`, las cuatro tarjetas de
 * «Los Favoritos de la Casa» (el switch, la etiqueta, el guiño y el texto).
 *
 * **Solo llena lo que está vacío.** Un texto escrito en la pantalla de Productos no se
 * pisa nunca, así que se puede correr las veces que haga falta. Es un puente de una sola
 * dirección y de una sola vez: a partir de aquí los textos del sitio se editan en la
 * aplicación.
 *
 * Los ingredientes del sitio son una frase («Avena entera, amaranto reventado, canela.»);
 * aquí se parten por comas para dejar la lista que pide `docs/contrato-sitio.md`.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { cargarArchivoEnv } from '../config/cargar-env.js';
import { leerEntorno } from '../config/entorno.js';
import { crearBaseDatos } from '../db/conexion.js';
import { productos } from '../db/esquema.js';

interface ProductoDelSitio {
  readonly id: string;
  readonly resumen?: string;
  readonly descripcion?: string;
  readonly ingredientes?: string;
}

interface DestacadoDelSitio {
  readonly productoId: string;
  readonly etiqueta?: string;
  readonly quip?: string;
  readonly resumen?: string;
}

/** Los de `esquemaProducto`, para no meter nada que la propia API rechazaría. */
const LARGO_RESUMEN = 160;
const LARGO_DESCRIPCION = 1000;
const MAXIMO_INGREDIENTES = 12;
const LARGO_INGREDIENTE = 40;
const LARGO_ETIQUETA = 40;
const LARGO_QUIP = 60;
/** La fila que dibuja la portada del sitio. Igual que en `ProductosService`. */
const MAXIMO_EN_PORTADA = 4;

cargarArchivoEnv();
const argumento = process.argv[2];
if (!argumento) {
  console.error('Uso: npm run importar-fichas -- <carpeta del sitio>');
  process.exit(1);
}
// npm corre el script dentro de api/: la ruta es relativa a donde se escribió el comando.
const carpeta = resolve(process.env['INIT_CWD'] ?? process.cwd(), argumento);

const delSitio = JSON.parse(
  await readFile(resolve(carpeta, 'src/app/content/products.json'), 'utf8'),
) as ProductoDelSitio[];
const porSlug = new Map(delSitio.map((p) => [p.id, p]));

/**
 * `featured.json` es parte del mismo puente que `products.json`: el sitio ya no lo lee, y
 * el día que se borre este CLI tiene que seguir sirviendo para las fichas.
 */
const destacadosDelSitio = await readFile(resolve(carpeta, 'src/app/content/featured.json'), 'utf8')
  .then((texto) => JSON.parse(texto) as DestacadoDelSitio[])
  .catch(() => []);
const portadaPorSlug = new Map(
  destacadosDelSitio.slice(0, MAXIMO_EN_PORTADA).map((d) => [d.productoId, d]),
);

/** «Avena entera, amaranto reventado, canela.» → ['Avena entera', …] */
function listaDeIngredientes(frase: string): string[] {
  return frase
    .split(',')
    .map((i) => i.trim().replace(/\.$/, '').trim().slice(0, LARGO_INGREDIENTE))
    .filter((i) => i.length > 0)
    .slice(0, MAXIMO_INGREDIENTES);
}

const db = crearBaseDatos(leerEntorno().DATABASE_URL, { maximo: 2 });
const llenados: string[] = [];
const respetados: string[] = [];
const sinFicha: string[] = [];
const sinPublicar: string[] = [];
try {
  const nuestros = await db
    .select({
      id: productos.id,
      slug: productos.slug,
      resumen: productos.resumen,
      descripcion: productos.descripcion,
      ingredientes: productos.ingredientes,
      destacado: productos.destacado,
      publicado: productos.publicado,
    })
    .from(productos)
    .orderBy(asc(productos.id));

  for (const producto of nuestros) {
    const ficha = porSlug.get(producto.slug);
    porSlug.delete(producto.slug);
    if (!ficha) {
      sinFicha.push(`${producto.id} ${producto.slug}`);
      continue;
    }

    const cambios: {
      resumen?: string;
      descripcion?: string;
      ingredientes?: string[];
      destacado?: boolean;
      destacadoEtiqueta?: string;
      destacadoQuip?: string;
      destacadoTexto?: string;
    } = {};
    const conservados: string[] = [];
    const resumen = ficha.resumen?.trim().slice(0, LARGO_RESUMEN);
    const descripcion = ficha.descripcion?.trim().slice(0, LARGO_DESCRIPCION);
    const ingredientes = ficha.ingredientes ? listaDeIngredientes(ficha.ingredientes) : [];

    if (resumen) {
      if (producto.resumen) conservados.push('resumen');
      else cambios.resumen = resumen;
    }
    if (descripcion) {
      if (producto.descripcion) conservados.push('descripción');
      else cambios.descripcion = descripcion;
    }
    if (ingredientes.length > 0) {
      if (producto.ingredientes.length > 0) conservados.push('ingredientes');
      else cambios.ingredientes = ingredientes;
    }

    // La tarjeta de portada. Solo se prende si el producto está publicado, la misma
    // regla que aplica la API: una tarjeta que lleva a ningún lado no sirve de nada.
    const portada = portadaPorSlug.get(producto.slug);
    portadaPorSlug.delete(producto.slug);
    if (portada?.etiqueta && portada.quip) {
      if (producto.destacado) conservados.push('portada');
      else if (!producto.publicado) sinPublicar.push(`${producto.id} ${producto.slug}`);
      else {
        cambios.destacado = true;
        cambios.destacadoEtiqueta = portada.etiqueta.trim().slice(0, LARGO_ETIQUETA);
        cambios.destacadoQuip = portada.quip.trim().slice(0, LARGO_QUIP);
        cambios.destacadoTexto = portada.resumen?.trim().slice(0, LARGO_RESUMEN) ?? '';
      }
    }

    const puestos = Object.keys(cambios);
    if (puestos.length > 0) {
      await db
        .update(productos)
        .set({ ...cambios, actualizadoEn: new Date() })
        .where(eq(productos.id, producto.id));
      llenados.push(`${producto.id} ${producto.slug}: ${puestos.join(', ')}`);
    }
    if (conservados.length > 0) {
      respetados.push(`${producto.id} ${producto.slug}: ${conservados.join(', ')}`);
    }
  }
} finally {
  await db.$client.end();
}

console.log(`\n${llenados.length} productos con ficha nueva.`);
if (llenados.length) console.log(`  ${llenados.join('\n  ')}`);
if (respetados.length) {
  console.log(
    `\nYa tenían texto escrito en la aplicación (no se tocó):\n  ${respetados.join('\n  ')}`,
  );
}
if (sinFicha.length) {
  console.log(`\nSin ficha en el sitio (escríbela en Productos):\n  ${sinFicha.join('\n  ')}`);
}
if (sinPublicar.length) {
  console.log(
    `\nIban en la portada del sitio pero no están publicados, así que no se prendieron:\n  ${sinPublicar.join('\n  ')}`,
  );
}
if (porSlug.size) {
  console.log(
    `\nFichas del sitio sin producto con ese slug (no se importaron):\n  ${[...porSlug.keys()].join('\n  ')}`,
  );
}
