/**
 * Datos con los que arranca la BD. Se puede correr las veces que sea: crea lo
 * que falte y no pisa lo que el administrador ya editó (salvo los roles, que
 * siempre quedan como dice `ROLES_BASE`).
 *
 * No lleva costos, precios ni proveedores reales: son datos sensibles y no deben
 * quedar en el repo. Esos se capturan en la app.
 */
import { eq, inArray } from 'drizzle-orm';
import { ROL_VENDEDOR, ROLES_BASE, type ClaveRol } from '@uvm/compartido';
import { asegurarUbicacionDeVendedor } from '../usuarios/ubicacion-vendedor.js';
import type { BaseDatos, Transaccion } from './conexion.js';
import {
  categorias,
  productos,
  proveedores,
  rolPermisos,
  roles,
  ubicaciones,
  usuarioRoles,
  usuarios,
  vehiculos,
} from './esquema.js';

const CATEGORIAS = [
  { nombre: 'Galletas', orden: 1 },
  { nombre: 'Borrachitos', orden: 2 },
  { nombre: 'Alegrías', orden: 3 },
] as const;

type NombreCategoria = (typeof CATEGORIAS)[number]['nombre'];

interface ProductoSemilla {
  readonly slug: string;
  readonly nombre: string;
  readonly categoria: NombreCategoria;
  readonly variedad: string;
  readonly presentacion: string | null;
  /** Los 9 del sitio sí; las 4 galletas nuevas, hasta que el sitio las tenga. */
  readonly publicado: boolean;
}

/**
 * Los 13 productos del Excel. Los 9 que ya están en el sitio usan el slug y el
 * nombre de `products.json`, para no romper sus URLs.
 */
export const PRODUCTOS_SEMILLA: readonly ProductoSemilla[] = [
  {
    slug: 'galletas-avena',
    nombre: 'Galletas de Avena',
    categoria: 'Galletas',
    variedad: 'Avena',
    presentacion: '6 pzas',
    publicado: true,
  },
  {
    // En el sitio aparece como `galletas-chocolate`, pero el producto real es de chispas:
    // `products.json` del sitio debe cambiar a este slug.
    slug: 'galletas-chispas-chocolate',
    nombre: 'Galletas de Chispas de Chocolate',
    categoria: 'Galletas',
    variedad: 'Chispas de chocolate',
    presentacion: '6 pzas',
    publicado: true,
  },
  {
    slug: 'galletas-coco',
    nombre: 'Galletas de Coco',
    categoria: 'Galletas',
    variedad: 'Coco',
    presentacion: '6 pzas',
    publicado: true,
  },
  {
    slug: 'galletas-nuez',
    nombre: 'Galletas de Nuez',
    categoria: 'Galletas',
    variedad: 'Nuez',
    presentacion: '6 pzas',
    publicado: true,
  },
  {
    slug: 'borrachitos-tequila',
    nombre: 'Borrachitos de Tequila',
    categoria: 'Borrachitos',
    variedad: 'Tequila',
    presentacion: null,
    publicado: true,
  },
  {
    slug: 'borrachitos-ron',
    nombre: 'Borrachitos de Ron',
    categoria: 'Borrachitos',
    variedad: 'Ron',
    presentacion: null,
    publicado: true,
  },
  {
    slug: 'borrachitos-baileys',
    nombre: 'Borrachitos de Baileys',
    categoria: 'Borrachitos',
    variedad: 'Baileys',
    presentacion: null,
    publicado: true,
  },
  {
    slug: 'borrachitos-clasicos',
    nombre: 'Borrachitos Clásicos',
    categoria: 'Borrachitos',
    variedad: 'Clásicos',
    presentacion: null,
    publicado: true,
  },
  {
    slug: 'alegrias-tradicionales',
    nombre: 'Alegrías de Amaranto Tradicionales',
    categoria: 'Alegrías',
    variedad: 'Tradicionales',
    presentacion: null,
    publicado: true,
  },
  {
    slug: 'galletas-mermelada-tejocote',
    nombre: 'Galletas de Mermelada de Tejocote',
    categoria: 'Galletas',
    variedad: 'Mermelada de tejocote',
    presentacion: '6 pzas',
    publicado: false,
  },
  {
    slug: 'galletas-granola',
    nombre: 'Galletas de Granola',
    categoria: 'Galletas',
    variedad: 'Granola',
    presentacion: '6 pzas',
    publicado: false,
  },
  {
    slug: 'galletas-mermelada-pina',
    nombre: 'Galletas de Mermelada de Piña',
    categoria: 'Galletas',
    variedad: 'Mermelada de piña',
    presentacion: '6 pzas',
    publicado: false,
  },
  {
    slug: 'galletas-canela',
    nombre: 'Galletas de Canela',
    categoria: 'Galletas',
    variedad: 'Canela',
    presentacion: '6 pzas',
    publicado: false,
  },
];

