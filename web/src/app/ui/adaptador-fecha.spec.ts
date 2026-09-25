import { describe, expect, it } from 'vitest';
import { AdaptadorFechaTexto } from './adaptador-fecha';

const adaptador = new AdaptadorFechaTexto();

describe('adaptador de fechas de texto', () => {
  it('lee las partes de una fecha sin convertirla a Date', () => {
    expect(adaptador.getYear('2026-09-25')).toBe(2026);
    expect(adaptador.getMonth('2026-09-25')).toBe(8);
    expect(adaptador.getDate('2026-09-25')).toBe(25);
    // 25 de septiembre de 2026 es viernes (5, con domingo en 0).
    expect(adaptador.getDayOfWeek('2026-09-25')).toBe(5);
  });

  it('arma y da formato como se lee en México', () => {
    expect(adaptador.createDate(2026, 0, 5)).toBe('2026-01-05');
    expect(adaptador.format('2026-01-05', 'corta')).toBe('05/01/2026');
    expect(adaptador.format('2026-01-05', 'larga')).toBe('5 de enero de 2026');
  });

  it('entiende lo que se teclea y rechaza lo que no es fecha', () => {
    expect(adaptador.parse('31/12/2026')).toBe('2026-12-31');
    expect(adaptador.parse('2026-12-31')).toBe('2026-12-31');
    expect(adaptador.isValid(adaptador.parse('31/02/2026') as string)).toBe(false);
    expect(adaptador.isValid(adaptador.parse('cualquier cosa') as string)).toBe(false);
    expect(adaptador.parse('')).toBeNull();
  });

  it('suma meses sin desbordar el fin de mes', () => {
    expect(adaptador.addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(adaptador.addCalendarMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(adaptador.addCalendarYears('2024-02-29', 1)).toBe('2025-02-28');
  });

  it('suma días cruzando meses y años', () => {
    expect(adaptador.addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(adaptador.addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('cuenta los días del mes, incluidos los bisiestos', () => {
    expect(adaptador.getNumDaysInMonth('2026-02-10')).toBe(28);
    expect(adaptador.getNumDaysInMonth('2024-02-10')).toBe(29);
  });

  it('la semana empieza en lunes y los nombres van en español', () => {
    expect(adaptador.getFirstDayOfWeek()).toBe(1);
    expect(adaptador.getMonthNames('long')[0]).toBe('enero');
    expect(adaptador.getMonthNames('long')).toHaveLength(12);
  });

  /**
   * Siete, ni uno más: con ocho, el calendario dibujaba dos domingos y todos los
   * días quedaban corridos de columna.
   */
  it('los días de la semana son siete, de domingo a sábado', () => {
    for (const estilo of ['long', 'short', 'narrow'] as const) {
      expect(adaptador.getDayOfWeekNames(estilo)).toHaveLength(7);
    }
    expect(adaptador.getDayOfWeekNames('long')).toEqual([
      'domingo',
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
    ]);
    expect(adaptador.getDayOfWeekNames('narrow')).toEqual(['D', 'L', 'M', 'M', 'J', 'V', 'S']);
    expect(adaptador.getDateNames()).toHaveLength(31);
  });
});
