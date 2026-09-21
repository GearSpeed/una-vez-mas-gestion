import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type DatosUbicacion,
  type DatosUsuario,
  esPermiso,
  ROL_VENDEDOR,
  type Rol,
  type Ubicacion,
  type Usuario,
} from '@uvm/compartido';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { type BaseDatos, DB, type Transaccion } from '../db/conexion.js';
import {
  existencias,
  rolPermisos,
  roles,
  ubicaciones,
  usuarioRoles,
  usuarios,
} from '../db/esquema.js';
import { asegurarUbicacionDeVendedor } from './ubicacion-vendedor.js';

const ROL_ADMIN = 'admin';

/** Piezas que hay en una ubicación, de todos los productos. */
const piezasEn = (ubicacionId: unknown) =>
  sql<number>`coalesce((select sum(e.cantidad) from ${existencias} e where e.ubicacion_id = ${ubicacionId}), 0)::int`;

/**
 * Usuarios, sus roles y las ubicaciones. Dos reglas protegen la operación:
 * siempre queda al menos un administrador activo, y no se desactiva a nadie
 * (ni una ubicación) mientras tenga mercancía a su cargo.
 */
@Injectable()
export class UsuariosService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async listar(): Promise<Usuario[]> {
    const filas = await this.db
      .select({
        id: usuarios.id,
        correo: usuarios.correo,
        nombre: usuarios.nombre,
        activo: usuarios.activo,
        ultimoAcceso: usuarios.ultimoAcceso,
        ubicacionId: ubicaciones.id,
        ubicacionNombre: ubicaciones.nombre,
        ubicacionTipo: ubicaciones.tipo,
        roles: sql<
          string[]
        >`coalesce((select array_agg(r.clave order by r.clave) from ${usuarioRoles} ur
          join ${roles} r on r.id = ur.rol_id where ur.usuario_id = ${usuarios.id}), '{}')`,
      })
      .from(usuarios)
      .leftJoin(
        ubicaciones,
        and(eq(ubicaciones.usuarioId, usuarios.id), eq(ubicaciones.activa, true)),
      )
      .orderBy(asc(usuarios.nombre));

