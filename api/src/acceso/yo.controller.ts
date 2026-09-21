import { Controller, Get } from '@nestjs/common';
import type { Sesion } from '@uvm/compartido';
import { Autenticado, UsuarioActual } from './decoradores.js';
import { IdentidadService } from './identidad.service.js';
import { SesionesService } from './sesiones.service.js';
import { UsuarioSesion } from './usuario-sesion.js';

@Controller('yo')
export class YoController {
  constructor(
    private readonly sesiones: SesionesService,
    private readonly identidad: IdentidadService,
  ) {}

  /** Lo primero que pide el front: con esto arma el menú y protege sus rutas. */
  @Get()
  @Autenticado()
  async yo(@UsuarioActual() usuario: UsuarioSesion): Promise<Sesion> {
    await this.sesiones.registrarAcceso(usuario.id);
    return {
      id: usuario.id,
      correo: usuario.correo,
      nombre: usuario.nombre,
      roles: usuario.roles,
      permisos: usuario.listaPermisos,
      ubicacion: usuario.ubicacion,
      modoDesarrollo: this.identidad.modoDesarrollo,
    };
  }
}
