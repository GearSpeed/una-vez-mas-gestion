import { TestBed } from '@angular/core/testing';
import { GraficaBarras } from './grafica-barras';
import { GraficaLineas } from './grafica-lineas';

describe('GraficaBarras', () => {
  it('es una tabla: cada barra con su producto y su valor en texto', async () => {
    const fixture = TestBed.createComponent(GraficaBarras);
    fixture.componentRef.setInput('titulo', 'Piezas vendidas');
    fixture.componentRef.setInput('datos', [
      { etiqueta: 'Tejocote', valor: 8, texto: '8' },
      { etiqueta: 'Avena', valor: 2, texto: '2' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const pantalla = fixture.nativeElement as HTMLElement;

    expect(pantalla.querySelector('figcaption')?.textContent).toBe('Piezas vendidas');
    const filas = [...pantalla.querySelectorAll('tbody tr')];
    expect(filas.map((f) => f.querySelector('th[scope="row"]')?.textContent)).toEqual([
      'Tejocote',
      'Avena',
    ]);
    expect(filas.map((f) => f.querySelector('.valor')?.textContent)).toEqual(['8', '2']);
    // La barra es decoración: el lector de pantalla lee el número.
    const barras = [...pantalla.querySelectorAll<HTMLElement>('.barra')];
    expect(barras.every((b) => b.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(barras.map((b) => b.style.inlineSize)).toEqual(['85%', '21.25%']);
  });
});

const crear = (periodos: string[], series: { nombre: string; valores: number[] }[]) => {
  const fixture = TestBed.createComponent(GraficaLineas);
  fixture.componentRef.setInput('titulo', 'Piezas por día');
  fixture.componentRef.setInput('periodos', periodos);
  fixture.componentRef.setInput('series', series);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
};

describe('GraficaLineas', () => {
  it('describe la imagen con un resumen en texto', () => {
    const pantalla = crear(
      ['4 oct', '5 oct', '6 oct'],
      [{ nombre: 'Total', valores: [7, 22, 15] }],
    );
    const svg = pantalla.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    const resumen = pantalla.querySelector(`#${svg?.getAttribute('aria-describedby')}`);
    expect(resumen?.textContent).toBe(
      'Total: 44 piezas en total; el máximo, 22, el 5 oct; el mínimo, 7, el 4 oct.',
    );
    expect(pantalla.querySelector('polyline')).not.toBeNull();
  });

  it('cada serie lleva su nombre escrito y un trazo distinto', () => {
    const pantalla = crear(
      ['4 oct', '5 oct'],
      [
        { nombre: 'Tejocote', valores: [1, 3] },
        { nombre: 'Avena', valores: [2, 2] },
      ],
    );
    const nombres = [...pantalla.querySelectorAll('.nombre')].map((n) => n.textContent?.trim());
    expect(nombres).toEqual(['Tejocote', 'Avena']);
    const trazos = [...pantalla.querySelectorAll('polyline')].map((l) =>
      l.getAttribute('stroke-dasharray'),
    );
    expect(trazos).toEqual([null, '8 4']);
  });

  it('con un solo periodo avisa que todavía no hay tendencia', () => {
    const pantalla = crear(['oct 2026'], [{ nombre: 'Total', valores: [66] }]);
    expect(pantalla.querySelector('polyline')).toBeNull();
    expect(pantalla.textContent).toContain('Con un solo periodo todavía no hay tendencia');
  });
});
