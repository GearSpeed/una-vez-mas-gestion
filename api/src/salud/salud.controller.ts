import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Publico } from '../acceso/decoradores.js';
import { type BaseDatos, DB } from '../db/conexion.js';

/** Para el healthcheck de Docker: responde sin identidad y confirma que la BD contesta. */
@Controller('salud')
export class SaludController {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  @Get()
  @Publico()
  async salud(): Promise<{ ok: true }> {
    try {
      await this.db.execute(sql`select 1`);
      return { ok: true };
    } catch {
      throw new ServiceUnavailableException('La base de datos no responde.');
    }
  }
}
