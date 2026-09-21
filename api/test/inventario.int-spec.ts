import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ALMACEN,
  ANA,
  clave,
  como,
  compraV001,
  crearApp,
  IDS,
  reiniciarBd,
} from './ayudantes.js';

describe('inventario', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await reiniciarBd();
    await como(app, ALMACEN).post('/compras', compraV001());
  });

  const existencia = async (correo: string, productoId: number, ubicacionId?: number) => {
    const ruta = ubicacionId
      ? `/inventario/existencias?ubicacionId=${ubicacionId}`
      : '/inventario/existencias';
    const respuesta = await como(app, correo).get(ruta);
    return respuesta.body.filas.find((f: { productoId: number }) => f.productoId === productoId)
      ?.cantidad;
  };

  it('un traspaso mueve piezas sin cambiar el costo', async () => {
    const traspaso = await como(app, ALMACEN).post('/inventario/traspasos', {
      claveIdempotencia: clave(),
      origenId: IDS.almacen,
      destinoId: IDS.ana,
      lineas: [{ productoId: IDS.chocolate, cantidad: 8 }],
    });
    expect(traspaso.status).toBe(201);
    expect(traspaso.body).toMatchObject({ folio: 'T-000001', origen: 'Almacén', destino: 'Ana' });

    expect(await existencia(ALMACEN, IDS.chocolate, IDS.almacen)).toBe(12);
    expect(await existencia(ALMACEN, IDS.chocolate, IDS.ana)).toBe(8);
    expect(await existencia(ALMACEN, IDS.chocolate)).toBe(20);
    const producto = await como(app, ADMIN).get(`/productos/${IDS.chocolate}`);
    expect(producto.body.costos.costoPromedio).toBe('16.939375');
  });

  it('no se traspasa más de lo que hay en el origen', async () => {
    const respuesta = await como(app, ALMACEN).post('/inventario/traspasos', {
      claveIdempotencia: clave(),
      origenId: IDS.almacen,
      destinoId: IDS.ana,
      lineas: [{ productoId: IDS.avena, cantidad: 11 }],
    });
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.mensaje).toBe('Solo hay 10 de Galletas de Avena en Almacén.');
  });

  it('una merma resta al costo promedio', async () => {
    const ajuste = await como(app, ALMACEN).post('/inventario/ajustes', {
      claveIdempotencia: clave(),
      ubicacionId: IDS.almacen,
      motivo: 'danado',
      lineas: [{ productoId: IDS.nuez, cantidad: -2 }],
    });
    expect(ajuste.status).toBe(201);
    expect(ajuste.body).toMatchObject({ folio: 'A-000001', motivo: 'danado' });
    expect(await existencia(ALMACEN, IDS.nuez, IDS.almacen)).toBe(8);
  });

  it('lo que suma sin costo necesita un costo promedio previo', async () => {
    const respuesta = await como(app, ALMACEN).post('/inventario/ajustes', {
      claveIdempotencia: clave(),
      ubicacionId: IDS.almacen,
      motivo: 'otro',
      lineas: [{ productoId: IDS.coco, cantidad: 3 }],
    });
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos).toHaveProperty(['lineas.0.costoUnitario']);

    const conCosto = await como(app, ALMACEN).post('/inventario/ajustes', {
      claveIdempotencia: clave(),
      ubicacionId: IDS.almacen,
      motivo: 'otro',
      lineas: [{ productoId: IDS.coco, cantidad: 3, costoUnitario: 12.5 }],
    });
    expect(conCosto.status).toBe(201);
    const producto = await como(app, ADMIN).get(`/productos/${IDS.coco}`);
    expect(producto.body.costos.costoPromedio).toBe('12.500000');
  });

  it('el conteo físico ajusta solo las diferencias', async () => {
    const conteo = await como(app, ALMACEN).post('/inventario/conteos', {
      claveIdempotencia: clave(),
      ubicacionId: IDS.almacen,
      conteos: [
        { productoId: IDS.avena, contado: 10 },
        { productoId: IDS.granola, contado: 9 },
        { productoId: IDS.coco, contado: 0 },
      ],
    });
    expect(conteo.status).toBe(201);
    expect(conteo.body.diferencias).toBe(1);
    expect(conteo.body.ajuste.motivo).toBe('conteo');
    expect(conteo.body.ajuste.lineas).toMatchObject([{ productoId: IDS.granola, cantidad: -1 }]);

    const sinDiferencias = await como(app, ALMACEN).post('/inventario/conteos', {
      claveIdempotencia: clave(),
      ubicacionId: IDS.almacen,
      conteos: [{ productoId: IDS.granola, contado: 9 }],
    });
    expect(sinDiferencias.body).toEqual({ diferencias: 0, ajuste: null });
  });

  it('el kardex cuenta la historia de cada pieza', async () => {
    await como(app, ALMACEN).post('/inventario/traspasos', {
      claveIdempotencia: clave(),
      origenId: IDS.almacen,
      destinoId: IDS.ana,
      lineas: [{ productoId: IDS.canela, cantidad: 3 }],
    });
    const kardex = await como(app, ALMACEN).get(`/inventario/kardex?productoId=${IDS.canela}`);
    expect(kardex.body.total).toBe(3);
    expect(
      kardex.body.filas.map((m: { documento: string; tipo: string; cantidad: number }) => [
        m.documento,
        m.tipo,
        m.cantidad,
      ]),
    ).toEqual([
      ['T-000001', 'traspaso_entrada', 3],
      ['T-000001', 'traspaso_salida', -3],
      ['C-000001', 'compra', 10],
    ]);
    // Almacén no tiene costos.ver: el kardex le llega sin costos.
    expect(kardex.body.filas[0].costos).toBeUndefined();
    expect(
      (await como(app, ADMIN).get(`/inventario/kardex?productoId=${IDS.canela}`)).body.filas[0]
        .costos,
    ).toBeDefined();
  });

  it('un vendedor solo ve su ubicación y no ve el kardex', async () => {
    expect(
      (await como(app, ANA).get(`/inventario/existencias?ubicacionId=${IDS.almacen}`)).status,
    ).toBe(403);
    expect((await como(app, ANA).get(`/inventario/kardex?productoId=${IDS.avena}`)).status).toBe(
      403,
    );
    expect((await como(app, ANA).get('/inventario/existencias')).body.ubicacion).toMatchObject({
      nombre: 'Ana',
    });
  });
});
