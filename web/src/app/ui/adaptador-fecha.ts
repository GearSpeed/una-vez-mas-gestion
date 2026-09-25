import { Injectable } from '@angular/core';
import { DateAdapter, type MatDateFormats } from '@angular/material/core';
import { fechaDeHoy, sumarDias } from '@uvm/compartido';

/**
 * El calendario de Material, hablando el mismo idioma que el resto del sistema:
 * fechas como texto `AAAA-MM-DD`.
 *
 * Con el adaptador de fábrica habría que convertir a `Date` y de regreso en cada
 * pantalla, y ahí es donde se pierde un día: un `Date` lleva hora y zona, y a las
 * 11 de la noche en México ya es mañana en UTC. Aquí nunca existe un `Date` con
 * hora: el mediodía UTC que se usa para dar formato es un truco interno para que
 * ninguna zona horaria pueda correr la fecha.
 */
@Injectable()
export class AdaptadorFechaTexto extends DateAdapter<string> {
  private readonly nombresDia = this.nombres({ weekday: 'long' }, 4, 10);
  private readonly nombresDiaCorto = this.nombres({ weekday: 'short' }, 4, 10);
  private readonly nombresDiaMinimo = this.nombres({ weekday: 'narrow' }, 4, 10);
  private readonly nombresMes = this.nombres({ month: 'long' }, 1, 12, true);
  private readonly nombresMesCorto = this.nombres({ month: 'short' }, 1, 12, true);

  getYear(fecha: string): number {
    return Number(fecha.slice(0, 4));
  }

  getMonth(fecha: string): number {
    return Number(fecha.slice(5, 7)) - 1;
  }

  getDate(fecha: string): number {
    return Number(fecha.slice(8, 10));
  }

  getDayOfWeek(fecha: string): number {
    return this.aUtc(fecha).getUTCDay();
  }

  getMonthNames(estilo: 'long' | 'short' | 'narrow'): string[] {
    return estilo === 'long' ? this.nombresMes : this.nombresMesCorto;
  }

  getDateNames(): string[] {
    return Array.from({ length: 31 }, (_, i) => String(i + 1));
  }

  getDayOfWeekNames(estilo: 'long' | 'short' | 'narrow'): string[] {
    if (estilo === 'long') return this.nombresDia;
    return estilo === 'short' ? this.nombresDiaCorto : this.nombresDiaMinimo;
  }

  getYearName(fecha: string): string {
    return fecha.slice(0, 4);
  }

  /** Lunes, como se usa el calendario en México. */
  getFirstDayOfWeek(): number {
    return 1;
  }

  getNumDaysInMonth(fecha: string): number {
    return new Date(Date.UTC(this.getYear(fecha), this.getMonth(fecha) + 1, 0)).getUTCDate();
  }

  clone(fecha: string): string {
    return fecha;
  }

  createDate(anio: number, mes: number, dia: number): string {
    return `${String(anio).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  today(): string {
    return fechaDeHoy();
  }

  /** Lo que se teclea: `31/12/2026`, o la fecha ya en texto `2026-12-31`. */
  parse(valor: unknown): string | null {
    if (typeof valor !== 'string') return null;
    const texto = valor.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return this.isValid(texto) ? texto : this.invalid();
    const partes = texto.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (!partes) return texto ? this.invalid() : null;
    const armada = this.createDate(Number(partes[3]), Number(partes[2]) - 1, Number(partes[1]));
    return this.isValid(armada) ? armada : this.invalid();
  }

  format(fecha: string, formato: string): string {
    return new Intl.DateTimeFormat('es-MX', {
      ...FORMATOS_INTL[formato as keyof typeof FORMATOS_INTL],
      timeZone: 'UTC',
    }).format(this.aUtc(fecha));
  }

  addCalendarYears(fecha: string, anios: number): string {
    return this.addCalendarMonths(fecha, anios * 12);
  }

  /** El 31 de enero más un mes es el 28 (o 29) de febrero, no el 3 de marzo. */
  addCalendarMonths(fecha: string, meses: number): string {
    const destino = new Date(Date.UTC(this.getYear(fecha), this.getMonth(fecha) + meses, 1));
    const ultimo = new Date(
      Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return this.createDate(
      destino.getUTCFullYear(),
      destino.getUTCMonth(),
      Math.min(this.getDate(fecha), ultimo),
    );
  }

  addCalendarDays(fecha: string, dias: number): string {
    return sumarDias(fecha, dias);
  }

  toIso8601(fecha: string): string {
    return fecha;
  }

  isDateInstance(obj: unknown): boolean {
    return typeof obj === 'string';
  }

  isValid(fecha: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
    const utc = this.aUtc(fecha);
    // Rebota el 31 de febrero: al armarlo, el día cambia.
    return !Number.isNaN(utc.getTime()) && utc.getUTCDate() === this.getDate(fecha);
  }

  /** Lo que devuelve un texto que no es fecha: `isValid` lo reconoce como inválido. */
  invalid(): string {
    return 'fecha-invalida';
  }

  /** Mediodía UTC: ninguna zona horaria puede correr la fecha a otro día. */
  private aUtc(fecha: string): Date {
    return new Date(Date.UTC(this.getYear(fecha), this.getMonth(fecha), this.getDate(fecha), 12));
  }

  private nombres(
    opciones: Intl.DateTimeFormatOptions,
    desde: number,
    hasta: number,
    porMes = false,
  ): string[] {
    const formato = new Intl.DateTimeFormat('es-MX', { ...opciones, timeZone: 'UTC' });
    return Array.from({ length: hasta - desde + 1 }, (_, i) => {
      const fecha = porMes
        ? new Date(Date.UTC(2026, desde + i - 1, 1, 12))
        : new Date(Date.UTC(2026, 0, desde + i, 12));
      return formato.format(fecha);
    });
  }
}

const FORMATOS_INTL = {
  corta: { day: '2-digit', month: '2-digit', year: 'numeric' },
  larga: { day: 'numeric', month: 'long', year: 'numeric' },
  mesAnio: { month: 'short', year: 'numeric' },
  mesAnioLargo: { month: 'long', year: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/** Se teclea y se lee `31/12/2026`; los lectores de pantalla oyen la fecha completa. */
export const FORMATOS_FECHA: MatDateFormats = {
  parse: { dateInput: 'corta' },
  display: {
    dateInput: 'corta',
    monthYearLabel: 'mesAnio',
    dateA11yLabel: 'larga',
    monthYearA11yLabel: 'mesAnioLargo',
  },
};
