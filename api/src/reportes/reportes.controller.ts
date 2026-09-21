import { Controller, Get, Query, type StreamableFile } from '@nestjs/common';
import {
  type Corte,
  esquemaFiltroCorte,
  esquemaFiltroReporteVentas,
  esquemaFormato,
  esquemaPeriodo,
  type FilaReporteCompras,
  type FilaReporteVentas,
  type FilaUtilidad,
  type FiltroCorte,
  type Tablero,
} from '@uvm/compartido';
import type { z } from 'zod';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { aCsv, archivoCsv } from '../comun/csv.js';
import { Validar } from '../comun/validar.js';
import { ReportesService } from './reportes.service.js';

const filtroVentas = esquemaFiltroReporteVentas.extend(esquemaFormato.shape);
const filtroPeriodo = esquemaPeriodo.extend(esquemaFormato.shape);

@Controller('reportes')
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Get('tablero')
  @RequierePermiso('reportes.ver')
  tablero(@UsuarioActual() usuario: UsuarioSesion): Promise<Tablero> {
    return this.reportes.tablero(usuario);
  }

  @Get('ventas')
  @RequierePermiso('reportes.ver')
  async ventas(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query(new Validar(filtroVentas)) filtro: z.output<typeof filtroVentas>,
  ): Promise<FilaReporteVentas[] | StreamableFile> {
    const filas = await this.reportes.ventas(usuario, filtro);
    if (filtro.formato === 'json') return filas;
    return archivoCsv(
      `ventas-por-${filtro.agrupar}.csv`,
      aCsv(filas, [
        { titulo: 'Grupo', valor: (f) => f.etiqueta },
        { titulo: 'Ventas', valor: (f) => f.ventas },
        { titulo: 'Piezas', valor: (f) => f.piezas },
        { titulo: 'Importe', valor: (f) => f.importe },
        ...(usuario.puede('costos.ver')
          ? [
              { titulo: 'Costo', valor: (f: FilaReporteVentas) => f.costos?.costo },
              { titulo: 'Utilidad', valor: (f: FilaReporteVentas) => f.costos?.utilidad },
            ]
          : []),
      ]),
    );
  }

  @Get('utilidad')
  @RequierePermiso('costos.ver')
  async utilidad(
    @Query(new Validar(filtroPeriodo)) filtro: z.output<typeof filtroPeriodo>,
  ): Promise<FilaUtilidad[] | StreamableFile> {
    const filas = await this.reportes.utilidad(filtro);
    if (filtro.formato === 'json') return filas;
    return archivoCsv(
      'utilidad-por-producto.csv',
      aCsv(filas, [
        { titulo: 'Producto', valor: (f) => f.producto },
        { titulo: 'Piezas', valor: (f) => f.piezas },
        { titulo: 'Ingreso', valor: (f) => f.ingreso },
        { titulo: 'Costo', valor: (f) => f.costo },
        { titulo: 'Utilidad', valor: (f) => f.utilidad },
        { titulo: 'Margen sobre precio', valor: (f) => f.margen },
      ]),
    );
  }

  /** Un vendedor puede ver su propio corte; con `reportes.ver`, el de cualquiera. */
  @Get('corte')
  @RequierePermiso('reportes.ver', 'ventas.registrar')
  corte(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query(new Validar(esquemaFiltroCorte)) filtro: FiltroCorte,
  ): Promise<Corte> {
    return this.reportes.corte(usuario, filtro);
  }

  @Get('compras')
  @RequierePermiso('reportes.ver', 'compras.ver')
  async compras(
    @Query(new Validar(filtroPeriodo)) filtro: z.output<typeof filtroPeriodo>,
  ): Promise<FilaReporteCompras[] | StreamableFile> {
    const filas = await this.reportes.compras(filtro);
    if (filtro.formato === 'json') return filas;
    return archivoCsv(
      'compras.csv',
      aCsv(filas, [
        { titulo: 'Folio', valor: (f) => f.folio },
        { titulo: 'Fecha', valor: (f) => f.fecha },
        { titulo: 'Proveedor', valor: (f) => f.proveedor },
        { titulo: 'Piezas', valor: (f) => f.piezas },
        { titulo: 'Mercancía', valor: (f) => f.mercancia },
        { titulo: 'Gasolina', valor: (f) => f.gasolina },
        { titulo: 'Total', valor: (f) => f.total },
      ]),
    );
  }
}
