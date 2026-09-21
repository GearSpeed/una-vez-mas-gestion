import { describe, expect, it } from 'vitest';
import { aCsv } from './csv.js';

describe('aCsv', () => {
  const columnas = [
    { titulo: 'Producto', valor: (f: { p: string; n: number }) => f.p },
    { titulo: 'Piezas', valor: (f: { p: string; n: number }) => f.n },
  ];

  it('escapa comas y comillas, y agrega BOM', () => {
    const csv = aCsv([{ p: 'Galletas "de la casa", 6 pzas', n: 3 }], columnas);
    expect(csv).toBe('﻿Producto,Piezas\r\n"Galletas ""de la casa"", 6 pzas",3\r\n');
  });

  it('neutraliza fórmulas pero no números negativos', () => {
    const csv = aCsv(
      [
        { p: '=HYPERLINK("x")', n: -2 },
        { p: '-5', n: 1 },
      ],
      columnas,
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")",-2`);
    expect(csv).toContain('-5,1');
  });
});
