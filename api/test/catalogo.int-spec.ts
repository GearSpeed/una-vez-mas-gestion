import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, como, crearApp, IDS, productoConPrecio, reiniciarBd } from './ayudantes.js';

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
    const descripcion = 'Galletas suaves de avena, horneadas el mismo día.';
    const ingredientes = ['avena', 'amaranto', 'miel de agave'];
    const editado = await como(app, ADMIN).put(`/productos/${IDS.avena}`, {
      ...productoConPrecio('Galletas de Avena', 30),
      descripcion,
      ingredientes,
    });
    expect(editado.status).toBe(200);
    expect(editado.body).toMatchObject({ descripcion, ingredientes });

    const publico = await request(app.getHttpServer()).get('/api/publico/catalogo');
    const avena = publico.body.find((p: { slug: string }) => p.slug === 'galletas-avena');
    expect(avena).toMatchObject({ descripcion, ingredientes, precio: '30.00' });
  });

  it('sin ficha, los dos campos salen vacíos y no como nulos', async () => {
    const creado = await como(app, ADMIN).post(
      '/productos',
      productoConPrecio('Galletas de Nuez Nueva', 30),
    );
    expect(creado.body).toMatchObject({ descripcion: '', ingredientes: [] });
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