    return filas.map((fila) => ({
      id: fila.id,
      correo: fila.correo,
      nombre: fila.nombre,
      activo: fila.activo,
      roles: fila.roles,
      ubicacion:
        fila.ubicacionId !== null && fila.ubicacionNombre !== null && fila.ubicacionTipo !== null
          ? { id: fila.ubicacionId, nombre: fila.ubicacionNombre, tipo: fila.ubicacionTipo }
          : null,
      ultimoAcceso: fila.ultimoAcceso?.toISOString() ?? null,
    }));
  }

  async crear(admin: UsuarioSesion, datos: DatosUsuario): Promise<Usuario> {
    const id = await this.db.transaction(async (tx) => {
      const [creado] = await tx
        .insert(usuarios)
        .values({ correo: datos.correo, nombre: datos.nombre, activo: datos.activo })
        .returning({ id: usuarios.id });
      if (!creado) throw new Error('No se creó el usuario');
      await this.asignarRoles(tx, creado.id, datos.roles);
      await registrarEnBitacora(tx, {
        usuarioId: admin.id,
        accion: 'crear',
        entidad: 'usuario',
        entidadId: creado.id,
        datos: { correo: datos.correo, roles: datos.roles, activo: datos.activo },
      });
      return creado.id;
    });
    return this.obtener(id);
  }

  async actualizar(admin: UsuarioSesion, id: number, datos: DatosUsuario): Promise<Usuario> {
    await this.db.transaction(async (tx) => {
      const [actual] = await tx.select().from(usuarios).where(eq(usuarios.id, id)).for('update');
      if (!actual) throw new NotFoundException('El usuario no existe.');

      const seQuedaSinAdmin = !datos.activo || !datos.roles.includes(ROL_ADMIN);
      if (
        seQuedaSinAdmin &&
        (await this.esAdmin(tx, id)) &&
        (await this.otrosAdminsActivos(tx, id)) === 0
      ) {
        throw new ConflictException('Debe quedar al menos un administrador activo.');
      }

      const [ubicacion] = await tx
        .select({
          id: ubicaciones.id,
          nombre: ubicaciones.nombre,
          piezas: piezasEn(ubicaciones.id),
        })
        .from(ubicaciones)
        .where(and(eq(ubicaciones.usuarioId, id), eq(ubicaciones.activa, true)));
      if (!datos.activo && ubicacion) {
        if (ubicacion.piezas > 0) {
          throw new ConflictException(
            `${actual.nombre} todavía trae ${ubicacion.piezas} piezas. Recíbelas en el almacén antes de desactivarlo.`,
          );
        }
        await tx.update(ubicaciones).set({ activa: false }).where(eq(ubicaciones.id, ubicacion.id));
      }

      await tx
        .update(usuarios)
        .set({ correo: datos.correo, nombre: datos.nombre, activo: datos.activo })
        .where(eq(usuarios.id, id));
      await tx.delete(usuarioRoles).where(eq(usuarioRoles.usuarioId, id));
      await this.asignarRoles(tx, id, datos.roles, datos.activo);
      await registrarEnBitacora(tx, {
        usuarioId: admin.id,
        accion: 'actualizar',
        entidad: 'usuario',
        entidadId: id,
        datos: { correo: datos.correo, roles: datos.roles, activo: datos.activo },
      });
    });
    return this.obtener(id);
  }

  async roles(): Promise<Rol[]> {
    const filas = await this.db
      .select({
        id: roles.id,
        clave: roles.clave,
        nombre: roles.nombre,
        descripcion: roles.descripcion,
        permisos: sql<string[]>`coalesce((select array_agg(rp.permiso order by rp.permiso)
          from ${rolPermisos} rp where rp.rol_id = ${roles.id}), '{}')`,
      })
      .from(roles)
      .orderBy(asc(roles.id));
    return filas.map((fila) => ({ ...fila, permisos: fila.permisos.filter(esPermiso) }));
  }

  /* ---- ubicaciones ---- */

  async ubicaciones(): Promise<Ubicacion[]> {
    return this.db
      .select({
        id: ubicaciones.id,
        nombre: ubicaciones.nombre,
        tipo: ubicaciones.tipo,
        activa: ubicaciones.activa,
        usuarioId: ubicaciones.usuarioId,
        usuarioNombre: usuarios.nombre,
        piezas: piezasEn(ubicaciones.id),
      })
      .from(ubicaciones)
      .leftJoin(usuarios, eq(usuarios.id, ubicaciones.usuarioId))
      .orderBy(asc(ubicaciones.tipo), asc(ubicaciones.nombre));
  }

  /** Solo se crean almacenes: la ubicación de un vendedor nace con su rol. */
  async crearAlmacen(datos: DatosUbicacion): Promise<Ubicacion> {
    const [creada] = await this.db
      .insert(ubicaciones)
      .values({ nombre: datos.nombre, tipo: 'almacen', activa: datos.activa })
      .returning({ id: ubicaciones.id });
    if (!creada) throw new Error('No se creó la ubicación');
    return this.ubicacion(creada.id);
  }

  async actualizarUbicacion(id: number, datos: DatosUbicacion): Promise<Ubicacion> {
    const actual = await this.ubicacion(id);
    if (!datos.activa && actual.activa && actual.piezas > 0) {
      throw new ConflictException(
        `${actual.nombre} todavía tiene ${actual.piezas} piezas. Muévelas antes de desactivarla.`,
      );
    }
    await this.db
      .update(ubicaciones)
      .set({ nombre: datos.nombre, activa: datos.activa })
      .where(eq(ubicaciones.id, id));
    return this.ubicacion(id);
  }

  /* ---- internos ---- */

  private async obtener(id: number): Promise<Usuario> {
    const usuario = (await this.listar()).find((u) => u.id === id);
    if (!usuario) throw new NotFoundException('El usuario no existe.');
    return usuario;
  }

  private async ubicacion(id: number): Promise<Ubicacion> {
    const encontrada = (await this.ubicaciones()).find((u) => u.id === id);
    if (!encontrada) throw new NotFoundException('La ubicación no existe.');
    return encontrada;
  }

  private async asignarRoles(
    tx: Transaccion,
    usuarioId: number,
    claves: readonly string[],
    activo = true,
  ) {
    const filas = await tx
      .select({ id: roles.id, clave: roles.clave })
      .from(roles)
      .where(inArray(roles.clave, [...claves]));
    const desconocidos = claves.filter((clave) => !filas.some((f) => f.clave === clave));
    if (desconocidos.length > 0) {
      throw new UnprocessableEntityException({
        mensaje: `No existe el rol ${desconocidos.join(', ')}.`,
        campos: { roles: 'Elige roles de la lista' },
      });
    }
    await tx.insert(usuarioRoles).values(filas.map((rol) => ({ usuarioId, rolId: rol.id })));
    // El vendedor necesita dónde cargar su mercancía.
    if (activo && claves.includes(ROL_VENDEDOR)) await asegurarUbicacionDeVendedor(tx, usuarioId);
  }

  private async esAdmin(tx: Transaccion, usuarioId: number): Promise<boolean> {
    const [fila] = await tx
      .select({ id: usuarioRoles.usuarioId })
      .from(usuarioRoles)
      .innerJoin(roles, eq(roles.id, usuarioRoles.rolId))
      .where(and(eq(usuarioRoles.usuarioId, usuarioId), eq(roles.clave, ROL_ADMIN)));
    return fila !== undefined;
  }

  private async otrosAdminsActivos(tx: Transaccion, usuarioId: number): Promise<number> {
    const [fila] = await tx
      .select({ total: sql<number>`count(distinct ${usuarios.id})::int` })
      .from(usuarios)
      .innerJoin(usuarioRoles, eq(usuarioRoles.usuarioId, usuarios.id))
      .innerJoin(roles, eq(roles.id, usuarioRoles.rolId))
      .where(
        and(eq(roles.clave, ROL_ADMIN), eq(usuarios.activo, true), ne(usuarios.id, usuarioId)),
      );
    return fila?.total ?? 0;
  }
}
