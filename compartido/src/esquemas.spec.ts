import { describe, expect, it } from 'vitest';
import {
  esquemaNuevaCompra,
  esquemaNuevaVenta,
  esquemaProducto,
  esquemaUsuario,
} from './esquemas.js';

const CLAVE = '6f1c1c3e-2b1a-4c8e-9a51-1d2f3a4b5c6d';

describe('esquemaProducto', () => {
  it('rechaza slugs con ñ o acentos', () => {
    const resultado = esquemaProducto.safeParse({
      slug: 'galletas-mermelada-piña',
      nombre: 'Galletas de Mermelada de Piña',
      categoriaId: 1,
    });
    expect(resultado.success).toBe(false);
  });

  it('convierte los campos vacíos del formulario en null', () => {
    const producto = esquemaProducto.parse({
      slug: 'galletas-mermelada-pina',
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
      slug: 'a',
      nombre: 'A',
      categoriaId: 1,
      precioVenta: 30,
    });
    expect(producto.precioVenta).toBe('30');
  });

  it('no acepta más de dos decimales en el precio', () => {
    const resultado = esquemaProducto.safeParse({
      slug: 'a',
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

describe('esquemaNuevaVenta', () => {
  it('pone el descuento en cero si no viene', () => {
    const venta = esquemaNuevaVenta.parse({
      claveIdempotencia: CLAVE,
      canal: 'whatsapp',
      metodoPago: 'efectivo',
      lineas: [{ productoId: 1, cantidad: 2 }],
    });
    expect(venta.lineas[0]?.descuento).toBe('0');
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
