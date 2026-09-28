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

  /** Le pone tasa a Ana y devuelve su id de usuario (que no es el de su ubicación). */
  const comisionDeAna = async (tasa: string): Promise<number> => {
    const ana = (await como(app, ADMIN).get('/usuarios')).body.find(
      (u: { correo: string }) => u.correo === ANA,
    );
    await como(app, ADMIN).put(`/usuarios/${ana.id}`, { ...ana, comisionVenta: tasa });
    return ana.id as number;
  };

  const vender = (cantidad: number) =>
    como(app, ANA).post('/ventas', {
      claveIdempotencia: clave(),
      canal: 'whatsapp',
      pagos: [{ metodoPago: 'efectivo', importe: multiplicar('30.00', cantidad) }],
      lineas: [{ productoId: IDS.tejocote, cantidad }],
    });

  /** Más mercancía para Ana, cuando la prueba necesita vender varias veces. */
  const cargarAAna = (cantidad: number) =>
    como(app, ALMACEN).post('/inventario/traspasos', {
      claveIdempotencia: clave(),
      origenId: IDS.almacen,
      destinoId: IDS.ana,
      lineas: [{ productoId: IDS.tejocote, cantidad }],
    });

  /** El escenario de arriba: Ana vendió $120 y le quedó 1 pieza. */
  const resultado = () => como(app, ADMIN).get('/reportes/resultado');

  const gastar = (importe: string) =>
    como(app, ADMIN).post('/gastos', {
      claveIdempotencia: clave(),
      categoriaId: 1,
      concepto: 'Bolsas',
      importe,
      metodoPago: 'efectivo',
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

  describe('resultado del periodo y comisión de quien vende', () => {
    it('baja de lo vendido a lo que de verdad quedó', async () => {
      expect((await gastar('20.00')).status).toBe(201);

      const { body } = await resultado();
      expect(body.ventasNetas).toBe('120.00');
      // Las 4 piezas vendidas, al costo de V001 ($17.909375 cada una).
      expect(body.costoVendido).toBe('71.64');
      expect(body.utilidadBruta).toBe('48.36');
      // Nada se cobró con tarjeta en este escenario.
      expect(body.comisionTarjeta).toBe('0.00');
      expect(body.gastos).toEqual([{ categoria: 'Empaque', importe: '20.00' }]);
      expect(body.utilidadOperativa).toBe('28.36');
      // Lo atado en mercancía es lo mismo que dice el tablero.
      const tablero = await como(app, ADMIN).get('/reportes/tablero');
      expect(body.valorInventario).toBe(tablero.body.costos.valorInventario);
    });

    it('un gasto cancelado deja de restar', async () => {
      const gasto = await gastar('20.00');
      await como(app, ADMIN).post(`/gastos/${gasto.body.id}/cancelar`, { motivo: 'Duplicado' });
      const { body } = await resultado();
      expect(body.gastos).toEqual([]);
      expect(body.totalGastos).toBe('0.00');
      expect(body.utilidadOperativa).toBe('48.36');
    });

    it('la comisión sale de lo neto, y el corte dice lo mismo que el resultado', async () => {
      await cargarAAna(4);
      await comisionDeAna('0.15');
      const vendida = await vender(2);
      expect(vendida.status).toBe(201);

      const conComision = await resultado();
      expect(conComision.body.comisionesPorPagar).toEqual([
        { vendedor: 'Ana', tasa: '0.1500', ventasNetas: '60.00', comision: '9.00' },
      ]);
      // El corte de Ana tiene que decir exactamente lo mismo.
      expect((await como(app, ANA).get('/reportes/corte')).body.comisionVendedor).toBe('9.00');

      // Devuelve una pieza: la comisión baja sola, sin tocarla.
      await como(app, ANA).post(`/ventas/${vendida.body.id}/devoluciones`, {
        claveIdempotencia: clave(),
        motivo: 'No le gustó',
        lineas: [{ productoId: IDS.tejocote, cantidad: 1 }],
      });
      const despues = await resultado();
      expect(despues.body.comisionesPorPagar[0]).toMatchObject({
        ventasNetas: '30.00',
        comision: '4.50',
      });
      expect((await como(app, ANA).get('/reportes/corte')).body.comisionVendedor).toBe('4.50');
    });

    it('cambiar la tasa no reescribe lo ya vendido', async () => {
      await cargarAAna(4);
      await comisionDeAna('0.15');
      await vender(1);
      await comisionDeAna('0.05');
      await vender(1);

      // Cada venta con la tasa que tenía ese día: $4.50 y $1.50.
      const { body } = await resultado();
      expect(body.comisionesPorPagar).toEqual([
        { vendedor: 'Ana', tasa: '0.1500', ventasNetas: '30.00', comision: '4.50' },
        { vendedor: 'Ana', tasa: '0.0500', ventasNetas: '30.00', comision: '1.50' },
      ]);
    });

    it('el saldo es lo ganado menos lo pagado, y el pago lo baja', async () => {
      await cargarAAna(4);
      const anaId = await comisionDeAna('0.15');
      await vender(2); // $60 × 15 % = $9.00

      const conDeuda = await como(app, ADMIN).get('/reportes/comisiones');
      expect(conDeuda.body).toEqual([
        {
          vendedorId: anaId,
          vendedor: 'Ana',
          tasa: '0.1500',
          ganado: '9.00',
          pagado: '0.00',
          saldo: '9.00',
          ganadoEnPeriodo: '9.00',
          pagosEnPeriodo: [],
        },
      ]);

      // Se le abona la mitad: el saldo baja, no lo ganado.
      const pago = await como(app, ADMIN).post('/gastos', {
        claveIdempotencia: clave(),
        categoriaId: 2,
        concepto: 'Comisión de Ana',
        importe: '4.00',
        metodoPago: 'efectivo',
        vendedorId: anaId,
      });
      expect(pago.status).toBe(201);
      expect(pago.body.vendedor).toBe('Ana');

      const conAbono = (await como(app, ADMIN).get('/reportes/comisiones')).body[0];
      expect(conAbono).toMatchObject({ ganado: '9.00', pagado: '4.00', saldo: '5.00' });
      expect(conAbono.pagosEnPeriodo).toEqual([
        { folio: pago.body.folio, fecha: pago.body.fecha, importe: '4.00' },
      ]);

      // Si el pago se cancela, la deuda vuelve.
      await como(app, ADMIN).post(`/gastos/${pago.body.id}/cancelar`, { motivo: 'Me equivoqué' });
      expect((await como(app, ADMIN).get('/reportes/comisiones')).body[0]).toMatchObject({
        pagado: '0.00',
        saldo: '9.00',
      });
    });

    it('una devolución baja lo ganado y el saldo', async () => {
      await cargarAAna(4);
      await comisionDeAna('0.15');
      const vendida = await vender(2);
      await como(app, ANA).post(`/ventas/${vendida.body.id}/devoluciones`, {
        claveIdempotencia: clave(),
        motivo: 'No le gustó',
        lineas: [{ productoId: IDS.tejocote, cantidad: 1 }],
      });
      expect((await como(app, ADMIN).get('/reportes/comisiones')).body[0]).toMatchObject({
        ganado: '4.50',
        saldo: '4.50',
      });
    });

    it('pagar de más deja saldo a favor de la vendedora, sin romper nada', async () => {
      await cargarAAna(4);
      const anaId = await comisionDeAna('0.15');
      await vender(1); // $4.50
      await como(app, ADMIN).post('/gastos', {
        claveIdempotencia: clave(),
        categoriaId: 2,
        concepto: 'Comisión de Ana',
        importe: '10.00',
        metodoPago: 'efectivo',
        vendedorId: anaId,
      });
      expect((await como(app, ADMIN).get('/reportes/comisiones')).body[0]).toMatchObject({
        ganado: '4.50',
        pagado: '10.00',
        saldo: '-5.50',
      });
    });

    it('sin permiso de costos no se ven las comisiones', async () => {
      expect((await como(app, ANA).get('/reportes/comisiones')).status).toBe(403);
      expect((await como(app, CONSULTA).get('/reportes/comisiones')).status).toBe(200);
    });

    it('sin permiso de costos no se ve el resultado', async () => {
      expect((await como(app, ANA).get('/reportes/resultado')).status).toBe(403);
      expect((await como(app, CONSULTA).get('/reportes/resultado')).status).toBe(200);
    });
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
