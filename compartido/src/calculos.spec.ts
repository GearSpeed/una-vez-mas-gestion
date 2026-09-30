import { describe, expect, it } from 'vitest';
import {
  calcularCompra,
  comisionDeCobro,
  comisionDeVendedor,
  comisionDevuelta,
  costoTraslado,
  descuentoPorVolumen,
  descuentoValido,
  importeLinea,
  indicadoresPrecio,
  litrosDelViaje,
  promedioTrasEntrada,
  promedioTrasRetiro,
  reembolsoDeLinea,
  repartirProporcional,
  redondear,
  sumar,
  tasaEfectiva,
  totalVenta,
  trasladoPorPieza,
} from './calculos.js';

/** El viaje V001 del Excel: 40 km de ida y vuelta, a 32 km/l, con la gasolina a $23. */
const V001 = { distanciaKm: '40', rendimientoKmL: '32', precioGasolina: '23' };

/** Las 8 líneas de la compra V001 del Excel, tal como estaban (chispas dos veces). */
const LINEAS_V001 = [
  { cantidad: 10, costoProveedor: '17.55' }, // tejocote
  { cantidad: 10, costoProveedor: '16.58' }, // chispas
  { cantidad: 10, costoProveedor: '15.60' }, // granola
  { cantidad: 10, costoProveedor: '17.00' }, // nuez
  { cantidad: 10, costoProveedor: '15.60' }, // avena
  { cantidad: 10, costoProveedor: '16.58' }, // chispas (renglón repetido)
  { cantidad: 10, costoProveedor: '17.55' }, // piña
  { cantidad: 10, costoProveedor: '14.14' }, // canela
];

describe('compra con viaje (paridad con el Excel)', () => {
  it('calcula litros y costo del viaje V001', () => {
    expect(litrosDelViaje(V001)).toBe('1.250');
    expect(costoTraslado(V001)).toBe('28.75');
  });

  it('reparte la gasolina entre las 80 piezas', () => {
    const compra = calcularCompra(V001, LINEAS_V001);
    expect(compra.piezas).toBe(80);
    expect(compra.trasladoPorPieza).toBe('0.359375');
    expect(compra.lineas[0]?.costoUnitario).toBe('17.909375');
  });

  it('suma mercancía y gasolina en el total', () => {
    const compra = calcularCompra(V001, LINEAS_V001);
    expect(compra.subtotalMercancia).toBe('1306.00');
    expect(compra.total).toBe('1334.75');
  });

  it('sin vehículo el traslado vale cero', () => {
    const compra = calcularCompra(null, [{ cantidad: 5, costoProveedor: '10' }]);
    expect(compra.litros).toBeNull();
    expect(compra.costoTraslado).toBe('0.00');
    expect(compra.lineas[0]?.costoUnitario).toBe('10.000000');
  });

  it('no divide entre cero si no hay piezas', () => {
    expect(trasladoPorPieza('28.75', 0)).toBe('0.000000');
  });
});

describe('precio y márgenes', () => {
  it('da los mismos números que el Excel para el tejocote a $30', () => {
    const indicadores = indicadoresPrecio('17.909375', '30.00', '0.8');
    expect(indicadores.precioSugerido).toBe('32.24');
    expect(indicadores.gananciaPorPieza).toBe('12.09');
    expect(indicadores.margenSobrePrecio).toBe('0.4030');
    expect(indicadores.gananciaSobreCosto).toBe('0.6751');
  });

  it('sin costo no inventa márgenes', () => {
    expect(indicadoresPrecio('0', '30', '0.8')).toEqual({
      precioSugerido: null,
      gananciaPorPieza: null,
      gananciaSobreCosto: null,
      margenSobrePrecio: null,
    });
  });

  it('sin precio solo da el sugerido', () => {
    const indicadores = indicadoresPrecio('10', null, '0.5');
    expect(indicadores.precioSugerido).toBe('15.00');
    expect(indicadores.gananciaPorPieza).toBeNull();
  });
});

