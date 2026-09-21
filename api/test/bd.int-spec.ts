import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BaseDatos } from '../src/db/conexion.js';
import {
  ADMIN,
  ALMACEN,
  como,
  compraV001,
  conexion,
  crearApp,
  IDS,
  productoConPrecio,
  reiniciarBd,
} from './ayudantes.js';

/** Reglas que cuida la propia BD, sin importar lo que haga la API. */
describe('la base de datos', () => {
  let app: INestApplication;
  let sitio: BaseDatos;
  let api: BaseDatos;
  beforeAll(async () => {
    app = await crearApp();
    sitio = conexion('sitio');
    api = conexion('app');
  });
  afterAll(async () => {
    await Promise.all([app.close(), sitio.$client.end(), api.$client.end()]);
  });
  beforeEach(async () => {
    await reiniciarBd();
    await como(app, ALMACEN).post('/compras', compraV001());
  });

  describe('sitio_lectura (el back del sitio)', () => {
    it('lee precio y existencia de los productos publicados', async () => {
      await como(app, ADMIN).put(
        `/productos/${IDS.avena}`,
        productoConPrecio('galletas-avena', 'Galletas de Avena', 30),
      );
      const { rows } = await sitio.execute(
        sql`select * from catalogo where slug = 'galletas-avena'`,
      );
      expect(rows).toEqual([
        {
          slug: 'galletas-avena',
          nombre: 'Galletas de Avena',
          categoria: 'Galletas',
          presentacion: '6 pzas',
          precio: '30.00',
          existencia_total: 10,
          existencia_almacen: 10,
        },
      ]);
    });

    it('no ve los productos sin publicar', async () => {
      const { rows } = await sitio.execute(
        sql`select slug from catalogo where slug = 'galletas-mermelada-tejocote'`,
      );
      expect(rows).toEqual([]);
    });

    it('no puede leer las tablas: ni costos, ni proveedores, ni ventas', async () => {
      await expect(
        sitio.execute(sql`select costo_promedio from gestion.productos`),
      ).rejects.toThrow();
      await expect(sitio.execute(sql`select * from gestion.proveedores`)).rejects.toThrow();
    });
  });

  describe('gestion_app (la API)', () => {
    it('no puede borrar', async () => {
      await expect(api.execute(sql`delete from gestion.ventas`)).rejects.toThrow();
      await expect(api.execute(sql`delete from gestion.productos`)).rejects.toThrow();
    });

    it('no puede reescribir el kardex ni la bitácora', async () => {
      await expect(api.execute(sql`update gestion.movimientos set cantidad = 1`)).rejects.toThrow();
      await expect(api.execute(sql`update gestion.bitacora set accion = 'x'`)).rejects.toThrow();
    });

    it('no puede dejar existencias negativas', async () => {
      await expect(
        api.execute(sql`update gestion.existencias set cantidad = -1`),
      ).rejects.toThrow();
    });

    it('no puede crear tablas', async () => {
      await expect(api.execute(sql`create table gestion.intrusa (id int)`)).rejects.toThrow();
    });
  });

  it('los slugs no admiten ñ ni acentos', async () => {
    const respuesta = await como(app, ADMIN).post('/productos', {
      ...productoConPrecio('galletas-piña', 'Galletas de Piña', null),
    });
    expect(respuesta.status).toBe(422);
    const directo = api.execute(
      sql`update gestion.productos set slug = 'galletas-piña' where id = 1`,
    );
    await expect(directo).rejects.toThrow();
  });
});
