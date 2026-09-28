import { ZONA_HORARIA } from './dominio.js';

/**
 * Fechas del negocio como texto AAAA-MM-DD, siempre en la hora de la Ciudad de
 * México: a las 11 de la noche sigue siendo "hoy" aunque en UTC ya sea mañana.
 */
const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function fechaDeHoy(ahora: Date = new Date()): string {
  return formato.format(ahora);
}

/** Suma (o resta) días a una fecha AAAA-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const utc = new Date(Date.UTC(anio ?? 1970, (mes ?? 1) - 1, (dia ?? 1) + dias));
  return utc.toISOString().slice(0, 10);
}

export function inicioDeMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

/** El lunes de la semana de `fecha`. */
export function inicioDeSemana(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const diaSemana = new Date(Date.UTC(anio ?? 1970, (mes ?? 1) - 1, dia ?? 1)).getUTCDay();
  return sumarDias(fecha, -((diaSemana + 6) % 7));
}

/** El mediodía UTC de una fecha de texto: sirve para contar días sin zonas de por medio. */
function enUtc(fecha: string): number {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return Date.UTC(anio ?? 1970, (mes ?? 1) - 1, dia ?? 1);
}

/** Días entre dos fechas AAAA-MM-DD, sin importar la hora ni la zona. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((enUtc(hasta) - enUtc(desde)) / 86_400_000);
}