describe('costo promedio ponderado móvil', () => {
  it('la primera entrada fija el promedio', () => {
    expect(promedioTrasEntrada(0, '0', 10, '17.909375')).toBe('17.909375');
  });

  it('pondera por cantidad', () => {
    // 10 a $10 y 30 a $20 → (100 + 600) / 40 = 17.5
    expect(promedioTrasEntrada(10, '10', 30, '20')).toBe('17.500000');
  });

  it('retirar la última entrada devuelve el promedio anterior', () => {
    const tras = promedioTrasEntrada(10, '10', 30, '20');
    expect(promedioTrasRetiro(40, tras, 30, '20')).toBe('10.000000');
  });

  it('retirar todo deja el promedio como estaba', () => {
    expect(promedioTrasRetiro(10, '12.5', 10, '12.5')).toBe('12.500000');
  });
});

describe('ventas', () => {
  it('resta el descuento de la línea', () => {
    expect(importeLinea({ cantidad: 3, precioUnitario: '30', descuento: '5' })).toBe('85.00');
  });

  it('suma las líneas', () => {
    expect(
      totalVenta([
        { cantidad: 2, precioUnitario: '30', descuento: '0' },
        { cantidad: 1, precioUnitario: '45.50', descuento: '0.50' },
      ]),
    ).toBe('105.00');
  });

  it('no acepta descuentos mayores que la línea', () => {
    expect(descuentoValido({ cantidad: 1, precioUnitario: '30', descuento: '30' })).toBe(true);
    expect(descuentoValido({ cantidad: 1, precioUnitario: '30', descuento: '30.01' })).toBe(false);
    expect(descuentoValido({ cantidad: 1, precioUnitario: '30', descuento: '-1' })).toBe(false);
  });
});

describe('comisión de Mercado Pago', () => {
  const MERCADO_PAGO = { tasa: '0.0350', iva: '0.16' };

  it('da el ejemplo de Mercado Pago: de $1,000 retiene $40.60', () => {
    expect(comisionDeCobro('1000.00', MERCADO_PAGO)).toEqual({
      base: '35.00',
      iva: '5.60',
      total: '40.60',
      neto: '959.40',
    });
  });

  it('la tasa efectiva es 4.06 %', () => {
    expect(tasaEfectiva(MERCADO_PAGO)).toBe('0.0406');
  });

  it('redondea la comisión y su IVA por separado', () => {
    // 3.50 % de $85.00 = $2.975 → $2.98; IVA 16 % = $0.4768 → $0.48
    expect(comisionDeCobro('85.00', MERCADO_PAGO)).toMatchObject({ total: '3.46', neto: '81.54' });
  });

  it('en una devolución total regresa la comisión completa', () => {
    expect(
      comisionDevuelta({
        comision: '40.60',
        total: '1000.00',
        reembolsadoAntes: '0',
        devueltaAntes: '0',
        reembolso: '1000.00',
      }),
    ).toBe('40.60');
  });

  it('en devoluciones parciales regresa la parte proporcional y al final cuadra', () => {
    // Venta de $85 con $3.46 de comisión; se devuelve $28.33 tres veces (28.33 + 28.34 + 28.33).
    const base = { comision: '3.46', total: '85.00' };
    const primera = comisionDevuelta({
      ...base,
      reembolsadoAntes: '0',
      devueltaAntes: '0',
      reembolso: '28.33',
    });
    const segunda = comisionDevuelta({
      ...base,
      reembolsadoAntes: '28.33',
      devueltaAntes: primera,
      reembolso: '28.34',
    });
    const tercera = comisionDevuelta({
      ...base,
      reembolsadoAntes: '56.67',
      devueltaAntes: (Number(primera) + Number(segunda)).toFixed(2),
      reembolso: '28.33',
    });
    expect([primera, segunda, tercera]).toEqual(['1.15', '1.16', '1.15']);
  });

  it('sin comisión no regresa nada', () => {
    expect(
      comisionDevuelta({
        comision: '0',
        total: '60.00',
        reembolsadoAntes: '0',
        devueltaAntes: '0',
        reembolso: '30.00',
      }),
    ).toBe('0.00');
  });
});

