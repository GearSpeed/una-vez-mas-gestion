import type { Permiso, Sesion } from '@uvm/compartido';
import { menuPara } from './menu';

function sesion(permisos: Permiso[], conUbicacion = false): Sesion {
  return {
    id: 1,
    correo: 'x@demo.local',
    nombre: 'X',
    roles: [],
    permisos,
    ubicacion: conUbicacion ? { id: 2, nombre: 'Ana', tipo: 'vendedor' } : null,
    modoDesarrollo: false,
  };
}

function etiquetas(s: Sesion): string[] {
  return menuPara(s, (...p) => p.some((permiso) => s.permisos.includes(permiso))).map(
    (e) => e.etiqueta,
  );
}

describe('menuPara', () => {
  it('a la vendedora le da lo suyo y nada más', () => {
    expect(etiquetas(sesion(['catalogo.ver', 'ventas.registrar'], true))).toEqual([
      'Inicio',
      'Nueva venta',
      'Mis ventas',
      'Mi corte',
      'Mi mercancía',
    ]);
  });

  it('al almacén no le muestra ventas ni usuarios', () => {
    const menu = etiquetas(
      sesion([
        'catalogo.ver',
        'proveedores.gestionar',
        'compras.ver',
        'compras.registrar',
        'inventario.ver_todo',
        'traspasos.registrar',
        'ajustes.registrar',
      ]),
    );
    expect(menu).toEqual([
      'Inicio',
      'Existencias',
      'Compras',
      'Traspasos',
      'Ajustes y conteo',
      'Kardex',
      'Proveedores',
    ]);
  });

  it('con ventas.ver_todas la lista se llama Ventas y no hay "Mi corte" si ve reportes', () => {
    const menu = etiquetas(sesion(['ventas.registrar', 'ventas.ver_todas', 'reportes.ver']));
    expect(menu).toContain('Ventas');
    expect(menu).not.toContain('Mis ventas');
    expect(menu).not.toContain('Mi corte');
    expect(menu).toContain('Reportes');
  });
});
