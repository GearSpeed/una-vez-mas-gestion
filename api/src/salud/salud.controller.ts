import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Publico } from '../acceso/decoradores.js';
import { type BaseDatos, DB } from '../db/conexion.js';

/** Para el healthcheck de Docker: responde sin identidad y confirma que la BD contesta. */
const VIGENCIA_MS = 5_000;

@Controller('salud')
export class SaludController {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  private revisadoEn = 0;
  private sana = false;

  @Get()
  @Publico()
  async salud(): Promise<{ ok: true }> {
    // La respuesta se recuerda unos segundos: es una ruta sin identidad y no debe
    // servir para golpear la base ni para saber desde fuera si está caída.
    if (Date.now() - this.revisadoEn > VIGENCIA_MS) {
      this.revisadoEn = Date.now();
      this.sana = await this.db
        .execute(sql`select 1`)
        .then(() => true)
        .catch(() => false);
    }
    if (!this.sana) throw new ServiceUnavailableException('No disponible.');
    return { ok: true };
  }
}
