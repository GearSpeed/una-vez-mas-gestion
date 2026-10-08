import { describe, expect, it } from 'vitest';
import { bolsaDe } from './dominio.js';

describe('bolsaDe', () => {
  it('transferencia y tarjeta van al banco: Mercado Pago es la cuenta del negocio', () => {
    expect(bolsaDe('transferencia')).toBe('banco');
    expect(bolsaDe('tarjeta')).toBe('banco');
  });

  it('el efectivo y lo demás se quedan en su bolsa', () => {
    expect(bolsaDe('efectivo')).toBe('efectivo');
    expect(bolsaDe('otro')).toBe('otro');
  });
});
