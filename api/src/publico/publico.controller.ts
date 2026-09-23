import { Controller, Get, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LIMITE_PUBLICO } from '../comun/limite-peticiones.js';
import type { ProductoPublico } from '@uvm/compartido';
import { Publico } from '../acceso/decoradores.js';
import { CatalogoPublicoService } from './catalogo-publico.service.js';

/**
 * Lo que el back del sitio lee, sin identidad. Se cachea en el borde de Cloudflare,
 * así que el origen casi no se toca, y lleva su propio límite de peticiones.
 */
@Controller('publico')
export class PublicoController {
  constructor(private readonly catalogo: CatalogoPublicoService) {}

  @Get('catalogo')
  @Publico()
  @Throttle(LIMITE_PUBLICO)
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600')
  listar(): Promise<ProductoPublico[]> {
    return this.catalogo.catalogo();
  }
}
