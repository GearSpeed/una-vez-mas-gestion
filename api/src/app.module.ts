import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AccesoModule } from './acceso/acceso.module.js';
import type { SolicitudConUsuario } from './acceso/decoradores.js';
import { CatalogoModule } from './catalogo/catalogo.module.js';
import { FiltroErrores } from './comun/filtro-errores.js';
import { ComprasModule } from './compras/compras.module.js';
import { ConfigModule } from './config/config.module.js';
import { ENTORNO, type Entorno } from './config/entorno.js';
import { DbModule } from './db/db.module.js';
import { ImagenesModule } from './imagenes/imagenes.module.js';
import { InventarioModule } from './inventario/inventario.module.js';
import { ProveedoresModule } from './proveedores/proveedores.module.js';
import { ReportesModule } from './reportes/reportes.module.js';
import { SaludModule } from './salud/salud.module.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';
import { VentasModule } from './ventas/ventas.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENTORNO],
      useFactory: (entorno: Entorno) => ({
        pinoHttp: {
          level: entorno.LOG_NIVEL,
          // Solo lo necesario: nunca la identidad firmada ni las cookies de Access.
          serializers: {
            req: (solicitud: { id: unknown; method: string; url: string }) => ({
              id: solicitud.id,
              method: solicitud.method,
              url: solicitud.url,
            }),
            res: (respuesta: { statusCode: number }) => ({ statusCode: respuesta.statusCode }),
          },
          customProps: (solicitud) => ({
            usuario: (solicitud as SolicitudConUsuario).usuario?.correo,
          }),
          transport:
            entorno.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          autoLogging: { ignore: (solicitud) => solicitud.url === '/api/salud' },
        },
      }),
    }),
    DbModule,
    ImagenesModule,
    AccesoModule,
    CatalogoModule,
    ProveedoresModule,
    InventarioModule,
    ComprasModule,
    VentasModule,
    ReportesModule,
    UsuariosModule,
    SaludModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: FiltroErrores }],
})
export class AppModule {}