describe('reembolso de una devolución', () => {
  it('regresa la parte proporcional, con el descuento prorrateado', () => {
    // 3 piezas a $30 con $5 de descuento = $85; se devuelve 1 → $28.33
    expect(
      reembolsoDeLinea({
        importe: '85.00',
        cantidadVendida: 3,
        devueltasAntes: 0,
        reembolsadoAntes: '0',
        cantidad: 1,
      }),
    ).toBe('28.33');
  });

  it('varias devoluciones parciales suman exacto la línea', () => {
    const primera = reembolsoDeLinea({
      importe: '85.00',
      cantidadVendida: 3,
      devueltasAntes: 0,
      reembolsadoAntes: '0',
      cantidad: 1,
    });
    const segunda = reembolsoDeLinea({
      importe: '85.00',
      cantidadVendida: 3,
      devueltasAntes: 1,
      reembolsadoAntes: primera,
      cantidad: 1,
    });
    const tercera = reembolsoDeLinea({
      importe: '85.00',
      cantidadVendida: 3,
      devueltasAntes: 2,
      reembolsadoAntes: (Number(primera) + Number(segunda)).toFixed(2),
      cantidad: 1,
    });
    expect([primera, segunda, tercera]).toEqual(['28.33', '28.34', '28.33']);
  });
});

describe('repartir dinero entre varios métodos de pago', () => {
  it('reparte en proporción a lo pagado', () => {
    expect(repartirProporcional('100.00', ['60.00', '40.00'])).toEqual(['60.00', '40.00']);
    expect(repartirProporcional('50.00', ['60.00', '40.00'])).toEqual(['30.00', '20.00']);
  });

  /** Lo que no se puede perder: la suma de las partes es el total, al centavo. */
  it('no pierde ni inventa centavos cuando no divide exacto', () => {
    const partes = repartirProporcional('33.33', ['10.00', '10.00', '10.00']);
    expect(partes).toEqual(['11.11', '11.11', '11.11']);

    // El centavo que sobra cae donde el acumulado lo alcanza, no siempre al final.
    const desparejas = repartirProporcional('100.00', ['1.00', '1.00', '1.00']);
    expect(desparejas).toEqual(['33.33', '33.34', '33.33']);
    expect(sumar(desparejas)).toBe('100.00');

    // Lo que de verdad importa: nunca falta ni sobra, con cualquier reparto.
    for (const total of ['0.01', '7.77', '33.33', '1234.56']) {
      for (const pesos of [
        ['1', '2'],
        ['60', '40'],
        ['1', '1', '1'],
        ['10', '3', '7', '5'],
      ]) {
        expect(sumar(repartirProporcional(total, pesos))).toBe(redondear(total));
      }
    }
  });

  it('con un solo método le toca todo', () => {
    expect(repartirProporcional('87.65', ['87.65'])).toEqual(['87.65']);
  });

  it('una venta de cero no rompe el reparto', () => {
    expect(repartirProporcional('0.00', ['0.00', '0.00'])).toEqual(['0.00', '0.00']);
    expect(repartirProporcional('10.00', ['0.00', '0.00'])).toEqual(['10.00', '0.00']);
    expect(repartirProporcional('10.00', [])).toEqual([]);
  });
});

describe('comisión de quien vende', () => {
  it('es su tasa sobre lo que vendió', () => {
    expect(comisionDeVendedor('1000.00', '0.1500')).toBe('150.00');
    expect(comisionDeVendedor('56.00', '0.1000')).toBe('5.60');
  });

  it('sin tasa no gana comisión', () => {
    expect(comisionDeVendedor('1000.00', '0')).toBe('0.00');
  });

  /** Lo neto ya trae descontada la devolución: la comisión baja sola. */
  it('sobre lo neto, la devolución la baja sin tocar nada más', () => {
    expect(comisionDeVendedor('120.00', '0.1500')).toBe('18.00');
    expect(comisionDeVendedor('90.00', '0.1500')).toBe('13.50');
  });

  it('redondea al centavo', () => {
    expect(comisionDeVendedor('33.33', '0.1500')).toBe('5.00');
    expect(comisionDeVendedor('28.75', '0.1234')).toBe('3.55');
  });
});

