/**
 * Catálogo único de permisos.
 *
 * La API los exige ruta por ruta con `@Permiso()` y el front los usa para armar
 * el menú y proteger las rutas. Los roles son datos en la BD: cada uno es solo
 * un conjunto de estos permisos, así que agregar un rol no requiere código.
 */
export const PERMISOS = [
  'catalogo.ver',
  'productos.gestionar',
  'costos.ver',
  'proveedores.gestionar',
  'compras.ver',
  'compras.registrar',
  'compras.cancelar',
  'inventario.ver_todo',
  'traspasos.registrar',
  'ajustes.registrar',
  'ventas.registrar',
  'ventas.cualquier_ubicacion',
  'ventas.descontar',
  'ventas.ver_todas',
  'ventas.cancelar',
  'ventas.devolver',
  'gastos.ver',
  'gastos.registrar',
  'gastos.cancelar',
  'reportes.ver',
  'usuarios.gestionar',
] as const;

export type Permiso = (typeof PERMISOS)[number];

export const DESCRIPCION_PERMISOS: Readonly<Record<Permiso, string>> = {
  'catalogo.ver': 'Ver productos, precio y existencia',
  'productos.gestionar': 'Dar de alta productos, cambiar precios y publicarlos en el sitio',
  'costos.ver': 'Ver costo promedio, márgenes y utilidad',
  'proveedores.gestionar': 'Administrar proveedores y vehículos',
  'compras.ver': 'Ver las compras y sus costos',
  'compras.registrar': 'Registrar compras',
  'compras.cancelar': 'Cancelar compras',
  'inventario.ver_todo': 'Ver la existencia de todas las ubicaciones y el kardex',
  'traspasos.registrar': 'Cargar mercancía a un vendedor y recibir devoluciones',
  'ajustes.registrar': 'Registrar mermas, ajustes y conteos físicos',
  'ventas.registrar': 'Registrar ventas desde su ubicación',
  'ventas.cualquier_ubicacion': 'Registrar ventas desde cualquier ubicación',
  'ventas.descontar': 'Dar descuentos en una venta',
  'ventas.ver_todas': 'Ver las ventas de todos',
  'ventas.cancelar': 'Cancelar ventas',
  'ventas.devolver': 'Registrar devoluciones de sus ventas (o de todas, con ventas.ver_todas)',
  'gastos.ver': 'Ver los gastos de operación',
  'gastos.registrar': 'Registrar gastos de operación',
  'gastos.cancelar': 'Cancelar gastos',
  'reportes.ver': 'Ver el tablero y los reportes',
  'usuarios.gestionar': 'Administrar usuarios, roles y ubicaciones',
};

export interface DefinicionRol {
  readonly nombre: string;
  readonly descripcion: string;
  readonly permisos: readonly Permiso[];
}

/** Los roles con los que arranca la BD. La semilla los crea o los actualiza. */
export const ROLES_BASE = {
  admin: {
    nombre: 'Administrador',
    descripcion: 'Todo: precios, costos, usuarios, cancelaciones y reportes.',
    permisos: PERMISOS,
  },
  almacen: {
    nombre: 'Almacén',
    descripcion: 'Compras, existencias, traspasos a vendedores, ajustes y proveedores.',
    permisos: [
      'catalogo.ver',
      'proveedores.gestionar',
      'compras.ver',
      'compras.registrar',
      'inventario.ver_todo',
      'traspasos.registrar',
      'ajustes.registrar',
    ],
  },
  vendedor: {
    nombre: 'Vendedor',
    descripcion: 'Vende la mercancía que trae y ve sus propias ventas.',
    permisos: ['catalogo.ver', 'ventas.registrar', 'ventas.devolver'],
  },
  consulta: {
    nombre: 'Consulta',
    descripcion: 'Solo lectura: tablero, reportes, existencias y costos.',
    permisos: [
      'catalogo.ver',
      'costos.ver',
      'compras.ver',
      'inventario.ver_todo',
      'ventas.ver_todas',
      'gastos.ver',
      'reportes.ver',
    ],
  },
} as const satisfies Record<string, DefinicionRol>;

export type ClaveRol = keyof typeof ROLES_BASE;

/** El rol que da ubicación propia: al asignarlo se crea la del usuario. */
export const ROL_VENDEDOR: ClaveRol = 'vendedor';

export function esPermiso(valor: string): valor is Permiso {
  return (PERMISOS as readonly string[]).includes(valor);
}
