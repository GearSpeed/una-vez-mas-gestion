import type { INestApplication } from '@nestjs/common';
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

const venta = (cantidad: number, extra: object = {}) => ({
  claveIdempotencia: clave(),
  canal: 'presencial',
  metodoPago: 'efectivo',
  lineas: [{ productoId: IDS.tejocote, cantidad }],
  ...extra,
});

const devolucion = (lineas: object[], extra: object = {}) => ({
  claveIdempotencia: clave(),
  motivo: 'El cliente cambió de opinión',
  lineas,
  ...extra,
});

describe('comisión de tarjeta y devoluciones', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });

  /** V001 en el almacén, tejocote a $30 y 6 piezas cargadas a Ana. */
  beforeEach(async () => {
    await reiniciarBd();
    await como(app, ALMACEN).post('/compras', compraV001());
    await como(app, ADMIN).put(
      `/productos/${IDS.tejocote}`,
      productoConPrecio('Galletas de Mermelada de Tejocote', 30),
    );
    await como(app, ALMACEN).post('/inventario/traspasos', {
      claveIdempotencia: clave(),
      origenId: IDS.almacen,
      destinoId: IDS.ana,
      lineas: [{ productoId: IDS.tejocote, cantidad: 6 }],
    });
  });

  const piezasDeAna = async () => {
    const respuesta = await como(app, ANA).get('/inventario/existencias');
    return respuesta.body.filas.find((f: { productoId: number }) => f.productoId === IDS.tejocote)
      .cantidad as number;
  };

  describe('comisión de Mercado Pago', () => {
    it('con tarjeta guarda lo que retiene (3.50 % + IVA) y la utilidad usa el neto', async () => {
      const vendida = await como(app, ANA).post('/ventas', venta(4, { metodoPago: 'tarjeta' }));
      // $120 × 3.50 % = $4.20; IVA 16 % = $0.67; retiene $4.87
      expect(vendida.body).toMatchObject({ total: '120.00', comision: '4.87' });

      const detalle = await como(app, ADMIN).get(`/ventas/${vendida.body.id}`);
      // $120 − $4.87 de comisión − $71.64 de costo
      expect(detalle.body.costos).toEqual({ costoTotal: '71.64', utilidad: '43.49' });
    });

    it('en efectivo no hay comisión', async () => {
      const vendida = await como(app, ANA).post('/ventas', venta(1));
      expect(vendida.body.comision).toBe('0.00');
    });

    it('cualquiera ve la tarifa; solo el admin la cambia, y solo afecta a las ventas nuevas', async () => {
      const tarifas = await como(app, ANA).get('/comisiones');
      expect(tarifas.body).toEqual([
        { metodoPago: 'tarjeta', tasa: '0.0350', iva: '0.1600', tasaEfectiva: '0.0406' },
      ]);

      const antes = await como(app, ANA).post('/ventas', venta(1, { metodoPago: 'tarjeta' }));
      expect(
        (await como(app, ANA).put('/comisiones/tarjeta', { tasa: 0.05, iva: 0.16 })).status,
      ).toBe(403);
      const cambio = await como(app, ADMIN).put('/comisiones/tarjeta', { tasa: 0.05, iva: 0.16 });
      expect(cambio.body.tasaEfectiva).toBe('0.0580');

      const despues = await como(app, ANA).post('/ventas', venta(1, { metodoPago: 'tarjeta' }));
      expect(despues.body.comision).toBe('1.74');
      expect((await como(app, ANA).get(`/ventas/${antes.body.id}`)).body.comision).toBe('1.22');
    });

    it('el corte separa lo cobrado con tarjeta y lo que retuvo Mercado Pago', async () => {
      await como(app, ANA).post('/ventas', venta(4, { metodoPago: 'tarjeta' }));
      await como(app, ANA).post('/ventas', venta(1));
      const corte = await como(app, ANA).get('/reportes/corte');
      expect(corte.body.cobros).toMatchObject({ tarjeta: '120.00', efectivo: '30.00' });
      expect(corte.body.comisiones).toBe('4.87');
      expect(corte.body.totalVendido).toBe('150.00');
    });

    it('la utilidad por producto descuenta la comisión', async () => {
      await como(app, ANA).post('/ventas', venta(4, { metodoPago: 'tarjeta' }));
      const utilidad = await como(app, ADMIN).get('/reportes/utilidad');
      expect(utilidad.body[0]).toMatchObject({
        ingreso: '120.00',
        costo: '71.64',
        comision: '4.87',
        utilidad: '43.49',
      });
    });

    it('al devolver, Mercado Pago regresa la parte proporcional de su comisión', async () => {
      const vendida = await como(app, ANA).post('/ventas', venta(4, { metodoPago: 'tarjeta' }));
      const ruta = `/ventas/${vendida.body.id}/devoluciones`;

      // Regresa 1 de 4: al cliente $30 íntegros; de los $4.87, Mercado Pago regresa $1.22.
      const parcial = await como(app, ANA).post(
        ruta,
        devolucion([{ productoId: IDS.tejocote, cantidad: 1 }]),
      );
      expect(parcial.body).toMatchObject({ reembolsado: '30.00', comision: '3.65' });
      expect(parcial.body.devoluciones[0]).toMatchObject({
        reembolso: '30.00',
        comisionDevuelta: '1.22',
      });
      const detalle = await como(app, ADMIN).get(`/ventas/${vendida.body.id}`);
      // $120 − $30 − $3.65 de comisión − 3 × $17.91 de costo
      expect(detalle.body.costos).toEqual({ costoTotal: '53.73', utilidad: '32.62' });
      const utilidad = await como(app, ADMIN).get('/reportes/utilidad');
      expect(utilidad.body[0]).toMatchObject({ ingreso: '90.00', comision: '3.65' });

      // Regresa el resto: la comisión vuelve completa y la venta queda en ceros.
      const total = await como(app, ANA).post(
        ruta,
        devolucion([{ productoId: IDS.tejocote, cantidad: 3 }]),
      );
      expect(total.body).toMatchObject({ reembolsado: '120.00', comision: '0.00' });
      expect(total.body.devoluciones[1].comisionDevuelta).toBe('3.65');
      expect((await como(app, ADMIN).get(`/ventas/${vendida.body.id}`)).body.costos).toEqual({
        costoTotal: '0.00',
        utilidad: '0.00',
      });

      const lista = await como(app, ANA).get('/ventas');
      expect(lista.body.resumen).toMatchObject({ importe: '0.00', comisiones: '0.00' });
      expect(lista.body.filas[0]).toMatchObject({ comision: '0.00', reembolsado: '120.00' });
      const corte = await como(app, ANA).get('/reportes/corte');
      expect(corte.body).toMatchObject({ comisiones: '0.00', totalVendido: '0.00' });
    });
  });

  describe('devoluciones', () => {
    it('lo que regresa vuelve a la ubicación del vendedor y se reembolsa proporcional', async () => {
      const vendida = await como(app, ANA).post('/ventas', venta(3));
      expect(await piezasDeAna()).toBe(3);

      const devuelta = await como(app, ANA).post(
        `/ventas/${vendida.body.id}/devoluciones`,
        devolucion([{ productoId: IDS.tejocote, cantidad: 1, regresaAInventario: true }]),
      );
      expect(devuelta.status).toBe(201);
      expect(devuelta.body).toMatchObject({ total: '90.00', reembolsado: '30.00' });
      expect(devuelta.body.lineas[0]).toMatchObject({ devueltas: 1, reembolsado: '30.00' });
      expect(devuelta.body.devoluciones).toMatchObject([
        {
          folio: 'D-000001',
          motivo: 'El cliente cambió de opinión',
          reembolso: '30.00',
          lineas: [{ productoId: IDS.tejocote, cantidad: 1, regresaAInventario: true }],
        },
      ]);
      expect(await piezasDeAna()).toBe(4);
      // A un vendedor tampoco le llegan costos en la devolución.
      expect(llavesDe(devuelta.body).filter((llave) => /costo|utilidad/i.test(llave))).toEqual([]);
    });

    it('lo que llega dañado no vuelve al inventario y su costo se pierde', async () => {
      const vendida = await como(app, ANA).post('/ventas', venta(2));
      await como(app, ANA).post(
        `/ventas/${vendida.body.id}/devoluciones`,
        devolucion([{ productoId: IDS.tejocote, cantidad: 1, regresaAInventario: false }]),
      );
      expect(await piezasDeAna()).toBe(4);

      const detalle = await como(app, ADMIN).get(`/ventas/${vendida.body.id}`);
      // Se cobró $60 y se regresaron $30; el costo de las 2 piezas se quedó ($35.82).
      expect(detalle.body.costos).toEqual({ costoTotal: '35.82', utilidad: '-5.82' });
    });

    it('prorratea el descuento y varias devoluciones suman exacto la línea', async () => {
      const vendida = await como(app, ADMIN).post('/ventas', {
        ...venta(3),
        ubicacionId: IDS.ana,
        lineas: [{ productoId: IDS.tejocote, cantidad: 3, descuento: 5 }],
      });
      expect(vendida.body.total).toBe('85.00');
      const ruta = `/ventas/${vendida.body.id}/devoluciones`;
      const una = [{ productoId: IDS.tejocote, cantidad: 1 }];
      expect((await como(app, ADMIN).post(ruta, devolucion(una))).body.reembolsado).toBe('28.33');
      expect((await como(app, ADMIN).post(ruta, devolucion(una))).body.reembolsado).toBe('56.67');
      const completa = await como(app, ADMIN).post(ruta, devolucion(una));
      expect(completa.body.reembolsado).toBe('85.00');
      expect(completa.body.devoluciones.map((d: { reembolso: string }) => d.reembolso)).toEqual([
        '28.33',
        '28.34',
        '28.33',
      ]);
    });

    it('no deja devolver más de lo que queda', async () => {
      const vendida = await como(app, ANA).post('/ventas', venta(2));
      const ruta = `/ventas/${vendida.body.id}/devoluciones`;
      await como(app, ANA).post(ruta, devolucion([{ productoId: IDS.tejocote, cantidad: 1 }]));
      const demasiado = await como(app, ANA).post(
        ruta,
        devolucion([{ productoId: IDS.tejocote, cantidad: 2 }]),
      );
      expect(demasiado.status).toBe(422);
      expect(demasiado.body.campos['lineas.0.cantidad']).toBe(
        'De Galletas de Mermelada de Tejocote solo quedan 1 por devolver.',
      );

      const otro = await como(app, ANA).post(
        ruta,
        devolucion([{ productoId: IDS.avena, cantidad: 1 }]),
      );
      expect(otro.body.campos['lineas.0.productoId']).toBe('Ese producto no está en la venta.');
    });

    it('un vendedor solo devuelve de sus ventas', async () => {
      const deAna = await como(app, ANA).post('/ventas', venta(1));
      const respuesta = await como(app, BETO).post(
        `/ventas/${deAna.body.id}/devoluciones`,
        devolucion([{ productoId: IDS.tejocote, cantidad: 1 }]),
      );
      expect(respuesta.status).toBe(404);
      // Almacén no tiene ventas.devolver.
      const almacen = await como(app, ALMACEN).post(
        `/ventas/${deAna.body.id}/devoluciones`,
        devolucion([{ productoId: IDS.tejocote, cantidad: 1 }]),
      );
      expect(almacen.status).toBe(403);
    });

    it('un reintento con la misma clave no duplica la devolución', async () => {
      const vendida = await como(app, ANA).post('/ventas', venta(2));
      const datos = devolucion([{ productoId: IDS.tejocote, cantidad: 1 }]);
      await como(app, ANA).post(`/ventas/${vendida.body.id}/devoluciones`, datos);
      const otra = await como(app, ANA).post(`/ventas/${vendida.body.id}/devoluciones`, datos);
      expect(otra.body.devoluciones).toHaveLength(1);
      expect(await piezasDeAna()).toBe(5);
    });

    it('una venta con devoluciones ya no se cancela, y una cancelada no se devuelve', async () => {
      const conDevolucion = await como(app, ANA).post('/ventas', venta(2));
      await como(app, ANA).post(
        `/ventas/${conDevolucion.body.id}/devoluciones`,
        devolucion([{ productoId: IDS.tejocote, cantidad: 1 }]),
      );
      const cancelar = await como(app, ADMIN).post(`/ventas/${conDevolucion.body.id}/cancelar`, {
        motivo: 'error',
      });
      expect(cancelar.status).toBe(409);

      const cancelada = await como(app, ANA).post('/ventas', venta(1));
      await como(app, ADMIN).post(`/ventas/${cancelada.body.id}/cancelar`, { motivo: 'error' });
      const devolverCancelada = await como(app, ANA).post(
        `/ventas/${cancelada.body.id}/devoluciones`,
        devolucion([{ productoId: IDS.tejocote, cantidad: 1 }]),
      );
      expect(devolverCancelada.status).toBe(409);
    });

    it('las listas, el corte y el kardex cuentan la devolución', async () => {
      const vendida = await como(app, ANA).post('/ventas', venta(4));
      await como(app, ANA).post(
        `/ventas/${vendida.body.id}/devoluciones`,
        devolucion([{ productoId: IDS.tejocote, cantidad: 1 }]),
      );

      const lista = await como(app, ANA).get('/ventas');
      expect(lista.body.filas[0]).toMatchObject({ total: '120.00', reembolsado: '30.00' });
      expect(lista.body.resumen).toMatchObject({
        importe: '90.00',
        reembolsos: '30.00',
        porMetodo: { efectivo: '90.00' },
      });

      const corte = await como(app, ANA).get('/reportes/corte');
      expect(corte.body.productos[0]).toMatchObject({ cargo: 6, vendio: 3, trae: 3 });
      expect(corte.body.reembolsos.efectivo).toBe('30.00');
      expect(corte.body.totalVendido).toBe('90.00');

      const tablero = await como(app, ADMIN).get('/reportes/tablero');
      expect(tablero.body.ventas.hoy).toEqual({ importe: '90.00', ventas: 1 });

      const kardex = await como(app, ADMIN).get(`/inventario/kardex?productoId=${IDS.tejocote}`);
      expect(kardex.body.filas[0]).toMatchObject({
        tipo: 'devolucion',
        documento: 'D-000001',
        cantidad: 1,
        ubicacion: 'Ana',
      });
    });
  });
});
