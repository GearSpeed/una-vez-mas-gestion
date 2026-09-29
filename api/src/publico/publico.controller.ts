import { Controller, Get, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LIMITE_PUBLICO } from '../comun/limite-peticiones.js';
import type { CatalogoPublico } from '@uvm/compartido';
import { Publico } from '../acceso/decoradores.js';
import { CatalogoPublicoService } from './catalogo-publico.service.js';

/**
 * Lo que el sitio lee, sin identidad. Se cachea en el borde de Cloudflare, así que el
 * origen casi no se toca, y lleva su propio límite de peticiones.
 *
 * Es la única ruta con CORS, porque el navegador del sitio (otro dominio) la lee
 * directo. Va `*` y no la lista de dominios del sitio por dos razones:
 *
 * 1. Cloudflare cachea esta respuesta y no varía la caché por `Origin`. Una cabecera que
 *    cambiara según quién pregunta se quedaría pegada con el valor del primero, y el
 *    sitio se rompería a ratos sin explicación.
 * 2. `*` le prohíbe al navegador mandar cookies, que es justo lo que se quiere: aquí no
 *    hay identidad y no debe haberla.
 *
 * El resto de la API no le da permiso a nadie (ver `comun/origen.ts`) y además exige el
 * JWT de Access.
 */
@Controller('publico')
export class PublicoController {
  constructor(private readonly catalogo: CatalogoPublicoService) {}

  @Get('catalogo')
  @Publico()
  @Throttle(LIMITE_PUBLICO)
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600')
  @Header('Access-Control-Allow-Origin', '*')
  listar(): Promise<CatalogoPublico> {
    return this.catalogo.catalogo();
  }
}
