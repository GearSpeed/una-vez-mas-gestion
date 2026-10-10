import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface SerieLineas {
  readonly nombre: string;
  readonly valores: readonly number[];
}

const ANCHO = 640;
const ALTO = 260;
const MARGEN = { izquierda: 40, derecha: 150, arriba: 16, abajo: 36 } as const;
const PLANO = {
  ancho: ANCHO - MARGEN.izquierda - MARGEN.derecha,
  alto: ALTO - MARGEN.arriba - MARGEN.abajo,
};
/** Cada serie se distingue por color, trazo y marcador: nunca solo por color. */
const TRAZOS = ['', '8 4', '2 4', '12 4 2 4', '4 4'] as const;
const MAXIMO_ETIQUETAS_X = 8;

let siguienteId = 0;

/** Un tope «redondo» para el eje: 7 → 8, 22 → 25, 130 → 150. */
function topeRedondo(valor: number): number {
  if (valor <= 0) return 4;
  const potencia = 10 ** Math.floor(Math.log10(valor));
  const paso = [1, 2, 2.5, 5, 10].find((p) => p * potencia >= valor) ?? 10;
  return paso * potencia;
}

/** El marcador de cada serie, centrado en (x, y). */
function marcador(serie: number, x: number, y: number): string {
  const r = 4;
  switch (serie % 5) {
    case 1:
      return `M${x - r},${y - r}h${2 * r}v${2 * r}h${-2 * r}z`;
    case 2:
      return `M${x},${y - r - 1}L${x + r + 1},${y + r}H${x - r - 1}z`;
    case 3:
      return `M${x},${y - r - 1}L${x + r + 1},${y}L${x},${y + r + 1}L${x - r - 1},${y}z`;
    case 4:
      return `M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`;
    default:
      return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

/**
 * Gráfica de líneas en SVG. Lleva un resumen en texto (total, máximo, mínimo) que
 * también describe la imagen para lectores de pantalla, y el nombre de cada serie
 * escrito al final de su línea.
 */
@Component({
  selector: 'uvm-grafica-lineas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="grafica">
      <figcaption [id]="id + '-titulo'">{{ titulo() }}</figcaption>
      <svg
        [attr.viewBox]="'0 0 ' + ancho + ' ' + alto"
        role="img"
        [attr.aria-labelledby]="id + '-titulo'"
        [attr.aria-describedby]="id + '-resumen'"
      >
        @for (linea of guias(); track linea.valor) {
          <line
            class="guia"
            [attr.x1]="izquierda"
            [attr.x2]="derecha"
            [attr.y1]="linea.y"
            [attr.y2]="linea.y"
          />
          <text class="eje" [attr.x]="izquierda - 6" [attr.y]="linea.y + 4" text-anchor="end">
            {{ linea.valor }}
          </text>
        }
        @for (etiqueta of etiquetasX(); track etiqueta.x) {
          <text class="eje" [attr.x]="etiqueta.x" [attr.y]="alto - 12" text-anchor="middle">
            {{ etiqueta.texto }}
          </text>
        }
        @for (serie of trazos(); track serie.nombre; let i = $index) {
          <g [class]="'serie serie-' + (i % 5)">
            @if (serie.puntos.length > 1) {
              <polyline
                [attr.points]="serie.linea"
                [attr.stroke-dasharray]="serie.guion"
                vector-effect="non-scaling-stroke"
              />
            }
            @for (punto of serie.puntos; track punto.x) {
              <path class="marcador" [attr.d]="punto.forma" />
            }
            <text class="nombre" [attr.x]="serie.final.x + 8" [attr.y]="serie.final.y + 4">
              {{ serie.etiqueta }}
            </text>
          </g>
        }
      </svg>
      <p class="ayuda" [id]="id + '-resumen'">{{ resumen() }}</p>
    </figure>
  `,
  styles: `
    .grafica {
      margin: 0;
    }
    figcaption {
      font: var(--mat-sys-title-small);
      margin-block-end: 0.25rem;
    }
    svg {
      display: block;
      inline-size: 100%;
      max-inline-size: 44rem;
      block-size: auto;
      overflow: visible;
    }
    .guia {
      stroke: var(--mat-sys-outline-variant);
      stroke-width: 1;
    }
    .eje,
    .nombre {
      font:
        14px 'Plus Jakarta Sans',
        sans-serif;
      fill: var(--mat-sys-on-surface-variant);
    }
    .nombre {
      fill: var(--mat-sys-on-surface);
    }
    polyline {
      fill: none;
      stroke-width: 2.5;
      stroke-linejoin: round;
      stroke: var(--color);
    }
    .marcador {
      fill: var(--color);
      stroke: var(--color);
      stroke-width: 1.5;
    }
    /* Contraste de 3:1 o más contra el fondo claro de las tarjetas. */
    .serie-0 {
      --color: #5b0021;
    }
    .serie-1 {
      --color: #b7034d;
    }
    .serie-2 {
      --color: #7a5200;
    }
    .serie-3 {
      --color: #2e6f95;
    }
    .serie-4 {
      --color: #4c7a34;
    }
    @media (forced-colors: active) {
      .serie {
        --color: CanvasText;
      }
      .eje,
      .nombre {
        fill: CanvasText;
      }
    }
  `,
})
export class GraficaLineas {
  readonly titulo = input.required<string>();
  /** Las etiquetas del eje horizontal, ya formateadas: «4 oct», «oct 2026». */
  readonly periodos = input.required<readonly string[]>();
  readonly series = input.required<readonly SerieLineas[]>();
  /** «piezas por día»: arma el resumen en texto. */
  readonly unidad = input('piezas');

  protected readonly id = `grafica-lineas-${siguienteId++}`;
  protected readonly ancho = ANCHO;
  protected readonly alto = ALTO;
  protected readonly izquierda = MARGEN.izquierda;
  protected readonly derecha = MARGEN.izquierda + PLANO.ancho;

  private readonly tope = computed(() =>
    topeRedondo(Math.max(0, ...this.series().flatMap((s) => s.valores))),
  );

  private x(i: number): number {
    const n = this.periodos().length;
    return MARGEN.izquierda + (n <= 1 ? PLANO.ancho / 2 : (i * PLANO.ancho) / (n - 1));
  }

  private y(valor: number): number {
    return MARGEN.arriba + PLANO.alto - (valor / this.tope()) * PLANO.alto;
  }

  protected readonly guias = computed(() =>
    [0, 1, 2, 3, 4].map((k) => {
      const valor = (this.tope() * k) / 4;
      return {
        valor: Number.isInteger(valor) ? valor : Number(valor.toFixed(1)),
        y: this.y(valor),
      };
    }),
  );

  protected readonly etiquetasX = computed(() => {
    const periodos = this.periodos();
    const paso = Math.ceil(periodos.length / MAXIMO_ETIQUETAS_X);
    const indices = periodos.flatMap((_, i) => (i % paso === 0 ? [i] : []));
    // El último periodo siempre lleva etiqueta; si queda pegado al anterior, lo reemplaza.
    const ultimo = periodos.length - 1;
    if (ultimo > 0 && indices.at(-1) !== ultimo) {
      if (ultimo - (indices.at(-1) ?? 0) < paso) indices.pop();
      indices.push(ultimo);
    }
    return indices.map((i) => ({ texto: periodos[i] ?? '', x: this.x(i) }));
  });

  protected readonly trazos = computed(() => {
    const trazos = this.series().map((serie, i) => {
      const puntos = serie.valores.map((valor, j) => ({ x: this.x(j), y: this.y(valor) }));
      const ultimo = puntos.at(-1) ?? { x: this.x(0), y: this.y(0) };
      return {
        nombre: serie.nombre,
        etiqueta: serie.nombre.length > 22 ? `${serie.nombre.slice(0, 21)}…` : serie.nombre,
        guion: TRAZOS[i % TRAZOS.length] || null,
        linea: puntos.map((p) => `${p.x},${p.y}`).join(' '),
        puntos: puntos.map((p) => ({ ...p, forma: marcador(i, p.x, p.y) })),
        final: { ...ultimo },
      };
    });
    // De arriba hacia abajo (son cinco a lo más): cada uno, al menos 14 px bajo el anterior.
    const pendientes = [...trazos];
    let anterior: number | null = null;
    while (pendientes.length) {
      let arriba = 0;
      pendientes.forEach((t, k) => {
        if (t.final.y < (pendientes[arriba]?.final.y ?? Infinity)) arriba = k;
      });
      const [trazo] = pendientes.splice(arriba, 1);
      if (!trazo) break;
      if (anterior !== null && trazo.final.y - anterior < 14) trazo.final.y = anterior + 14;
      anterior = trazo.final.y;
    }
    return trazos;
  });

  protected readonly resumen = computed(() => {
    const periodos = this.periodos();
    const series = this.series();
    if (!periodos.length || !series.length) return 'Sin datos.';
    if (periodos.length === 1) {
      return `Con un solo periodo todavía no hay tendencia: ${series
        .map((s) => `${s.nombre}, ${s.valores[0] ?? 0}`)
        .join('; ')}.`;
    }
    return series
      .map((s) => {
        const maximo = Math.max(...s.valores);
        const minimo = Math.min(...s.valores);
        const total = s.valores.reduce((a, b) => a + b, 0);
        if (series.length > 1) {
          return `${s.nombre}: ${total}, con su máximo de ${maximo} el ${periodos[s.valores.indexOf(maximo)]}`;
        }
        return (
          `${s.nombre}: ${total} ${this.unidad()} en total; el máximo, ${maximo}, el ` +
          `${periodos[s.valores.indexOf(maximo)]}; el mínimo, ${minimo}, el ${periodos[s.valores.indexOf(minimo)]}`
        );
      })
      .join('. ')
      .concat('.');
  });
}
