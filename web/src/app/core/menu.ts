import type { Permiso, Sesion } from '@uvm/compartido';

export interface EntradaMenu {
  readonly etiqueta: string;
  readonly ruta: string;
  readonly icono: string;
}

type Puede = (...permisos: Permiso[]) => boolean;

/** El menú de cada quien sale de sus permisos. */
export function menuPara(sesion: Sesion, puede: Puede): EntradaMenu[] {
  const vendedorSinInventario = !puede('inventario.ver_todo');
  const entradas: (EntradaMenu | false)[] = [
    { etiqueta: 'Inicio', ruta: '/', icono: 'home' },
    puede('ventas.registrar') && {
      etiqueta: 'Nueva venta',
      ruta: '/ventas/nueva',
      icono: 'point_of_sale',
    },
    puede('ventas.registrar', 'ventas.ver_todas') && {
      etiqueta: puede('ventas.ver_todas') ? 'Ventas' : 'Mis ventas',
      ruta: '/ventas',
      icono: 'receipt_long',
    },
    puede('ventas.registrar') &&
      !puede('reportes.ver') && { etiqueta: 'Mi corte', ruta: '/corte', icono: 'fact_check' },
    (puede('inventario.ver_todo') || sesion.ubicacion !== null) && {
      etiqueta: vendedorSinInventario ? 'Mi mercancía' : 'Existencias',
      ruta: '/inventario',
      icono: 'inventory_2',
    },
    puede('compras.ver') && { etiqueta: 'Compras', ruta: '/compras', icono: 'local_shipping' },
    puede('traspasos.registrar') && {
      etiqueta: 'Traspasos',
      ruta: '/inventario/traspasos',
      icono: 'swap_horiz',
    },
    puede('ajustes.registrar') && {
      etiqueta: 'Ajustes y conteo',
      ruta: '/inventario/ajustes',
      icono: 'rule',
    },
    puede('inventario.ver_todo') && {
      etiqueta: 'Kardex',
      ruta: '/inventario/kardex',
      icono: 'history',
    },
    puede('productos.gestionar', 'costos.ver') && {
      etiqueta: 'Productos y precios',
      ruta: '/productos',
      icono: 'sell',
    },
    puede('proveedores.gestionar') && {
      etiqueta: 'Proveedores',
      ruta: '/proveedores',
      icono: 'storefront',
    },
    puede('reportes.ver') && { etiqueta: 'Reportes', ruta: '/reportes', icono: 'monitoring' },
    puede('usuarios.gestionar') && { etiqueta: 'Usuarios', ruta: '/usuarios', icono: 'group' },
  ];
  return entradas.filter((entrada): entrada is EntradaMenu => entrada !== false);
}
