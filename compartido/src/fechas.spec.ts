import { describe, expect, it } from 'vitest';
import { diasEntre, fechaDeHoy, inicioDeMes, inicioDeSemana, sumarDias } from './fechas.js';

describe('fechas del negocio', () => {
  it('a las 11 de la noche en CDMX sigue siendo el mismo día', () => {
    // 2026-09-22 05:00 UTC = 2026-09-21 23:00 en la Ciudad de México
    expect(fechaDeHoy(new Date('2026-09-22T05:00:00Z'))).toBe('2026-09-21');
  });

  it('suma y resta días cruzando meses', () => {
    expect(sumarDias('2026-09-30', 1)).toBe('2026-10-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('calcula el inicio del mes y de la semana (lunes)', () => {
    expect(inicioDeMes('2026-09-21')).toBe('2026-09-01');
    expect(inicioDeSemana('2026-09-21')).toBe('2026-09-21'); // lunes
    expect(inicioDeSemana('2026-09-27')).toBe('2026-09-21'); // domingo
  });
});

describe('días entre dos fechas', () => {
  it('cuenta los días completos, sin importar la zona', () => {
    expect(diasEntre('2026-09-01', '2026-09-30')).toBe(29);
    expect(diasEntre('2026-09-25', '2026-09-25')).toBe(0);
    expect(diasEntre('2026-01-01', '2027-01-01')).toBe(365);
    // 2024 fue bisiesto: un año son 366 días.
    expect(diasEntre('2024-01-01', '2025-01-01')).toBe(366);
  });

  it('no se descuadra en el cambio de horario', () => {
    // En México el horario de verano ya no se aplica, pero la cuenta no depende
    // de la hora: se arma en UTC a propósito.
    expect(diasEntre('2026-04-04', '2026-04-05')).toBe(1);
    expect(diasEntre('2026-10-24', '2026-10-26')).toBe(2);
  });
});
