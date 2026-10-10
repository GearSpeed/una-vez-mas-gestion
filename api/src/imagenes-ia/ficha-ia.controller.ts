import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type DatosFichaIa, esquemaFichaIa, type FichaSugerida } from '@uvm/compartido';
import { RequierePermiso } from '../acceso/decoradores.js';
import { LIMITE_IMAGENES_IA } from '../comun/limite-peticiones.js';
import { ParseId, Validar } from '../comun/validar.js';
import { FichaIaService } from './ficha-ia.service.js';

@Controller('productos')
export class FichaIaController {
  constructor(private readonly fichas: FichaIaService) {}

  /**
   * La IA redacta la ficha del sitio (resumen, descripción, ingredientes y textos de
   * portada) con la foto guardada del producto y los datos del formulario. No guarda
   * nada. Gasta créditos de OpenAI: mismo tope que las imágenes.
   */
  @Post(':id/ficha-ia')
  @RequierePermiso('productos.gestionar')
  @HttpCode(200)
  @Throttle(LIMITE_IMAGENES_IA)
  redactar(
    @Param('id', ParseId) id: number,
    @Body(new Validar(esquemaFichaIa)) datos: DatosFichaIa,
  ): Promise<FichaSugerida> {
    return this.fichas.redactar(id, datos);
  }
}
