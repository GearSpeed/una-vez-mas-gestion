import type { INestApplication } from '@nestjs/common';
import { multiplicar, type MetodoPago, type SaldoBolsa } from '@uvm/compartido';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ALMACEN,
  ANA,
  clave,
  como,
  compraV001,
  CONSULTA,
  crearApp,
  IDS,
  productoConPrecio,
  reiniciarBd,
} from './ayudantes.js';

const EMPAQUE = 1;

const aportacion = (extra: object = {}) => ({
  claveIdempotencia: clave(),
  socioId: 1,
  tipo: 'aportacion',
  concepto: 'Para las cajas de empaque',
  importe: '1000.00',
  metodoPago: 'efectivo',
  ...extra,
});

const bolsa = (cuerpo: { bolsas: SaldoBolsa[] }, metodoPago: MetodoPago) =>
  cuerpo.bolsas.find((b) => b.metodoPago === metodoPago);

/**
 * El dinero que ponen y sacan los socios. No es venta ni gasto: no entra en la
 * utilidad, solo mueve la caja. Es la parte que faltaba para cuadrar al arrancar,
 * cuando el negocio todavía no se paga solo.
 */
describe('capital de los socios', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await reiniciarBd();
    await como(app, ADMIN).post('/capital/socios', { nombre: 'Omar', activo: true });
  });

  it('una aportación queda a nombre del socio y suma en el periodo', async () => {
    const registrada = await como(app, ADMIN).post('/capital', aportacion());
    expect(registrada.status).toBe(201);
    expect(registrada.body).toMatchObject({
      folio: 'K-000001',
      socio: 'Omar',
      tipo: 'aportacion',
      importe: '1000.00',
      estado: 'vigente',
      registradoPor: 'Admin',
    });

    await como(app, ADMIN).post(
      '/capital',
      aportacion({ tipo: 'retiro', concepto: 'Me pagué la gasolina', importe: '300.00' }),
    );

    const lista = await como(app, ADMIN).get('/capital');
    expect(lista.body.total).toBe(2);
    expect(lista.body.resumen).toEqual({
      aportaciones: '1000.00',
      retiros: '300.00',
      neto: '700.00',
    });
    expect(lista.body.porSocio).toEqual([{ socio: 'Omar', saldo: '700.00' }]);
  });

  it('la misma clave no registra el movimiento dos veces', async () => {
    const datos = aportacion();
    const primero = await como(app, ADMIN).post('/capital', datos);
    const repetido = await como(app, ADMIN).post('/capital', datos);
    expect(repetido.body.id).toBe(primero.body.id);
    expect((await como(app, ADMIN).get('/capital')).body.total).toBe(1);
  });

  it('cancelar lo saca del saldo, y no se cancela dos veces', async () => {
    const registrada = await como(app, ADMIN).post('/capital', aportacion());
    const cancelada = await como(app, ADMIN).post(`/capital/${registrada.body.id}/cancelar`, {
      motivo: 'Se capturó dos veces',
    });
    expect(cancelada.status).toBe(201);
    expect(cancelada.body).toMatchObject({
      estado: 'cancelado',
      cancelacion: { por: 'Admin', motivo: 'Se capturó dos veces' },
    });

    const lista = await como(app, ADMIN).get('/capital');
    // Sigue a la vista, pero ya no cuenta.
    expect(lista.body.total).toBe(1);
    expect(lista.body.resumen.neto).toBe('0.00');
    expect(bolsa((await como(app, ADMIN).get('/capital/saldos')).body, 'efectivo')?.saldo).toBe(
      '0.00',
    );

    expect(
      (
        await como(app, ADMIN).post(`/capital/${registrada.body.id}/cancelar`, {
          motivo: 'otra vez',
        })
      ).status,
    ).toBe(409);
  });

  it('no se registra a nombre de un socio dado de baja', async () => {
    await como(app, ADMIN).put('/capital/socios/1', { nombre: 'Omar', activo: false });
    const respuesta = await como(app, ADMIN).post('/capital', aportacion());
    expect(respuesta.status).toBe(404);
  });

  /** El ejemplo que lo motivó: las cajas costaron $500 y metí $1,000 para cuadrar. */
  it('la caja sube con la aportación y baja con el gasto, cada quien en su bolsa', async () => {
    await como(app, ADMIN).post('/capital', aportacion());
    await como(app, ADMIN).post('/gastos', {
      claveIdempotencia: clave(),
      categoriaId: EMPAQUE,
      concepto: 'Cajas de empaque',
      importe: '500.00',
      metodoPago: 'efectivo',
    });
    await como(app, ADMIN).post(
      '/capital',
      aportacion({ importe: '200.00', metodoPago: 'transferencia' }),
    );

    const caja = (await como(app, ADMIN).get('/capital/saldos')).body;
    expect(bolsa(caja, 'efectivo')).toMatchObject({
      aportaciones: '1000.00',
      gastos: '500.00',
      saldo: '500.00',
    });
    expect(bolsa(caja, 'transferencia')?.saldo).toBe('200.00');
    expect(caja.total).toBe('700.00');
  });

  it('lo cobrado con tarjeta entra a la caja neto de la comisión', async () => {
    await como(app, ALMACEN).post('/compras', compraV001());
    await como(app, ADMIN).put(
      `/productos/${IDS.tejocote}`,
      productoConPrecio('Galletas de Mermelada de Tejocote', 30),
    );
    await como(app, ALMACEN).post('/inventario/traspasos', {
      claveIdempotencia: clave(),
      origenId: IDS.almacen,
      destinoId: IDS.ana,
      lineas: [{ productoId: IDS.tejocote, cantidad: 4 }],
    });
    await como(app, ANA).post('/ventas', {
      claveIdempotencia: clave(),
      canal: 'whatsapp',
      pagos: [{ metodoPago: 'tarjeta', importe: multiplicar('30.00', 4) }],
      lineas: [{ productoId: IDS.tejocote, cantidad: 4 }],
    });

    const tarjeta = bolsa((await como(app, ADMIN).get('/capital/saldos')).body, 'tarjeta');
    // $120 menos el 3.5 % + IVA que retiene la terminal.
    expect(Number(tarjeta?.ventas)).toBeLessThan(120);
    expect(Number(tarjeta?.ventas)).toBeGreaterThan(114);
    expect(tarjeta?.saldo).toBe(tarjeta?.ventas);
  });

  it('una aportación no toca las ventas ni la utilidad del periodo', async () => {
    const antes = (await como(app, ADMIN).get('/reportes/resultado')).body;
    await como(app, ADMIN).post('/capital', aportacion());
    const despues = (await como(app, ADMIN).get('/reportes/resultado')).body;

    expect(despues.ventasNetas).toBe(antes.ventasNetas);
    expect(despues.utilidadOperativa).toBe(antes.utilidadOperativa);
    // El capital va aparte, con todas sus letras.
    expect(despues.capitalDelPeriodo).toEqual({
      aportaciones: '1000.00',
      retiros: '0.00',
      neto: '1000.00',
    });
  });

  it('un vendedor no ve ni registra capital; quien consulta, solo ve', async () => {
    await como(app, ADMIN).post('/capital', aportacion());
    expect((await como(app, ANA).get('/capital')).status).toBe(403);
    expect((await como(app, ANA).get('/capital/saldos')).status).toBe(403);
    expect((await como(app, ANA).post('/capital', aportacion())).status).toBe(403);

    expect((await como(app, CONSULTA).get('/capital')).body.total).toBe(1);
    expect((await como(app, CONSULTA).post('/capital', aportacion())).status).toBe(403);
  });
});
