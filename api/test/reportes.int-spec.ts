import type { INestApplication } from '@nestjs/common';
import { multiplicar } from '@uvm/compartido';
import { fechaDeHoy } from '@uvm/compartido';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ALMACEN,
  ANA,
  BETO,
  clave,
  como,
  compraV001,
  CONSULTA,
  crearApp,
  IDS,
  productoConPrecio,
  reiniciarBd,
} from './ayudantes.js';

describe('reportes', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });

  /** Ana carga 6 tejocotes, vende 3 en efectivo y 1 por transferencia, y devuelve 1. */
  beforeEach(async () => {
    await reiniciarBd();
    await como(app, ALMACEN).post('/compras', compraV001());
    await como(app, ADMIN).put(
      `/productos/${IDS.tejocote}`,
      productoConPrecio('Galletas de Mermelada de Tejocote', 30, {
        stockMinimo: 5,
      }),
    );
    await como(app, ALMACEN).post('/inventario/traspasos', {
      claveIdempotencia: clave(),
      origenId: IDS.almacen,
      destinoId: IDS.ana,
      lineas: [{ productoId: IDS.tejocote, cantidad: 6 }],
    });
    const vende = (cantidad: number, metodoPago: string) =>
      como(app, ANA).post('/ventas', {
        claveIdempotencia: clave(),
        canal: 'whatsapp',
        pagos: [{ metodoPago, importe: multiplicar('30.00', cantidad) }],
        lineas: [{ productoId: IDS.tejocote, cantidad }],
      });
    await vende(3, 'efectivo');
    await vende(1, 'transferencia');
    await como(app, ALMACEN).post('/inventario/traspasos', {
      claveIdempotencia: clave(),
      origenId: IDS.ana,
      destinoId: IDS.almacen,
      lineas: [{ productoId: IDS.tejocote, cantidad: 1 }],
    });
  });

  it('el corte de la vendedora cuadra', async () => {
    const corte = await como(app, ANA).get('/reportes/corte');
    expect(corte.body.productos).toEqual([
      {
        productoId: IDS.tejocote,
        producto: 'Galletas de Mermelada de Tejocote',
        cargo: 6,
        vendio: 4,
        devolvio: 1,
        ajustes: 0,
        trae: 1,
      },
    ]);
    expect(corte.body.cobros).toMatchObject({ efectivo: '90.00', transferencia: '30.00' });
    expect(corte.body.totalVendido).toBe('120.00');
  });

  it('un vendedor no ve el corte de otro; el admin sí', async () => {
    expect((await como(app, BETO).get(`/reportes/corte?ubicacionId=${IDS.ana}`)).status).toBe(403);
    expect(
      (await como(app, ADMIN).get(`/reportes/corte?ubicacionId=${IDS.ana}`)).body.totalVendido,
    ).toBe('120.00');
  });

  it('el tablero suma las ventas y avisa lo que está bajo el mínimo', async () => {
    const tablero = await como(app, ADMIN).get('/reportes/tablero');
    expect(tablero.body.hoy).toBe(fechaDeHoy());
    expect(tablero.body.ventas.hoy).toEqual({ importe: '120.00', ventas: 2 });
    // Quedan 10 − 4 = 6 tejocotes y el mínimo es 5: todavía no avisa.
    expect(tablero.body.bajoMinimo).toEqual([]);
    expect(tablero.body.costos.utilidadMes).toBe('48.36');
  });

  it('agrupa las ventas por método de pago', async () => {
    const reporte = await como(app, CONSULTA).get('/reportes/ventas?agrupar=metodo');
    expect(reporte.body).toEqual([
      {
        clave: 'efectivo',
        etiqueta: 'Efectivo',
        ventas: 1,
        piezas: 3,
        importe: '90.00',
        costos: { costo: '53.73', comision: '0.00', utilidad: '36.27' },
      },
      {
        clave: 'transferencia',
        etiqueta: 'Transferencia',
        ventas: 1,
        piezas: 1,
        importe: '30.00',
        costos: { costo: '17.91', comision: '0.00', utilidad: '12.09' },
      },
    ]);
  });

  it('la utilidad por producto usa el costo guardado en cada venta', async () => {
    const reporte = await como(app, ADMIN).get('/reportes/utilidad');
    expect(reporte.body).toEqual([
      {
        productoId: IDS.tejocote,
        producto: 'Galletas de Mermelada de Tejocote',
        piezas: 4,
        ingreso: '120.00',
        costo: '71.64',
        comision: '0.00',
        utilidad: '48.36',
        margen: '0.4030',
      },
    ]);
  });

  it('exporta a CSV para Excel', async () => {
    const respuesta = await como(app, ADMIN).get('/reportes/compras?formato=csv');
    expect(respuesta.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(respuesta.headers['content-disposition']).toBe('attachment; filename="compras.csv"');
    expect(respuesta.text).toBe(
      '﻿Folio,Fecha,Proveedor,Piezas,Mercancía,Gasolina,Total\r\nC-000001,2026-09-19,Proveedor demo,80,1306.00,28.75,1334.75\r\n',
    );
  });
});
