import type { INestApplication } from '@nestjs/common';
import { multiplicar } from '@uvm/compartido';
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

/** El tejocote de las pruebas cuesta $30: el cobro sale de ahí. */
/** Galletas con sus escalones: por omisión, 5 % desde 6 piezas y 10 % desde 11. */
const capturarEscalones = (
  app: INestApplication,
  desde1 = 6,
  tasa1 = '0.05',
  desde2 = 11,
  tasa2 = '0.10',
) =>
  como(app, ADMIN).put('/categorias/1', {
    nombre: 'Galletas',
    orden: 1,
    activa: true,
    descuentoDesde1: desde1,
    descuentoTasa1: tasa1,
    descuentoDesde2: desde2,
    descuentoTasa2: tasa2,
  });

const venta = (
  cantidad: number,
  {
    metodoPago = 'efectivo',
    importe = multiplicar('30.00', cantidad),
    ...extra
  }: Record<string, unknown> & { metodoPago?: string; importe?: string } = {},
) => ({
  claveIdempotencia: clave(),
  canal: 'whatsapp',
  pagos: [{ metodoPago, importe }],
  lineas: [{ productoId: IDS.tejocote, cantidad }],
  ...extra,
});

describe('ventas', () => {
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

  describe('descuento por volumen', () => {
    it('lo aplica el servidor aunque la línea llegue sin descuento', async () => {
      await capturarEscalones(app);
      // Seis piezas a 30 son 180; el 5 % son 9, así que se cobran 171.
      const respuesta = await como(app, ANA).post(
        '/ventas',
        venta(6, { importe: '171.00', lineas: [{ productoId: IDS.tejocote, cantidad: 6 }] }),
      );
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.total).toBe('171.00');
      expect(respuesta.body.lineas[0]).toMatchObject({ descuento: '9.00', importe: '171.00' });
    });

    it('una pieza antes del umbral no descuenta nada', async () => {
      await capturarEscalones(app);
      const respuesta = await como(app, ANA).post('/ventas', venta(5));
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.total).toBe('150.00');
    });

    it('sin escalones capturados no descuenta, por muchas piezas que sean', async () => {
      const respuesta = await como(app, ANA).post('/ventas', venta(6, { importe: '180.00' }));
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.total).toBe('180.00');
    });

    it('la comisión de la vendedora baja con el descuento', async () => {
      await capturarEscalones(app);
      const ana = (await como(app, ADMIN).get('/usuarios')).body.find(
        (u: { correo: string }) => u.correo === ANA,
      );
      await como(app, ADMIN).put(`/usuarios/${ana.id}`, { ...ana, comisionVenta: '0.15' });
      await como(app, ANA).post(
        '/ventas',
        venta(6, { importe: '171.00', lineas: [{ productoId: IDS.tejocote, cantidad: 6 }] }),
      );
      const corte = await como(app, ANA).get('/reportes/corte');
      // 15 % de 171, no de 180: la comisión sale de lo neto.
      expect(corte.body.comisionVendedor).toBe('25.65');
    });

    it('un descuento manual mayor gana sobre el automático', async () => {
      await capturarEscalones(app);
      // Lo da el admin: la vendedora no tiene el permiso de descontar a mano. Vende
      // desde la ubicación de Ana, que es donde está la mercancía.
      const respuesta = await como(app, ADMIN).post('/ventas', {
        ...venta(6, { importe: '160.00' }),
        ubicacionId: IDS.ana,
        lineas: [{ productoId: IDS.tejocote, cantidad: 6, descuento: '20.00' }],
      });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.lineas[0].descuento).toBe('20.00');
    });

    it('no se vende por debajo de lo que costó traerlo', async () => {
      // La mitad de descuento deja la pieza en 15, y traerla costó más que eso.
      await capturarEscalones(app, 6, '0.50', 0, '0');
      const respuesta = await como(app, ANA).post('/ventas', venta(6, { importe: '90.00' }));
      expect(respuesta.status).toBe(422);
      expect(respuesta.body.mensaje).toMatch(/costó/);
    });
  });

  it('descuenta de la ubicación de la vendedora al precio de lista', async () => {
    const respuesta = await como(app, ANA).post('/ventas', venta(4));
    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toMatchObject({
      folio: 'V-000001',
      ubicacion: 'Ana',
      total: '120.00',
      piezas: 4,
    });

    const suya = await como(app, ANA).get('/inventario/existencias');
    const tejocote = suya.body.filas.find(
      (f: { productoId: number }) => f.productoId === IDS.tejocote,
    );
    expect(tejocote.cantidad).toBe(2);
  });

  it('una venta se cobra con varias formas de pago', async () => {
    const respuesta = await como(app, ANA).post('/ventas', {
      ...venta(4),
      pagos: [
        { metodoPago: 'efectivo', importe: '70.00' },
        { metodoPago: 'tarjeta', importe: '50.00' },
      ],
    });
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.total).toBe('120.00');
    expect(respuesta.body.pagos).toEqual([
      { metodoPago: 'efectivo', importe: '70.00', comision: '0.00' },
      // La comisión sale SOLO de los $50 de tarjeta: 50 × 3.50 % = 1.75, +16 % = 2.03.
      { metodoPago: 'tarjeta', importe: '50.00', comision: '2.03' },
    ]);
    expect(respuesta.body.comision).toBe('2.03');
  });

  it('el cobro tiene que sumar exactamente el total', async () => {
    const falta = await como(app, ANA).post('/ventas', {
      ...venta(4),
      pagos: [{ metodoPago: 'efectivo', importe: '100.00' }],
    });
    expect(falta.status).toBe(422);
    expect(falta.body.campos.pagos).toMatch(/\$120\.00 y los pagos suman \$100\.00/);

    const sobra = await como(app, ANA).post('/ventas', {
      ...venta(4),
      pagos: [
        { metodoPago: 'efectivo', importe: '100.00' },
        { metodoPago: 'transferencia', importe: '30.00' },
      ],
    });
    expect(sobra.status).toBe(422);

    // Y nada de esto dejó rastro: la mercancía sigue completa.
    const suya = await como(app, ANA).get('/inventario/existencias');
    expect(
      suya.body.filas.find((f: { productoId: number }) => f.productoId === IDS.tejocote).cantidad,
    ).toBe(6);
  });

  it('no se puede repetir el mismo método de pago', async () => {
    const respuesta = await como(app, ANA).post('/ventas', {
      ...venta(4),
      pagos: [
        { metodoPago: 'efectivo', importe: '60.00' },
        { metodoPago: 'efectivo', importe: '60.00' },
      ],
    });
    expect(respuesta.status).toBe(422);
  });

  it('a un vendedor nunca le llegan costos', async () => {
    const vendida = await como(app, ANA).post('/ventas', venta(1));
    const respuestas = [
      vendida.body,
      (await como(app, ANA).get(`/ventas/${vendida.body.id}`)).body,
      (await como(app, ANA).get('/ventas')).body,
      (await como(app, ANA).get('/inventario/existencias')).body,
      (await como(app, ANA).get('/productos')).body,
      (await como(app, ANA).get('/reportes/corte')).body,
    ];
    for (const cuerpo of respuestas) {
      expect(llavesDe(cuerpo).filter((llave) => /costo|utilidad|margen/i.test(llave))).toEqual([]);
    }

    // El admin sí los ve.
    const detalle = await como(app, ADMIN).get(`/ventas/${vendida.body.id}`);
    expect(detalle.body.costos).toEqual({ costoTotal: '17.91', utilidad: '12.09' });
  });

  it('no deja vender más de lo que trae', async () => {
    const respuesta = await como(app, ANA).post('/ventas', venta(7));
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.mensaje).toBe('Solo hay 6 de Galletas de Mermelada de Tejocote en Ana.');
  });

  it('de dos ventas simultáneas de la última pieza, solo pasa una', async () => {
    await como(app, ANA).post('/ventas', venta(5));
    const [una, otra] = await Promise.all([
      como(app, ANA).post('/ventas', venta(1)),
      como(app, ANA).post('/ventas', venta(1)),
    ]);
    expect([una.status, otra.status].toSorted((a, b) => a - b)).toEqual([201, 409]);

    const suya = await como(app, ANA).get('/inventario/existencias');
    const tejocote = suya.body.filas.find(
      (f: { productoId: number }) => f.productoId === IDS.tejocote,
    );
    expect(tejocote.cantidad).toBe(0);
  });

  it('un vendedor no puede vender de otra ubicación', async () => {
    const respuesta = await como(app, ANA).post('/ventas', venta(1, { ubicacionId: IDS.almacen }));
    expect(respuesta.status).toBe(403);
  });

  it('un vendedor sin mercancía no vende', async () => {
    const respuesta = await como(app, BETO).post('/ventas', venta(1));
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.mensaje).toMatch(/Solo hay 0/);
  });

  it('dar descuento requiere permiso', async () => {
    const conDescuento = {
      ...venta(2, { importe: '55.00' }),
      lineas: [{ productoId: IDS.tejocote, cantidad: 2, descuento: 5 }],
    };
    expect((await como(app, ANA).post('/ventas', conDescuento)).status).toBe(403);

    const delAdmin = await como(app, ADMIN).post('/ventas', {
      ...conDescuento,
      ubicacionId: IDS.ana,
    });
    expect(delAdmin.status).toBe(201);
    expect(delAdmin.body.total).toBe('55.00');
  });

  it('no se vende un producto sin precio', async () => {
    const respuesta = await como(app, ADMIN).post('/ventas', {
      ...venta(1),
      ubicacionId: IDS.almacen,
      lineas: [{ productoId: IDS.avena, cantidad: 1 }],
    });
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos['lineas.0.productoId']).toMatch(/no tiene precio/);
  });

  it('cancelar regresa la mercancía a quien la vendió', async () => {
    const vendida = await como(app, ANA).post('/ventas', venta(4));
    expect(
      (await como(app, ANA).post(`/ventas/${vendida.body.id}/cancelar`, { motivo: 'no' })).status,
    ).toBe(403);

    const cancelada = await como(app, ADMIN).post(`/ventas/${vendida.body.id}/cancelar`, {
      motivo: 'no la recogió',
    });
    expect(cancelada.body.estado).toBe('cancelado');
    const suya = await como(app, ANA).get('/inventario/existencias');
    const tejocote = suya.body.filas.find(
      (f: { productoId: number }) => f.productoId === IDS.tejocote,
    );
    expect(tejocote.cantidad).toBe(6);

    const otraVez = await como(app, ADMIN).post(`/ventas/${vendida.body.id}/cancelar`, {
      motivo: 'otra vez',
    });
    expect(otraVez.status).toBe(409);
  });

  it('cada vendedor ve solo sus ventas', async () => {
    const deAna = await como(app, ANA).post('/ventas', venta(1));
    expect((await como(app, BETO).get(`/ventas/${deAna.body.id}`)).status).toBe(404);
    expect((await como(app, BETO).get('/ventas')).body.total).toBe(0);
    expect((await como(app, ADMIN).get('/ventas')).body.total).toBe(1);
  });

  it('suma lo cobrado por método de pago', async () => {
    await como(app, ANA).post('/ventas', venta(1));
    await como(app, ANA).post('/ventas', venta(2, { metodoPago: 'transferencia' }));
    const lista = await como(app, ANA).get('/ventas');
    expect(lista.body.resumen).toMatchObject({
      importe: '90.00',
      ventas: 2,
      porMetodo: { efectivo: '30.00', transferencia: '60.00' },
    });
  });

  it('no acepta fechas futuras', async () => {
    const respuesta = await como(app, ANA).post('/ventas', venta(1, { fecha: '2999-01-01' }));
    expect(respuesta.status).toBe(422);
  });
});
