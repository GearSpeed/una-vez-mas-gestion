import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ALMACEN,
  ANA,
  BETO,
  clave,
  como,
  compraV001,
  crearApp,
  IDS,
  llavesDe,
  productoConPrecio,
  reiniciarBd,
} from './ayudantes.js';

const nuevaVenta = () => ({
  claveIdempotencia: clave(),
  canal: 'presencial',
  pagos: [{ metodoPago: 'efectivo', importe: '30.00' }],
  lineas: [{ productoId: IDS.tejocote, cantidad: 1 }],
});

/** Lo que protege a la API de cara a internet: ruta pública, CSRF y límites. */
describe('seguridad', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await reiniciarBd();
  });

  const sinIdentidad = () => request(app.getHttpServer());

  const catalogoPublico = () => sinIdentidad().get('/api/publico/catalogo');
  const slugs = () => catalogoPublico().then((r) => r.body.map((p: { slug: string }) => p.slug));
  const disponibilidadDe = (slug: string) =>
    catalogoPublico().then(
      (r) => r.body.find((p: { slug: string }) => p.slug === slug)?.disponibilidad,
    );

  describe('catálogo público (lo que lee el sitio)', () => {
    it('responde sin identidad, con caché y sin datos de más', async () => {
      await como(app, ADMIN).put(
        `/productos/${IDS.avena}`,
        productoConPrecio('Galletas de Avena', 30),
      );
      const respuesta = await sinIdentidad().get('/api/publico/catalogo');
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['cache-control']).toBe(
        'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      );

      const avena = respuesta.body.find((p: { slug: string }) => p.slug === 'galletas-avena');
      expect(avena).toEqual({
        slug: 'galletas-avena',
        nombre: 'Galletas de Avena',
        categoria: 'Galletas',
        presentacion: '6 pzas',
        descripcion: '',
        ingredientes: [],
        precio: '30.00',
        disponibilidad: 'agotado',
        // Sin foto propia, el sitio recibe el logo, y sabe que es relleno.
        imagen: {
          url: expect.stringContaining('marca/logo-1200.webp'),
          urlChica: expect.stringContaining('marca/logo-600.webp'),
          alt: 'Logo de Una vez más',
          esPlaceholder: true,
        },
      });
      // Ni ids internos, ni conteos, ni costos.
      const llaves = new Set(llavesDe(respuesta.body));
      for (const prohibida of ['id', 'costos', 'costoPromedio', 'existenciaTotal', 'piezas']) {
        expect(llaves.has(prohibida)).toBe(false);
      }
    });

    it('no muestra lo que no está publicado ni lo dado de baja', async () => {
      expect(await slugs()).toContain('galletas-avena');

      await como(app, ADMIN).put(
        `/productos/${IDS.avena}`,
        productoConPrecio('Galletas de Avena', 30, { publicado: false }),
      );
      expect(await slugs()).not.toContain('galletas-avena');
    });

    it('dice si hay, si quedan pocas o si se agotó, sin dar el número', async () => {
      await como(app, ADMIN).put(
        `/productos/${IDS.tejocote}`,
        productoConPrecio('Galletas de Mermelada de Tejocote', 30),
      );
      expect(await disponibilidadDe('galletas-mermelada-tejocote')).toBe('agotado');

      await como(app, ALMACEN).post('/inventario/ajustes', {
        claveIdempotencia: clave(),
        ubicacionId: IDS.almacen,
        motivo: 'otro',
        lineas: [{ productoId: IDS.tejocote, cantidad: 4, costoUnitario: 17 }],
      });
      expect(await disponibilidadDe('galletas-mermelada-tejocote')).toBe('ultimas_piezas');

      await como(app, ALMACEN).post('/inventario/ajustes', {
        claveIdempotencia: clave(),
        ubicacionId: IDS.almacen,
        motivo: 'otro',
        lineas: [{ productoId: IDS.tejocote, cantidad: 10, costoUnitario: 17 }],
      });
      expect(await disponibilidadDe('galletas-mermelada-tejocote')).toBe('disponible');
    });

    it('corta a las 60 peticiones por minuto', async () => {
      let ultima = 200;
      for (let i = 0; i < 65 && ultima === 200; i++) {
        ultima = (await sinIdentidad().get('/api/publico/catalogo')).status;
      }
      expect(ultima).toBe(429);
    });
  });

  describe('peticiones que vienen de otro sitio', () => {
    it('rechaza el POST de un formulario de otra página', async () => {
      const respuesta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('X-Dev-Correo', ANA)
        .type('form')
        .send('motivo=lo+que+sea');
      expect(respuesta.status).toBe(403);
      expect(respuesta.body.mensaje).toMatch(/otro sitio/);
    });

    it('rechaza lo que el navegador marca como cruzado', async () => {
      const respuesta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('X-Dev-Correo', ANA)
        .set('Sec-Fetch-Site', 'cross-site')
        .send(nuevaVenta());
      expect(respuesta.status).toBe(403);
    });

    it('deja pasar lo que manda la app', async () => {
      const respuesta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('X-Dev-Correo', ANA)
        .set('Sec-Fetch-Site', 'same-origin')
        .send(nuevaVenta());
      // Falla por reglas del negocio (Ana no trae mercancía), no por el filtro de origen.
      expect(respuesta.status).not.toBe(403);
    });
  });

  describe('respuestas con datos privados', () => {
    it('no se guardan en la caché del navegador', async () => {
      const respuesta = await como(app, ADMIN).get('/usuarios');
      expect(respuesta.headers['cache-control']).toBe('no-store');
    });

    it('un vendedor no cancela la venta de otro', async () => {
      await como(app, ALMACEN).post('/compras', compraV001());
      await como(app, ALMACEN).post('/inventario/traspasos', {
        claveIdempotencia: clave(),
        origenId: IDS.almacen,
        destinoId: IDS.ana,
        lineas: [{ productoId: IDS.tejocote, cantidad: 1 }],
      });
      await como(app, ADMIN).put(
        `/productos/${IDS.tejocote}`,
        productoConPrecio('Galletas de Mermelada de Tejocote', 30),
      );
      const vendida = await como(app, ANA).post('/ventas', {
        claveIdempotencia: clave(),
        canal: 'presencial',
        pagos: [{ metodoPago: 'efectivo', importe: '30.00' }],
        lineas: [{ productoId: IDS.tejocote, cantidad: 1 }],
      });
      expect(vendida.status).toBe(201);

      // Beto tiene ventas.cancelar solo si se lo dan; hoy no, así que 403.
      expect(
        (await como(app, BETO).post(`/ventas/${vendida.body.id}/cancelar`, { motivo: 'no' }))
          .status,
      ).toBe(403);
      // El admin sí puede: tiene ventas.ver_todas.
      expect(
        (await como(app, ADMIN).post(`/ventas/${vendida.body.id}/cancelar`, { motivo: 'prueba' }))
          .status,
      ).toBe(201);
    });
  });

  describe('la salud no cuesta nada', () => {
    it('responde sin identidad y sin detalles', async () => {
      const respuesta = await sinIdentidad().get('/api/salud');
      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ ok: true });
    });
  });
});
