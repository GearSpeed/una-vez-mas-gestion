import { describe, expect, it } from 'vitest';
import { fechaDeHoy, inicioDeMes, inicioDeSemana, sumarDias } from './fechas.js';

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
