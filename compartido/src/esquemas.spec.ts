import { describe, expect, it } from 'vitest';
import {
  esquemaNuevaCompra,
  esquemaNuevaVenta,
  esquemaImagenProducto,
  esquemaProducto,
  esquemaUsuario,
} from './esquemas.js';

const CLAVE = '6f1c1c3e-2b1a-4c8e-9a51-1d2f3a4b5c6d';

describe('esquemaProducto', () => {
  it('descarta el slug si alguien lo manda: lo genera la API', () => {
    const producto = esquemaProducto.parse({
      slug: 'otro-slug',
      nombre: 'Galletas de Mermelada de Piña',
      categoriaId: 1,
    });
    expect(producto).not.toHaveProperty('slug');
  });

  it('convierte los campos vacíos del formulario en null', () => {
    const producto = esquemaProducto.parse({
      nombre: 'Galletas de Mermelada de Piña',
      categoriaId: 1,
      precioVenta: '',
      presentacion: '',
    });
    expect(producto.precioVenta).toBeNull();
    expect(producto.presentacion).toBeNull();
  });

  it('acepta el precio como número y lo guarda como texto', () => {
    const producto = esquemaProducto.parse({
      nombre: 'A',
      categoriaId: 1,
      precioVenta: 30,
    });
    expect(producto.precioVenta).toBe('30');
  });

  it('no acepta más de dos decimales en el precio', () => {
    const resultado = esquemaProducto.safeParse({
      nombre: 'A',
      categoriaId: 1,
      precioVenta: '30.001',
    });
    expect(resultado.success).toBe(false);
  });
});

describe('esquemaNuevaCompra', () => {
  const base = {
    claveIdempotencia: CLAVE,
    fecha: '2026-09-19',
    proveedorId: 1,
    vehiculoId: 1,
    precioGasolina: '23',
    lineas: [{ productoId: 1, cantidad: 10, costoProveedor: '17.55' }],
  };

  it('acepta una compra con viaje', () => {
    expect(esquemaNuevaCompra.safeParse(base).success).toBe(true);
  });

  it('con vehículo exige el precio de la gasolina', () => {
    const resultado = esquemaNuevaCompra.safeParse({ ...base, precioGasolina: null });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['precioGasolina']);
  });

  it('no deja repetir un producto (el renglón duplicado del Excel)', () => {
    const resultado = esquemaNuevaCompra.safeParse({
      ...base,
      lineas: [
        { productoId: 2, cantidad: 10, costoProveedor: '16.58' },
        { productoId: 2, cantidad: 10, costoProveedor: '16.58' },
      ],
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['lineas', 1, 'productoId']);
  });
});

const ventaDePrueba = (extra: object) => ({
  claveIdempotencia: CLAVE,
  canal: 'whatsapp',
  pagos: [{ metodoPago: 'efectivo', importe: '60.00' }],
  lineas: [{ productoId: 1, cantidad: 2 }],
  ...extra,
});

describe('esquemaNuevaVenta', () => {
  it('pone el descuento en cero si no viene', () => {
    const resultado = esquemaNuevaVenta.parse(ventaDePrueba({}));
    expect(resultado.lineas[0]?.descuento).toBe('0');
  });

  it('acepta que el cobro se reparta entre varias formas de pago', () => {
    const resultado = esquemaNuevaVenta.parse(
      ventaDePrueba({
        pagos: [
          { metodoPago: 'efectivo', importe: '40' },
          { metodoPago: 'tarjeta', importe: 20 },
        ],
      }),
    );
    expect(resultado.pagos).toEqual([
      { metodoPago: 'efectivo', importe: '40' },
      { metodoPago: 'tarjeta', importe: '20' },
    ]);
  });

  it('no deja repetir el método ni quedarse sin pagos', () => {
    const repetido = esquemaNuevaVenta.safeParse(
      ventaDePrueba({
        pagos: [
          { metodoPago: 'efectivo', importe: '30' },
          { metodoPago: 'efectivo', importe: '30' },
        ],
      }),
    );
    expect(repetido.success).toBe(false);
    expect(esquemaNuevaVenta.safeParse(ventaDePrueba({ pagos: [] })).success).toBe(false);
  });
});

describe('esquemaUsuario', () => {
  it('guarda el correo en minúsculas', () => {
    const usuario = esquemaUsuario.parse({
      correo: ' Ana@UnaVezMasMX.com ',
      nombre: 'Ana',
      roles: ['vendedor'],
    });
    expect(usuario.correo).toBe('ana@unavezmasmx.com');
  });
});

describe('esquemaImagenProducto', () => {
  it('recorta el texto alternativo y lo exige con sentido', () => {
    expect(esquemaImagenProducto.parse({ alt: '  Galletas de avena en un plato  ' })).toEqual({
      alt: 'Galletas de avena en un plato',
    });
    expect(esquemaImagenProducto.safeParse({ alt: ' a ' }).success).toBe(false);
    expect(esquemaImagenProducto.safeParse({ alt: 'x'.repeat(201) }).success).toBe(false);
  });
});
