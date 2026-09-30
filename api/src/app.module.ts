import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AccesoModule } from './acceso/acceso.module.js';
import type { SolicitudConUsuario } from './acceso/decoradores.js';
import { CatalogoModule } from './catalogo/catalogo.module.js';
import { FiltroErrores } from './comun/filtro-errores.js';
import { LimitePeticionesGuard } from './comun/limite-peticiones.js';
import { ComprasModule } from './compras/compras.module.js';
import { ConfigModule } from './config/config.module.js';
import { ENTORNO, type Entorno } from './config/entorno.js';
import { CapitalModule } from './capital/capital.module.js';
import { GastosModule } from './gastos/gastos.module.js';
import { DbModule } from './db/db.module.js';
import { ImagenesModule } from './imagenes/imagenes.module.js';
import { InventarioModule } from './inventario/inventario.module.js';
import { ProveedoresModule } from './proveedores/proveedores.module.js';
import { PublicoModule } from './publico/publico.module.js';
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
          // El id y no el correo: el log no tiene por qué guardar datos personales.
          customProps: (solicitud) => ({
            usuario: (solicitud as SolicitudConUsuario).usuario?.id,
          }),
          transport:
            entorno.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          autoLogging: { ignore: (solicitud) => solicitud.url === '/api/salud' },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENTORNO],
      useFactory: (entorno: Entorno) => ({
        throttlers: [{ ttl: 60_000, limit: entorno.LIMITE_PETICIONES }],
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
    CapitalModule,
    GastosModule,
    ReportesModule,
    UsuariosModule,
    SaludModule,
    PublicoModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: FiltroErrores },
    { provide: APP_GUARD, useClass: LimitePeticionesGuard },
  ],
})
export class AppModule {}
