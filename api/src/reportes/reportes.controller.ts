import { Controller, Get, Query, type StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AnalisisVentas,
  type ComisionVendedor,
  type Corte,
  type EstadoResultados,
  esquemaFiltroAnalisis,
  esquemaFiltroAnalisisExcel,
  fechaDeHoy,
  esquemaFiltroCorte,
  esquemaFiltroReporteVentas,
  esquemaFormato,
  esquemaPeriodo,
  type FilaReporteCompras,
  type FilaReporteVentas,
  type FilaUtilidad,
  type FiltroAnalisis,
  type FiltroAnalisisExcel,
  type FiltroCorte,
  type Periodo,
  type Tablero,
  ZONA_HORARIA,
} from '@uvm/compartido';
import type { z } from 'zod';
import { RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { archivoXlsx } from '../comun/archivo.js';
import { aCsv, archivoCsv } from '../comun/csv.js';
import { LIMITE_EXCEL } from '../comun/limite-peticiones.js';
import { Validar } from '../comun/validar.js';
import { AnalisisService } from './analisis.service.js';
import { escribirXlsx } from './excel/xlsx.js';
import { libroDeAnalisis } from './excel/libro-analisis.js';
import { ReportesService } from './reportes.service.js';

const filtroVentas = esquemaFiltroReporteVentas.extend(esquemaFormato.shape);
const filtroPeriodo = esquemaPeriodo.extend(esquemaFormato.shape);

const formatoHora = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA_HORARIA,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const horaDeMexico = (fecha: Date) => formatoHora.format(fecha);

@Controller('reportes')
export class ReportesController {
  constructor(
    private readonly reportes: ReportesService,
    private readonly analisisDeVentas: AnalisisService,
  ) {}

  @Get('tablero')
  @RequierePermiso('reportes.ver')
  tablero(@UsuarioActual() usuario: UsuarioSesion): Promise<Tablero> {
    return this.reportes.tablero(usuario);
  }

  /** Lo de Inicio para decidir qué surtir: ranking, agotados y piezas por periodo. */
  @Get('analisis')
  @RequierePermiso('reportes.ver')
  analisis(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query(new Validar(esquemaFiltroAnalisis)) filtro: FiltroAnalisis,
  ): Promise<AnalisisVentas> {
    return this.analisisDeVentas.analisis(usuario, filtro);
  }

  /** El mismo análisis en Excel, con sus gráficas. */
  @Get('analisis/excel')
  @RequierePermiso('reportes.ver')
  @Throttle(LIMITE_EXCEL)
  async analisisExcel(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query(new Validar(esquemaFiltroAnalisisExcel)) filtro: FiltroAnalisisExcel,
  ): Promise<StreamableFile> {
    const analisis = await this.analisisDeVentas.analisis(usuario, filtro);
    const datos = await this.analisisDeVentas.datosDelLibro(
      usuario,
      analisis.desde,
      analisis.hasta,
    );
    const ahora = new Date();
    const libro = libroDeAnalisis(analisis, datos, {
      diasALlevar: filtro.diasALlevar,
      generado: `${fechaDeHoy(ahora)} a las ${horaDeMexico(ahora)}`,
    });
    return archivoXlsx(
      `analisis-ventas-${analisis.desde}-a-${analisis.hasta}.xlsx`,
      escribirXlsx(libro, ahora),
    );
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

  /** El resultado del periodo: de lo vendido a lo que de verdad quedó. */
  @Get('resultado')
  @RequierePermiso('costos.ver')
  resultado(@Query(new Validar(esquemaPeriodo)) filtro: Periodo): Promise<EstadoResultados> {
    return this.reportes.resultado(filtro);
  }

  /** Cuánto se le debe a cada quien por vender: ganado de siempre menos pagado. */
  @Get('comisiones')
  @RequierePermiso('costos.ver')
  comisiones(@Query(new Validar(esquemaPeriodo)) filtro: Periodo): Promise<ComisionVendedor[]> {
    return this.reportes.comisiones(filtro);
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
