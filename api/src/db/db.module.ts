import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ENTORNO, type Entorno } from '../config/entorno.js';
import { crearBaseDatos, DB, type BaseDatos } from './conexion.js';

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENTORNO],
      useFactory: (entorno: Entorno) => crearBaseDatos(entorno.DATABASE_URL),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}
