import { describe, expect, it } from 'vitest';
import { armarPrompt } from './prompt.js';

describe('armarPrompt', () => {
  it('dice qué es cada imagen, cuida el producto y suma la escena y el complemento', () => {
    const prompt = armarPrompt('  Mesa de madera, luz de mañana. ', ' Con hojas de menta ');
    expect(prompt).toMatch(/^Imagen 1: referencia de la escena/);
    expect(prompt).toContain('Imagen 2: foto real del producto.');
    expect(prompt).toContain('Conserva el producto idéntico');
    expect(prompt).toContain('La escena: Mesa de madera, luz de mañana.');
    expect(prompt.endsWith('Además: Con hojas de menta')).toBe(true);
  });

  it('sin complemento no deja un «Además» vacío', () => {
    expect(armarPrompt('Fondo blanco', '   ')).not.toContain('Además');
  });
});