const GALLETAS = 1;
const BORRACHITOS = 2;

const linea = (productoId: number, categoriaId: number, cantidad: number, precio = '30.00') => ({
  productoId,
  categoriaId,
  cantidad,
  precioUnitario: precio,
});

/**
 * Las piezas se cuentan por categoría, y de los dos escalones gana el más alto que se
 * alcance. Los números son los de la mercancía real: galletas de 30 y de 35, con 5 % desde
 * 6 piezas y 10 % desde 11.
 */
describe('descuentoPorVolumen', () => {
  const escalones = new Map([
    [GALLETAS, { desde1: 6, tasa1: '0.0500', desde2: 11, tasa2: '0.1000' }],
  ]);

  it('suma las piezas de la categoría, no las de cada producto', () => {
    // Tres de avena y tres de coco son seis galletas: entra el 5 % en las dos líneas.
    const descuentos = descuentoPorVolumen(
      [linea(1, GALLETAS, 3), linea(2, GALLETAS, 3)],
      escalones,
    );
    expect(descuentos.get(1)).toBe('4.50');
    expect(descuentos.get(2)).toBe('4.50');
  });

  it('una pieza antes del umbral, no hay descuento', () => {
    const descuentos = descuentoPorVolumen(
      [linea(1, GALLETAS, 3), linea(2, GALLETAS, 2)],
      escalones,
    );
    expect(descuentos.size).toBe(0);
  });

  it('justo en el umbral, sí entra', () => {
    expect(descuentoPorVolumen([linea(1, GALLETAS, 6)], escalones).get(1)).toBe('9.00');
  });

  it('de los dos escalones gana el más alto que se alcanza', () => {
    // 11 piezas de 30: 330 × 10 % = 33.00, no el 5 %.
    expect(descuentoPorVolumen([linea(1, GALLETAS, 11)], escalones).get(1)).toBe('33.00');
  });

  it('cada categoría cuenta por su lado', () => {
    // Seis galletas y dos borrachitos: los borrachitos no arrastran a nadie, y
    // tampoco tienen escalones capturados.
    const descuentos = descuentoPorVolumen(
      [linea(1, GALLETAS, 6), linea(9, BORRACHITOS, 2)],
      escalones,
    );
    expect(descuentos.get(1)).toBe('9.00');
    expect(descuentos.has(9)).toBe(false);
  });

  it('una categoría sin escalones capturados no descuenta nunca', () => {
    expect(descuentoPorVolumen([linea(9, BORRACHITOS, 50)], escalones).size).toBe(0);
  });

  it('respeta el precio de cada línea', () => {
    // Cuatro de 30 y dos de 35 son seis galletas: 5 % sobre lo que vale cada línea.
    const descuentos = descuentoPorVolumen(
      [linea(1, GALLETAS, 4, '30.00'), linea(4, GALLETAS, 2, '35.00')],
      escalones,
    );
    expect(descuentos.get(1)).toBe('6.00');
    expect(descuentos.get(4)).toBe('3.50');
  });

  it('redondea al centavo', () => {
    // 7 × 33.33 = 233.31; al 5 % son 11.6655.
    const conPrecioFeo = new Map([
      [GALLETAS, { desde1: 6, tasa1: '0.0500', desde2: 0, tasa2: '0' }],
    ]);
    expect(descuentoPorVolumen([linea(1, GALLETAS, 7, '33.33')], conPrecioFeo).get(1)).toBe(
      '11.67',
    );
  });

  it('un escalón en cero piezas no cuenta como escalón', () => {
    const sinSegundo = new Map([
      [GALLETAS, { desde1: 6, tasa1: '0.0500', desde2: 0, tasa2: '0.1000' }],
    ]);
    expect(descuentoPorVolumen([linea(1, GALLETAS, 50)], sinSegundo).get(1)).toBe('75.00');
  });
});
