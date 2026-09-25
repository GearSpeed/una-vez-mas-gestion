import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, ANA, clave, como, CONSULTA, crearApp, reiniciarBd } from './ayudantes.js';

/** Las que siembra la migración 0012, en orden. */
const EMPAQUE = 1;
const COMISIONES = 2;

const gasto = (extra: object = {}) => ({
  claveIdempotencia: clave(),
  categoriaId: EMPAQUE,
  concepto: 'Bolsas de celofán',
  importe: '240.50',
  metodoPago: 'efectivo',
  ...extra,
});

/**
 * Los gastos de operación: lo que separa la utilidad bruta de la ganancia de
 * verdad. No son mercancía (esa entra por compras) y no se borran: se cancelan.
 */
describe('gastos de operación', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(reiniciarBd);

  it('se registra y suma en el periodo, por categoría', async () => {
    const registrado = await como(app, ADMIN).post('/gastos', gasto());
    expect(registrado.status).toBe(201);
    expect(registrado.body).toMatchObject({
      folio: 'G-000001',
      categoria: 'Empaque',
      importe: '240.50',
      estado: 'vigente',
      registradoPor: 'Admin',
    });

    await como(app, ADMIN).post(
      '/gastos',
      gasto({ categoriaId: COMISIONES, concepto: 'Comisión de Ana', importe: '1000.00' }),
    );

    const lista = await como(app, ADMIN).get('/gastos');
    expect(lista.body.total).toBe(2);
    expect(lista.body.resumen.importe).toBe('1240.50');
    expect(lista.body.resumen.porCategoria).toEqual([
      { categoria: 'Comisiones', importe: '1000.00' },
      { categoria: 'Empaque', importe: '240.50' },
    ]);
  });

  it('la misma clave no registra el gasto dos veces', async () => {
    const datos = gasto();
    const primero = await como(app, ADMIN).post('/gastos', datos);
    const repetido = await como(app, ADMIN).post('/gastos', datos);
    expect(repetido.body.id).toBe(primero.body.id);
    expect((await como(app, ADMIN).get('/gastos')).body.total).toBe(1);
  });

  it('un gasto cancelado deja de contar, y no se cancela dos veces', async () => {
    const registrado = await como(app, ADMIN).post('/gastos', gasto());
    const cancelado = await como(app, ADMIN).post(`/gastos/${registrado.body.id}/cancelar`, {
      motivo: 'Se capturó dos veces',
    });
    expect(cancelado.status).toBe(201);
    expect(cancelado.body).toMatchObject({
      estado: 'cancelado',
      cancelacion: { por: 'Admin', motivo: 'Se capturó dos veces' },
    });

    const lista = await como(app, ADMIN).get('/gastos');
    // Sigue a la vista, pero ya no suma.
    expect(lista.body.total).toBe(1);
    expect(lista.body.resumen.importe).toBe('0.00');

    expect(
      (
        await como(app, ADMIN).post(`/gastos/${registrado.body.id}/cancelar`, {
          motivo: 'otra vez',
        })
      ).status,
    ).toBe(409);
  });

  it('no se registra en una categoría dada de baja', async () => {
    await como(app, ADMIN).put(`/gastos/categorias/${EMPAQUE}`, {
      nombre: 'Empaque',
      orden: 1,
      activa: false,
    });
    const respuesta = await como(app, ADMIN).post('/gastos', gasto());
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos.categoriaId).toMatch(/dada de baja/);
  });

  it('un vendedor no ve ni registra gastos; quien consulta, solo ve', async () => {
    await como(app, ADMIN).post('/gastos', gasto());
    expect((await como(app, ANA).get('/gastos')).status).toBe(403);
    expect((await como(app, ANA).post('/gastos', gasto())).status).toBe(403);

    expect((await como(app, CONSULTA).get('/gastos')).body.total).toBe(1);
    expect((await como(app, CONSULTA).post('/gastos', gasto())).status).toBe(403);
  });
});
