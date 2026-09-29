import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, como, crearApp, IDS, productoConPrecio, reiniciarBd } from './ayudantes.js';

/** Un producto listo para la portada, con lo mínimo que exige el switch prendido. */
const enPortada = (nombre: string, extra: object = {}) => ({
  ...productoConPrecio(nombre, 30),
  destacado: true,
  destacadoEtiqueta: 'Clásico',
  destacadoQuip: 'El favorito de Ami',
  ...extra,
});

/** Lo que el sitio pintaría hoy en «Los Favoritos de la Casa». */
async function losDeLaPortada(app: INestApplication) {
  const publico = await request(app.getHttpServer()).get('/api/publico/catalogo');
  return publico.body.productos.filter((p: { destacado: unknown }) => p.destacado !== null);
}

/** El slug es la URL del producto en el sitio: lo genera la API y no cambia. */
describe('slug de los productos', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(reiniciarBd);

  it('al crear, sale del nombre, sin acentos ni ñ', async () => {
    const creado = await como(app, ADMIN).post(
      '/productos',
      productoConPrecio('Galletas de Piña Colada', 30),
    );
    expect(creado.status).toBe(201);
    expect(creado.body.slug).toBe('galletas-de-pina-colada');
  });

  it('si alguien manda un slug, se ignora', async () => {
    const creado = await como(app, ADMIN).post('/productos', {
      ...productoConPrecio('Galletas de Limón', null),
      slug: 'lo-que-yo-quiera',
    });
    expect(creado.body.slug).toBe('galletas-de-limon');
  });

  it('al editar el nombre, el slug se queda igual', async () => {
    const editado = await como(app, ADMIN).put(`/productos/${IDS.avena}`, {
      ...productoConPrecio('Galletas de Avena y Miel', 30),
      slug: 'otro',
    });
    expect(editado.status).toBe(200);
    expect(editado.body).toMatchObject({
      nombre: 'Galletas de Avena y Miel',
      slug: 'galletas-avena',
    });
  });

  it('dos productos con el mismo nombre chocan', async () => {
    await como(app, ADMIN).post('/productos', productoConPrecio('Galletas de Limón', null));
    const otro = await como(app, ADMIN).post(
      '/productos',
      productoConPrecio('Galletas de limón', null),
    );
    expect(otro.status).toBe(409);
    expect(otro.body.mensaje).toBe('Ya hay un producto con ese nombre.');
  });

  it('la ficha del producto llega hasta el catálogo del sitio', async () => {
    const resumen = 'Avena y amaranto con un toque de canela.';
    const descripcion = 'Galletas suaves de avena, horneadas el mismo día.';
    const ingredientes = ['avena', 'amaranto', 'miel de agave'];
    const editado = await como(app, ADMIN).put(`/productos/${IDS.avena}`, {
      ...productoConPrecio('Galletas de Avena', 30),
      resumen,
      descripcion,
      ingredientes,
    });
    expect(editado.status).toBe(200);
    expect(editado.body).toMatchObject({ resumen, descripcion, ingredientes });

    const publico = await request(app.getHttpServer()).get('/api/publico/catalogo');
    const avena = publico.body.productos.find((p: { slug: string }) => p.slug === 'galletas-avena');
    expect(avena).toMatchObject({ resumen, descripcion, ingredientes, precio: '30.00' });
  });

  it('sin ficha, los campos salen vacíos y no como nulos', async () => {
    const creado = await como(app, ADMIN).post(
      '/productos',
      productoConPrecio('Galletas de Nuez Nueva', 30),
    );
    expect(creado.body).toMatchObject({ resumen: '', descripcion: '', ingredientes: [] });
  });

  it('un precio en cero no se publica: el sitio dice «Consulta precio»', async () => {
    // Pasa por dedazo o porque alguien dejó la ficha a medias. Anunciar un producto
    // en $0 obligaría a respetarlo, así que el catálogo público lo manda como null.
    await como(app, ADMIN).put(`/productos/${IDS.avena}`, {
      ...productoConPrecio('Galletas de Avena', 0),
    });

    const publico = await request(app.getHttpServer()).get('/api/publico/catalogo');
    const avena = publico.body.productos.find((p: { slug: string }) => p.slug === 'galletas-avena');
    expect(avena.precio).toBeNull();
    // Adentro sí se ve el cero: quien captura tiene que poder darse cuenta.
    const interno = await como(app, ADMIN).get(`/productos/${IDS.avena}`);
    expect(interno.body.precioVenta).toBe('0.00');
  });

  describe('la portada del sitio', () => {
    it('lo que se escribe aquí es lo que sale en la tarjeta', async () => {
      const editado = await como(app, ADMIN).put(
        `/productos/${IDS.avena}`,
        enPortada('Galletas de Avena', { destacadoTexto: 'Para acompañar el café.' }),
      );
      expect(editado.status).toBe(200);

      expect(await losDeLaPortada(app)).toEqual([
        expect.objectContaining({
          slug: 'galletas-avena',
          destacado: {
            etiqueta: 'Clásico',
            quip: 'El favorito de Ami',
            texto: 'Para acompañar el café.',
          },
        }),
      ]);
    });

    it('sin texto propio, la tarjeta usa el resumen del producto', async () => {
      await como(app, ADMIN).put(
        `/productos/${IDS.avena}`,
        enPortada('Galletas de Avena', { resumen: 'Avena y amaranto.', destacadoTexto: '' }),
      );
      const [avena] = await losDeLaPortada(app);
      expect(avena.destacado.texto).toBe('Avena y amaranto.');
    });

    it('el quinto no cabe, y lo dice', async () => {
      const cuatro = [IDS.avena, IDS.coco, IDS.nuez, IDS.tejocote];
      for (const id of cuatro) {
        const puesto = await como(app, ADMIN).put(`/productos/${id}`, enPortada(`Producto ${id}`));
        expect(puesto.status).toBe(200);
      }

      const quinto = await como(app, ADMIN).post('/productos', enPortada('Galletas de Limón'));
      expect(quinto.status).toBe(422);
      expect(quinto.body.campos.destacado).toMatch(/solo caben cuatro/);
      expect(await losDeLaPortada(app)).toHaveLength(4);
    });

    it('destacar exige publicar: despublicar apaga la portada sola', async () => {
      await como(app, ADMIN).put(`/productos/${IDS.avena}`, enPortada('Galletas de Avena'));
      expect(await losDeLaPortada(app)).toHaveLength(1);

      const despublicado = await como(app, ADMIN).put(`/productos/${IDS.avena}`, {
        ...enPortada('Galletas de Avena'),
        publicado: false,
      });
      expect(despublicado.status).toBe(200);
      // Y los textos se limpian: si mañana se vuelve a prender, no reaparece un guiño viejo.
      expect(despublicado.body).toMatchObject({ destacado: false, destacadoEtiqueta: '' });
      expect(await losDeLaPortada(app)).toHaveLength(0);
    });

    it('con el switch prendido, la etiqueta y el guiño son obligatorios', async () => {
      const respuesta = await como(app, ADMIN).put(`/productos/${IDS.avena}`, {
        ...productoConPrecio('Galletas de Avena', 30),
        destacado: true,
      });
      expect(respuesta.status).toBe(422);
      expect(respuesta.body.campos).toHaveProperty('destacadoEtiqueta');
      expect(respuesta.body.campos).toHaveProperty('destacadoQuip');
    });

    it('un producto que no está en la portada sale como null, no como vacío', async () => {
      const publico = await request(app.getHttpServer()).get('/api/publico/catalogo');
      const avena = publico.body.productos.find(
        (p: { slug: string }) => p.slug === 'galletas-avena',
      );
      expect(avena.destacado).toBeNull();
    });
  });

  describe('la tarjeta de la categoría en la portada', () => {
    // Todo lo que lleva foto vive en imagenes.int-spec.ts: ahí están los ayudantes que
    // la arman y la suben por multipart.
    it('sin foto no hay tarjeta, pero la categoría sigue en el catálogo', async () => {
      const guardada = await como(app, ADMIN).put('/categorias/1', {
        nombre: 'Galletas',
        orden: 1,
        activa: true,
        titulo: 'Galletas de Amaranto',
        insignia: 'Tradición dulce',
        insigniaIcono: 'cookie',
        descripcion: 'Todas llevan amaranto.',
        cta: 'Ver nuestras galletas',
      });
      expect(guardada.status).toBe(200);
      // Los textos se guardan…
      expect(guardada.body).toMatchObject({ titulo: 'Galletas de Amaranto', imagen: null });

      // …pero sin foto el sitio no dibuja la tarjeta, y la categoría sigue sirviendo
      // para filtrar el catálogo.
      const publico = await request(app.getHttpServer()).get('/api/publico/catalogo');
      const galletas = publico.body.categorias.find(
        (c: { nombre: string }) => c.nombre === 'Galletas',
      );
      expect(galletas).toEqual({ nombre: 'Galletas', vitrina: null });
    });

    it('la categoría de gasto no lleva nada de la tarjeta', async () => {
      // Compartían tipo y esquema mientras tuvieron la misma forma; al darle vitrina a
      // las del catálogo dejaron de coincidir, y el esquema se separó.
      const creada = await como(app, ADMIN).post('/gastos/categorias', {
        nombre: 'Papelería',
        orden: 9,
        titulo: 'No debería guardarse',
      });
      expect(creada.status).toBe(201);
      expect(creada.body).not.toHaveProperty('titulo');
    });
  });

  it('un resumen de más de 160 caracteres no se acepta', async () => {
    const respuesta = await como(app, ADMIN).post('/productos', {
      ...productoConPrecio('Galletas de Mucho Texto', 30),
      resumen: 'a'.repeat(161),
    });
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos).toHaveProperty('resumen');
  });

  it('más de doce ingredientes no se aceptan', async () => {
    const respuesta = await como(app, ADMIN).post('/productos', {
      ...productoConPrecio('Galletas de Mil Cosas', 30),
      ingredientes: Array.from({ length: 13 }, (_, i) => `ingrediente ${i}`),
    });
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos).toHaveProperty('ingredientes');
  });

  it('un nombre sin letras ni números no se acepta', async () => {
    const respuesta = await como(app, ADMIN).post('/productos', productoConPrecio('¡¿…?!', null));
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos).toHaveProperty('nombre');
  });
});
