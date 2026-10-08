import { describe, expect, it } from 'vitest';
import { PATRON_SLUG } from './dominio.js';
import { clabeLegible, clabeValida, coincideBusqueda, slugDe } from './texto.js';

describe('slugDe', () => {
  it.each([
    ['Galletas de Mermelada de Piña', 'galletas-de-mermelada-de-pina'],
    ['Alegrías de Amaranto Tradicionales', 'alegrias-de-amaranto-tradicionales'],
    ['  Borrachitos   Clásicos ', 'borrachitos-clasicos'],
    ['Galletas (6 pzas) — 100% amaranto!', 'galletas-6-pzas-100-amaranto'],
  ])('«%s» → %s', (nombre, esperado) => {
    expect(slugDe(nombre)).toBe(esperado);
    expect(esperado).toMatch(PATRON_SLUG);
  });

  it('un nombre sin letras ni números da un slug vacío', () => {
    expect(slugDe('¡¿…?!')).toBe('');
  });

  it('no pasa de 80 caracteres ni termina en guion', () => {
    const slug = slugDe(`${'a'.repeat(79)} b`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).toMatch(PATRON_SLUG);
  });
});

describe('coincideBusqueda', () => {
  it('busca por nombre sin acentos ni mayúsculas', () => {
    expect(coincideBusqueda('pina', 12, 'Galletas de Piña')).toBe(true);
    expect(coincideBusqueda('  ', 12, 'Galletas de Piña')).toBe(true);
    expect(coincideBusqueda('coco', 12, 'Galletas de Piña')).toBe(false);
  });

  it('un número encuentra el producto con ese ID', () => {
    expect(coincideBusqueda('12', 12, 'Galletas de Piña')).toBe(true);
    expect(coincideBusqueda('1', 12, 'Galletas de Piña')).toBe(false);
    expect(coincideBusqueda('6', 12, 'Galletas de Piña 6 pzas')).toBe(true);
  });
});

describe('clabeValida', () => {
  // CLABE inventada (cuenta en ceros) con su dígito verificador correcto, y el
  // ejemplo que publica Banxico.
  it.each(['002180000000000012', '032180000118359719'])('%s es válida', (clabe) => {
    expect(clabeValida(clabe)).toBe(true);
  });

  it.each([
    ['un dígito cambiado', '002180000000000112'],
    ['dos dígitos volteados', '002810000000000012'],
    ['otro verificador', '002180000000000013'],
    ['17 dígitos', '00218000000000001'],
    ['espacios', '002 180 00000000001 2'],
    ['letras', '00218000000000001A'],
  ])('rechaza %s', (_caso, clabe) => {
    expect(clabeValida(clabe)).toBe(false);
  });

  it('se lee en grupos', () => {
    expect(clabeLegible('002180000000000012')).toBe('002 180 00000000001 2');
  });
});
