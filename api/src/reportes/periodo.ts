import { UnprocessableEntityException } from '@nestjs/common';
import { diasEntre, fechaDeHoy, inicioDeMes, type Periodo, sumarDias } from '@uvm/compartido';

/**
 * Lo más ancho que se puede pedir de una vez. Un reporte recorre todas las líneas
 * de venta del rango: sin tope, una sola petición puede costar lo que cuesta un año
 * entero, y se puede repetir 300 veces por minuto. Un año y un día cubre cualquier
 * comparación contra el mismo mes del año pasado; para más, se piden por tramos.
 */
export const DIAS_MAXIMOS = 366;

/**
 * El rango de un reporte. Sin fechas cubre el mes en curso, solo hoy o los últimos 30
 * días (hoy incluido), según el reporte.
 */
export function periodo(
  filtro: Periodo,
  porOmision: 'mes' | 'hoy' | '30dias' = 'mes',
): { desde: string; hasta: string } {
  const hoy = fechaDeHoy();
  const hasta = filtro.hasta ?? hoy;
  const desde =
    filtro.desde ??
    { mes: inicioDeMes(hasta), hoy: hasta, '30dias': sumarDias(hasta, -29) }[porOmision];
  if (desde > hasta) {
    throw new UnprocessableEntityException({
      mensaje: 'La fecha inicial es posterior a la final.',
      campos: { desde: 'Debe ser anterior a "hasta"' },
    });
  }
  if (diasEntre(desde, hasta) > DIAS_MAXIMOS) {
    throw new UnprocessableEntityException({
      mensaje: `El periodo no puede pasar de ${DIAS_MAXIMOS} días. Pídelo por tramos.`,
      campos: { desde: `Como mucho ${DIAS_MAXIMOS} días antes de "hasta"` },
    });
  }
  return { desde, hasta };
}
