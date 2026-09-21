import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  type DatosUbicacion,
  type DatosUsuario,
  esquemaUbicacion,
  esquemaUsuario,
  type Rol,
  type Ubicacion,
  type Usuario,
} from '@uvm/compartido';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { ParseId, Validar } from '../comun/validar.js';
import { UsuariosService } from './usuarios.service.js';

@Controller()
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get('usuarios')
  @RequierePermiso('usuarios.gestionar')
  listar(): Promise<Usuario[]> {
    return this.usuarios.listar();
  }

  @Post('usuarios')
  @RequierePermiso('usuarios.gestionar')
  crear(
    @UsuarioActual() admin: UsuarioSesion,
    @Body(new Validar(esquemaUsuario)) datos: DatosUsuario,
  ): Promise<Usuario> {
    return this.usuarios.crear(admin, datos);
  }

  @Put('usuarios/:id')
  @RequierePermiso('usuarios.gestionar')
  actualizar(
    @UsuarioActual() admin: UsuarioSesion,
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaUsuario)) datos: DatosUsuario,
  ): Promise<Usuario> {
    return this.usuarios.actualizar(admin, id, datos);
  }

  @Get('roles')
  @RequierePermiso('usuarios.gestionar')
  roles(): Promise<Rol[]> {
    return this.usuarios.roles();
  }

  /** Para elegir origen y destino de un traspaso, o dónde se vende o se cuenta. */
  @Get('ubicaciones')
  @RequierePermiso(
    'usuarios.gestionar',
    'inventario.ver_todo',
    'traspasos.registrar',
    'ajustes.registrar',
    'ventas.cualquier_ubicacion',
    'reportes.ver',
  )
  ubicaciones(): Promise<Ubicacion[]> {
    return this.usuarios.ubicaciones();
  }

  @Post('ubicaciones')
  @RequierePermiso('usuarios.gestionar')
  crearAlmacen(@Body(new Validar(esquemaUbicacion)) datos: DatosUbicacion): Promise<Ubicacion> {
    return this.usuarios.crearAlmacen(datos);
  }

  @Put('ubicaciones/:id')
  @RequierePermiso('usuarios.gestionar')
  actualizarUbicacion(
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaUbicacion)) datos: DatosUbicacion,
  ): Promise<Ubicacion> {
    return this.usuarios.actualizarUbicacion(id, datos);
  }
}