export const NOMBRE_ALMACEN = 'Almacén';

/** Usuarios de prueba (solo con `--demo`): uno por rol, para probar permisos en desarrollo. */
export const USUARIOS_DEMO = [
  { correo: 'almacen@demo.local', nombre: 'Almacén Demo', roles: ['almacen'] },
  { correo: 'ana@demo.local', nombre: 'Ana', roles: ['vendedor'] },
  { correo: 'beto@demo.local', nombre: 'Beto', roles: ['vendedor'] },
  { correo: 'consulta@demo.local', nombre: 'Consulta Demo', roles: ['consulta'] },
] as const satisfies readonly { correo: string; nombre: string; roles: readonly ClaveRol[] }[];

export interface OpcionesSemilla {
  readonly admin?: { readonly correo: string; readonly nombre: string };
  /** Agrega usuarios, un proveedor y un vehículo de prueba. Nunca en producción. */
  readonly demo?: boolean;
}

export async function sembrar(db: BaseDatos, opciones: OpcionesSemilla = {}): Promise<void> {
  await db.transaction(async (tx) => {
    await sembrarRoles(tx);

    await tx
      .insert(categorias)
      .values([...CATEGORIAS])
      .onConflictDoNothing({ target: categorias.nombre });
    const filasCategoria = await tx
      .select({ id: categorias.id, nombre: categorias.nombre })
      .from(categorias);
    const idCategoria = new Map(filasCategoria.map((c) => [c.nombre, c.id]));

    await tx
      .insert(productos)
      .values(
        PRODUCTOS_SEMILLA.map(({ categoria, ...producto }) => ({
          ...producto,
          categoriaId: idCategoria.get(categoria) ?? 0,
        })),
      )
      .onConflictDoNothing({ target: productos.slug });

    const [almacen] = await tx
      .select({ id: ubicaciones.id })
      .from(ubicaciones)
      .where(eq(ubicaciones.tipo, 'almacen'))
      .limit(1);
    if (!almacen) await tx.insert(ubicaciones).values({ nombre: NOMBRE_ALMACEN, tipo: 'almacen' });

    if (opciones.admin) {
      await asegurarUsuario(tx, opciones.admin.correo, opciones.admin.nombre, ['admin']);
    }

    if (opciones.demo) {
      for (const usuario of USUARIOS_DEMO) {
        await asegurarUsuario(tx, usuario.correo, usuario.nombre, usuario.roles);
      }
      await tx
        .insert(proveedores)
        .values({
          nombre: 'Proveedor demo',
          distanciaKm: '40',
          categoriasQueSurte: 'Productos de amaranto',
        })
        .onConflictDoNothing({ target: proveedores.nombre });
      await tx
        .insert(vehiculos)
        .values({ nombre: 'Moto demo', rendimientoKmL: '32' })
        .onConflictDoNothing({ target: vehiculos.nombre });
    }
  });
}

/** Los roles quedan exactamente como dice `ROLES_BASE`, con sus permisos. */
async function sembrarRoles(tx: Transaccion): Promise<void> {
  for (const [clave, rol] of Object.entries(ROLES_BASE)) {
    const [fila] = await tx
      .insert(roles)
      .values({ clave, nombre: rol.nombre, descripcion: rol.descripcion })
      .onConflictDoUpdate({
        target: roles.clave,
        set: { nombre: rol.nombre, descripcion: rol.descripcion },
      })
      .returning({ id: roles.id });
    if (!fila) throw new Error(`No se pudo sembrar el rol ${clave}`);
    await tx.delete(rolPermisos).where(eq(rolPermisos.rolId, fila.id));
    await tx
      .insert(rolPermisos)
      .values(rol.permisos.map((permiso) => ({ rolId: fila.id, permiso })));
  }
}

async function asegurarUsuario(
  tx: Transaccion,
  correo: string,
  nombre: string,
  claves: readonly ClaveRol[],
): Promise<void> {
  const correoNormal = correo.trim().toLowerCase();
  await tx
    .insert(usuarios)
    .values({ correo: correoNormal, nombre })
    .onConflictDoNothing({ target: usuarios.correo });
  const [usuario] = await tx
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.correo, correoNormal));
  if (!usuario) throw new Error(`No se pudo crear el usuario ${correoNormal}`);

  const filasRol = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.clave, [...claves]));
  await tx
    .insert(usuarioRoles)
    .values(filasRol.map((rol) => ({ usuarioId: usuario.id, rolId: rol.id })))
    .onConflictDoNothing();

  if (claves.includes(ROL_VENDEDOR)) await asegurarUbicacionDeVendedor(tx, usuario.id);
}
