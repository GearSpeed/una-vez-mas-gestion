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
  productoConPrecio,
  reiniciarBd,
} from './ayudantes.js';

describe('compras', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(reiniciarBd);

  it('da los mismos números que el Excel para la compra V001', async () => {
    const respuesta = await como(app, ALMACEN).post('/compras', compraV001());
    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toMatchObject({
      folio: 'C-000001',
      litros: '1.250',
      costoTraslado: '28.75',
      trasladoPorPieza: '0.359375',
      piezas: 80,
      subtotalMercancia: '1306.00',
      total: '1334.75',
    });
    expect(respuesta.body.lineas[0]).toMatchObject({
      costoUnitario: '17.909375',
      importe: '179.09',
    });

    // Con precio de $30 y 80 % de ganancia objetivo, los mismos indicadores del Excel.
    const producto = await como(app, ADMIN).put(
      `/productos/${IDS.tejocote}`,
      productoConPrecio('Galletas de Mermelada de Tejocote', 30, {
        gananciaObjetivo: 0.8,
      }),
    );
    expect(producto.body.costos).toEqual({
      costoPromedio: '17.909375',
      gananciaObjetivo: '0.8000',
      precioSugerido: '32.24',
      gananciaPorPieza: '12.09',
      gananciaSobreCosto: '0.6751',
      margenSobrePrecio: '0.4030',
    });
    expect(producto.body.existenciaTotal).toBe(10);
  });

  it('un reintento con la misma clave no duplica la compra', async () => {
    const compra = compraV001();
    const primera = await como(app, ALMACEN).post('/compras', compra);
    const segunda = await como(app, ALMACEN).post('/compras', compra);
    expect(segunda.status).toBe(201);
    expect(segunda.body.id).toBe(primera.body.id);

    const lista = await como(app, ALMACEN).get('/compras');
    expect(lista.body.total).toBe(1);
  });

  it('no acepta el mismo producto en dos líneas', async () => {
    const compra = compraV001();
    compra.lineas.push({ productoId: IDS.chocolate, cantidad: 10, costoProveedor: 16.58 });
    const respuesta = await como(app, ALMACEN).post('/compras', compra);
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos['lineas.7.productoId']).toMatch(/ya está en la lista/);
  });

  it('con vehículo exige el precio de la gasolina', async () => {
    const respuesta = await como(app, ALMACEN).post('/compras', {
      ...compraV001(),
      precioGasolina: null,
    });
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos).toHaveProperty('precioGasolina');
  });

  it('sin vehículo el traslado es cero', async () => {
    const respuesta = await como(app, ALMACEN).post('/compras', {
      ...compraV001(),
      vehiculoId: null,
      precioGasolina: null,
    });
    expect(respuesta.body).toMatchObject({ costoTraslado: '0.00', litros: null, total: '1306.00' });
  });

  it('el costo promedio pondera compras a distinto precio', async () => {
    const base = { fecha: '2026-09-19', proveedorId: IDS.proveedorDemo, vehiculoId: null };
    await como(app, ALMACEN).post('/compras', {
      ...base,
      claveIdempotencia: clave(),
      lineas: [{ productoId: IDS.coco, cantidad: 10, costoProveedor: 10 }],
    });
    await como(app, ALMACEN).post('/compras', {
      ...base,
      claveIdempotencia: clave(),
      lineas: [{ productoId: IDS.coco, cantidad: 30, costoProveedor: 20 }],
    });
    const producto = await como(app, ADMIN).get(`/productos/${IDS.coco}`);
    expect(producto.body.costos.costoPromedio).toBe('17.500000');
  });

  describe('cancelar', () => {
    it('sin salidas posteriores, deja el costo promedio como estaba', async () => {
      const base = { fecha: '2026-09-19', proveedorId: IDS.proveedorDemo, vehiculoId: null };
      await como(app, ALMACEN).post('/compras', {
        ...base,
        claveIdempotencia: clave(),
        lineas: [{ productoId: IDS.coco, cantidad: 10, costoProveedor: 10 }],
      });
      const segunda = await como(app, ALMACEN).post('/compras', {
        ...base,
        claveIdempotencia: clave(),
        lineas: [{ productoId: IDS.coco, cantidad: 30, costoProveedor: 20 }],
      });

      const cancelada = await como(app, ADMIN).post(`/compras/${segunda.body.id}/cancelar`, {
        motivo: 'capturada dos veces',
      });
      expect(cancelada.status).toBe(201);
      expect(cancelada.body.estado).toBe('cancelado');
      expect(cancelada.body.cancelacion.motivo).toBe('capturada dos veces');

      const producto = await como(app, ADMIN).get(`/productos/${IDS.coco}`);
      expect(producto.body.existenciaTotal).toBe(10);
      expect(producto.body.costos.costoPromedio).toBe('10.000000');
    });

    it('se rechaza si ya se vendió de esos productos', async () => {
      const compra = await como(app, ALMACEN).post('/compras', compraV001());
      await como(app, ADMIN).put(
        `/productos/${IDS.tejocote}`,
        productoConPrecio('Galletas de Mermelada de Tejocote', 30),
      );
      await como(app, ALMACEN).post('/inventario/traspasos', {
        claveIdempotencia: clave(),
        origenId: IDS.almacen,
        destinoId: IDS.ana,
        lineas: [{ productoId: IDS.tejocote, cantidad: 2 }],
      });
      await como(app, ANA).post('/ventas', {
        claveIdempotencia: clave(),
        canal: 'whatsapp',
        metodoPago: 'efectivo',
        lineas: [{ productoId: IDS.tejocote, cantidad: 1 }],
      });

      const respuesta = await como(app, ADMIN).post(`/compras/${compra.body.id}/cancelar`, {
        motivo: 'error',
      });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.mensaje).toMatch(
        /Ya salieron piezas de Galletas de Mermelada de Tejocote/,
      );
    });

    it('solo el admin puede cancelar', async () => {
      const compra = await como(app, ALMACEN).post('/compras', compraV001());
      const respuesta = await como(app, ALMACEN).post(`/compras/${compra.body.id}/cancelar`, {
        motivo: 'error',
      });
      expect(respuesta.status).toBe(403);
    });
  });
});
