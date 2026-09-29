import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BaseDatos } from '../src/db/conexion.js';
import {
  ADMIN,
  ANA,
  como,
  conexion,
  crearApp,
  IDS,
  productoConPrecio,
  reiniciarBd,
} from './ayudantes.js';

const ALT = 'Galletas de avena con amaranto sobre un plato de barro';

/** Una foto de prueba: JPG de 2000 × 1500 con EXIF (cámara y GPS, como las del celular). */
function foto(ancho = 2000, alto = 1500, color = '#c8913c'): Promise<Buffer> {
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: color } })
    .jpeg()
    .withExifMerge({
      IFD0: { Make: 'Celular', Model: 'De prueba' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '19/1 25/1 0/1' },
    })
    .toBuffer();
}

async function descargar(url: string): Promise<{ tipo: string | null; cuerpo: Buffer }> {
  const respuesta = await fetch(url);
  expect(respuesta.status).toBe(200);
  return {
    tipo: respuesta.headers.get('content-type'),
    cuerpo: Buffer.from(await respuesta.arrayBuffer()),
  };
}

describe('imágenes de producto', () => {
  let app: INestApplication;
  let sitio: BaseDatos;
  beforeAll(async () => {
    app = await crearApp();
    sitio = conexion('sitio');
  });
  afterAll(async () => {
    await sitio.$client.end();
    await app.close();
  });
  beforeEach(async () => {
    await reiniciarBd();
  });

  const subir = (
    id: number,
    archivo: Buffer | null,
    alt: string | null = ALT,
    correo = ADMIN,
    nombre = 'foto.jpg',
  ) => {
    let peticion = request(app.getHttpServer())
      .post(`/api/productos/${id}/imagen`)
      .set('X-Dev-Correo', correo)
      // Lo que manda el navegador al subir desde la app: sin eso, la defensa contra
      // peticiones de otros sitios rechaza el multipart (comun/origen.ts).
      .set('Sec-Fetch-Site', 'same-origin');
    if (alt !== null) peticion = peticion.field('alt', alt);
    if (archivo) peticion = peticion.attach('archivo', archivo, nombre);
    return peticion;
  };

  it('la optimiza a WebP de 1200 y 600 px, sin metadatos, y la sirve el bucket', async () => {
    const respuesta = await subir(IDS.avena, await foto());
    expect(respuesta.status).toBe(201);
    const { imagen } = respuesta.body;
    expect(imagen.alt).toBe(ALT);
    expect(imagen.url).toMatch(/\/imagenes\/productos\/1\/[0-9a-f]{16}-1200\.webp$/);
    expect(imagen.urlChica).toBe(imagen.url.replace('-1200.webp', '-600.webp'));

    const grande = await descargar(imagen.url);
    expect(grande.tipo).toBe('image/webp');
    const datos = await sharp(grande.cuerpo).metadata();
    expect(datos).toMatchObject({ format: 'webp', width: 1200, height: 900 });
    expect(datos.exif).toBeUndefined();
    const chica = await sharp((await descargar(imagen.urlChica)).cuerpo).metadata();
    expect(chica).toMatchObject({ width: 600, height: 450 });

    // La lista de productos la trae también.
    const lista = await como(app, ANA).get('/productos');
    const avena = lista.body.find((p: { id: number }) => p.id === IDS.avena);
    expect(avena.imagen).toEqual(imagen);
  });

  it('no agranda una foto chica y acepta PNG', async () => {
    const png = await sharp({
      create: { width: 400, height: 400, channels: 4, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const respuesta = await subir(IDS.coco, png, ALT, ADMIN, 'coco.png');
    expect(respuesta.status).toBe(201);
    const datos = await sharp((await descargar(respuesta.body.imagen.url)).cuerpo).metadata();
    expect(datos.width).toBe(400);
  });

  it('la misma foto conserva su URL; al cambiarla, la anterior se borra del bucket', async () => {
    const primera = await subir(IDS.avena, await foto());
    const otraVez = await subir(IDS.avena, await foto());
    expect(otraVez.body.imagen.url).toBe(primera.body.imagen.url);

    const nueva = await subir(IDS.avena, await foto(2000, 1500, '#3c6ec8'));
    expect(nueva.body.imagen.url).not.toBe(primera.body.imagen.url);
    expect((await fetch(primera.body.imagen.url)).status).toBe(404);
  });

  /** Lo que el sitio lee de la avena en publico.catalogo. */
  const leer = async () =>
    (
      await sitio.execute(
        sql`select id, imagen, imagen_chica, imagen_alt from catalogo where slug = 'galletas-avena'`,
      )
    ).rows[0];

  it('el sitio lee el id y la imagen en publico.catalogo', async () => {
    await como(app, ADMIN).put(
      `/productos/${IDS.avena}`,
      productoConPrecio('Galletas de Avena', 30),
    );
    expect(await leer()).toEqual({
      id: IDS.avena,
      imagen: null,
      imagen_chica: null,
      imagen_alt: null,
    });

    const { body } = await subir(IDS.avena, await foto());
    const fila = await leer();
    expect(fila).toMatchObject({ id: IDS.avena, imagen_alt: ALT });
    expect(body.imagen.url).toMatch(new RegExp(`/${String(fila?.['imagen'])}$`));
    expect(fila?.['imagen_chica']).toMatch(/^productos\/1\/[0-9a-f]{16}-600\.webp$/);
  });

  it('el texto alternativo se guarda aunque el producto no tenga foto', async () => {
    const respuesta = await como(app, ADMIN).put(`/productos/${IDS.avena}/imagen`, { alt: ALT });
    expect(respuesta.status).toBe(200);
    // Sin foto no hay `imagen`, pero el texto queda guardado esperándola.
    expect(respuesta.body).toMatchObject({ imagen: null, imagenAlt: ALT });
    const { body } = await como(app, ADMIN).get(`/productos/${IDS.avena}`);
    expect(body.imagenAlt).toBe(ALT);
  });

  it('sin foto propia, el catálogo del sitio sirve el logo y lo dice', async () => {
    const respuesta = await request(app.getHttpServer()).get('/api/publico/catalogo');
    const avena = respuesta.body.productos.find(
      (p: { slug: string }) => p.slug === 'galletas-avena',
    );
    expect(avena.imagen.esPlaceholder).toBe(true);
    // Y el logo está de verdad en el bucket: lo publica la API al arrancar.
    const { tipo, cuerpo } = await descargar(avena.imagen.url);
    expect(tipo).toBe('image/webp');
    expect((await sharp(cuerpo).metadata()).width).toBe(1200);
  });

  it('con foto propia, el catálogo del sitio ya no manda el logo', async () => {
    await subir(IDS.avena, await foto());
    const respuesta = await request(app.getHttpServer()).get('/api/publico/catalogo');
    const avena = respuesta.body.productos.find(
      (p: { slug: string }) => p.slug === 'galletas-avena',
    );
    expect(avena.imagen).toMatchObject({ alt: ALT, esPlaceholder: false });
    expect(avena.imagen.url).toContain(`productos/${IDS.avena}/`);
  });

  it('rechaza lo que no es JPG, PNG o WebP', async () => {
    const texto = await subir(IDS.avena, Buffer.from('no soy una foto'), ALT, ADMIN, 'foto.jpg');
    expect(texto.status).toBe(422);
    expect(texto.body.campos).toEqual({ archivo: 'El archivo no es una imagen.' });

    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#000000' },
    })
      .gif()
      .toBuffer();
    const respuesta = await subir(IDS.avena, gif, ALT, ADMIN, 'foto.gif');
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.mensaje).toBe('Sube una imagen JPG, PNG o WebP.');
  });

  it('rechaza lo que pasa de 10 MB, sin archivo o sin texto alternativo', async () => {
    const enorme = await subir(IDS.avena, Buffer.alloc(10 * 1024 * 1024 + 1));
    expect(enorme.status).toBe(413);
    expect(enorme.body.mensaje).toBe('El archivo pesa más de 10 MB.');

    const sinArchivo = await subir(IDS.avena, null);
    expect(sinArchivo.status).toBe(422);
    expect(sinArchivo.body.campos).toEqual({ archivo: 'Elige una imagen' });

    const sinAlt = await subir(IDS.avena, await foto(), null);
    expect(sinAlt.status).toBe(422);
    expect(Object.keys(sinAlt.body.campos)).toEqual(['alt']);
  });

  it('solo quien gestiona productos la cambia, y a un producto que existe', async () => {
    expect((await subir(IDS.avena, await foto(), ALT, ANA)).status).toBe(403);
    expect((await subir(999, await foto())).status).toBe(404);
  });

  it('se cambia el texto alternativo, y al quitarla el archivo se borra del bucket', async () => {
    const { body } = await subir(IDS.avena, await foto());
    const alt = await como(app, ADMIN).put(`/productos/${IDS.avena}/imagen`, {
      alt: 'Galletas de avena recién horneadas',
    });
    expect(alt.body.imagen).toEqual({ ...body.imagen, alt: 'Galletas de avena recién horneadas' });

    const quitada = await request(app.getHttpServer())
      .delete(`/api/productos/${IDS.avena}/imagen`)
      .set('X-Dev-Correo', ADMIN);
    expect(quitada.status).toBe(200);
    expect(quitada.body.imagen).toBeNull();
    expect((await fetch(body.imagen.url)).status).toBe(404);

    const owner = conexion('owner');
    try {
      const { rows } = await owner.execute(
        sql`select accion from gestion.bitacora where entidad = 'producto' order by id`,
      );
      expect(rows.map((r) => r['accion'])).toEqual(['cambiar_imagen', 'quitar_imagen']);
    } finally {
      await owner.$client.end();
    }
  });
});
