import { Inject, Injectable } from '@nestjs/common';
import { esPermiso, type Permiso } from '@uvm/compartido';
import { and, eq } from 'drizzle-orm';
import { type BaseDatos, DB } from '../db/conexion.js';
import { rolPermisos, roles, ubicaciones, usuarioRoles, usuarios } from '../db/esquema.js';
import { UsuarioSesion } from './usuario-sesion.js';

@Injectable()
export class SesionesService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  /** El usuario activo con ese correo, con sus roles, permisos y ubicación. */
  async cargar(correo: string): Promise<UsuarioSesion | null> {
    const [usuario] = await this.db
      .select({ id: usuarios.id, correo: usuarios.correo, nombre: usuarios.nombre })
      .from(usuarios)
      .where(and(eq(usuarios.correo, correo), eq(usuarios.activo, true)));
    if (!usuario) return null;

    const [filasRol, filasPermiso, [ubicacion]] = await Promise.all([
      this.db
        .select({ clave: roles.clave, nombre: roles.nombre })
        .from(usuarioRoles)
        .innerJoin(roles, eq(roles.id, usuarioRoles.rolId))
        .where(eq(usuarioRoles.usuarioId, usuario.id))
        .orderBy(roles.nombre),
      this.db
        .selectDistinct({ permiso: rolPermisos.permiso })
        .from(usuarioRoles)
        .innerJoin(rolPermisos, eq(rolPermisos.rolId, usuarioRoles.rolId))
        .where(eq(usuarioRoles.usuarioId, usuario.id)),
      this.db
        .select({ id: ubicaciones.id, nombre: ubicaciones.nombre, tipo: ubicaciones.tipo })
        .from(ubicaciones)
        .where(and(eq(ubicaciones.usuarioId, usuario.id), eq(ubicaciones.activa, true))),
    ]);

    const permisos = new Set<Permiso>(filasPermiso.map((f) => f.permiso).filter(esPermiso));
    return new UsuarioSesion(
      usuario.id,
      usuario.correo,
      usuario.nombre,
      filasRol,
      permisos,
      ubicacion ?? null,
    );
  }

  async registrarAcceso(usuarioId: number): Promise<void> {
    await this.db
      .update(usuarios)
      .set({ ultimoAcceso: new Date() })
      .where(eq(usuarios.id, usuarioId));
  }
}
