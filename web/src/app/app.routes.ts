import type { Routes } from '@angular/router';
import { conSesion, requierePermiso } from './core/guardias';
import { Shell } from './layout/shell';

/** Cada pantalla se carga cuando se usa y pide su permiso (la API lo vuelve a revisar). */
export const routes: Routes = [
  {
    path: 'sin-acceso',
    title: 'Sin acceso',
    loadComponent: () => import('./funciones/estados/sin-acceso').then((m) => m.SinAcceso),
  },
  {
    path: '',
    component: Shell,
    canMatch: [conSesion],
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Inicio',
        loadComponent: () => import('./funciones/inicio/inicio').then((m) => m.Inicio),
      },
      {
        path: 'ventas/nueva',
        title: 'Nueva venta',
        canMatch: [requierePermiso('ventas.registrar')],
        loadComponent: () => import('./funciones/ventas/nueva-venta').then((m) => m.NuevaVenta),
      },
      {
        path: 'ventas',
        title: 'Ventas',
        canMatch: [requierePermiso('ventas.registrar', 'ventas.ver_todas')],
        loadComponent: () => import('./funciones/ventas/lista-ventas').then((m) => m.ListaVentas),
      },
      {
        path: 'ventas/:id',
        title: 'Venta',
        canMatch: [requierePermiso('ventas.registrar', 'ventas.ver_todas')],
        loadComponent: () => import('./funciones/ventas/detalle-venta').then((m) => m.DetalleVenta),
      },
      {
        path: 'corte',
        title: 'Corte',
        canMatch: [requierePermiso('ventas.registrar', 'reportes.ver')],
        loadComponent: () => import('./funciones/reportes/corte').then((m) => m.CorteVendedor),
      },
      {
        path: 'compras/nueva',
        title: 'Nueva compra',
        canMatch: [requierePermiso('compras.registrar')],
        loadComponent: () => import('./funciones/compras/nueva-compra').then((m) => m.NuevaCompra),
      },
      {
        path: 'compras',
        title: 'Compras',
        canMatch: [requierePermiso('compras.ver')],
        loadComponent: () =>
          import('./funciones/compras/lista-compras').then((m) => m.ListaCompras),
      },
      {
        path: 'compras/:id',
        title: 'Compra',
        canMatch: [requierePermiso('compras.ver')],
        loadComponent: () =>
          import('./funciones/compras/detalle-compra').then((m) => m.DetalleCompra),
      },
      {
        path: 'inventario',
        title: 'Existencias',
        loadComponent: () =>
          import('./funciones/inventario/existencias').then((m) => m.Existencias),
      },
      {
        path: 'inventario/traspasos',
        title: 'Traspasos',
        canMatch: [requierePermiso('traspasos.registrar')],
        loadComponent: () => import('./funciones/inventario/traspasos').then((m) => m.Traspasos),
      },
      {
        path: 'inventario/ajustes',
        title: 'Ajustes y conteo',
        canMatch: [requierePermiso('ajustes.registrar')],
        loadComponent: () => import('./funciones/inventario/ajustes').then((m) => m.Ajustes),
      },
      {
        path: 'inventario/kardex',
        title: 'Kardex',
        canMatch: [requierePermiso('inventario.ver_todo')],
        loadComponent: () => import('./funciones/inventario/kardex').then((m) => m.Kardex),
      },
      {
        path: 'productos',
        title: 'Productos y precios',
        canMatch: [requierePermiso('productos.gestionar', 'costos.ver')],
        loadComponent: () => import('./funciones/catalogo/productos').then((m) => m.Productos),
      },
      {
        path: 'proveedores',
        title: 'Proveedores y vehículos',
        canMatch: [requierePermiso('proveedores.gestionar')],
        loadComponent: () =>
          import('./funciones/proveedores/proveedores').then((m) => m.Proveedores),
      },
      {
        path: 'gastos',
        title: 'Gastos',
        canMatch: [requierePermiso('gastos.ver')],
        loadComponent: () => import('./funciones/gastos/gastos').then((m) => m.Gastos),
      },
      {
        path: 'capital',
        title: 'Capital',
        canMatch: [requierePermiso('capital.ver')],
        loadComponent: () => import('./funciones/capital/capital').then((m) => m.Capital),
      },
      {
        path: 'reportes',
        title: 'Reportes',
        canMatch: [requierePermiso('reportes.ver')],
        loadComponent: () => import('./funciones/reportes/reportes').then((m) => m.Reportes),
      },
      {
        path: 'usuarios',
        title: 'Usuarios',
        canMatch: [requierePermiso('usuarios.gestionar')],
        loadComponent: () => import('./funciones/usuarios/usuarios').then((m) => m.Usuarios),
      },
      {
        path: 'sin-permiso',
        title: 'Sin permiso',
        loadComponent: () => import('./funciones/estados/sin-permiso').then((m) => m.SinPermiso),
      },
      {
        path: '**',
        title: 'No encontrada',
        loadComponent: () =>
          import('./funciones/estados/no-encontrada').then((m) => m.NoEncontrada),
      },
    ],
  },
  { path: '**', redirectTo: 'sin-acceso' },
];
