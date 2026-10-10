import type { CalidadImagenIa, ErrorImagenIa } from '@uvm/compartido';

/** Una imagen sale en hasta ~2 minutos; con 5 se da por perdida. */
const TIEMPO_MAXIMO = 5 * 60_000;

const CALIDAD_OPENAI: Readonly<Record<CalidadImagenIa, string>> = {
  baja: 'low',
  media: 'medium',
  alta: 'high',
};

export interface ImagenDeEntrada {
  readonly datos: Buffer;
  readonly nombre: string;
  readonly tipo: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface PeticionEdicion {
  /** En orden: el prompt las nombra «imagen 1», «imagen 2». */
  readonly imagenes: readonly ImagenDeEntrada[];
  readonly prompt: string;
  readonly calidad: CalidadImagenIa;
}

export interface FalloOpenAi {
  readonly tipo: ErrorImagenIa;
  /** Para quien pidió la imagen: en español y con qué hacer. */
  readonly mensaje: string;
  /** Para el log: lo que dijo OpenAI (sin la llave). */
  readonly detalle: string;
}

export type ResultadoEdicion =
  { readonly ok: true; readonly png: Buffer } | ({ readonly ok: false } & FalloOpenAi);

const MENSAJES: Readonly<Record<ErrorImagenIa, string>> = {
  sin_creditos:
    'Se acabaron los créditos de OpenAI o se llegó al tope de gasto. Recarga saldo en ' +
    'platform.openai.com (Billing) o sube el tope (Limits) y vuelve a intentar.',
  limite:
    'OpenAI pide esperar: se pidieron muchas imágenes seguidas. Intenta de nuevo en un minuto.',
  llave:
    'OpenAI rechazó la llave (OPENAI_API_KEY): no es válida, se revocó o no tiene acceso a ' +
    'este modelo.',
  moderacion:
    'OpenAI no generó la imagen por sus reglas de contenido. Cambia el texto o la foto y ' +
    'vuelve a intentar.',
  servicio: 'OpenAI no respondió bien. Intenta de nuevo en unos minutos.',
};

/**
 * Códigos con los que OpenAI dice que no hay saldo o que se llegó a un tope de gasto.
 * Llegan como 429, igual que el límite de ritmo, pero reintentar no sirve de nada: hay
 * que recargar. Por eso se distinguen por `code` (y por `type`, que en los de cobro
 * puede venir como `insufficient_quota`).
 */
const SIN_CREDITOS = new Set([
  'credit_balance_exhausted',
  'insufficient_quota',
  'billing_hard_limit_reached',
  'billing_not_active',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

/** Traduce una respuesta de error de OpenAI a algo que se le pueda explicar a quien la pidió. */
export function clasificarError(estado: number, cuerpo: unknown): FalloOpenAi {
  const error =
    cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo && cuerpo.error
      ? (cuerpo.error as Record<string, unknown>)
      : {};
  const codigo = texto(error['code']);
  const tipoOpenAi = texto(error['type']);
  const detalle = `HTTP ${estado} ${tipoOpenAi}/${codigo}: ${texto(error['message'])}`.trim();
  const fallo = (tipo: ErrorImagenIa, mensaje = MENSAJES[tipo]): FalloOpenAi => ({
    tipo,
    mensaje,
    detalle,
  });

  if (SIN_CREDITOS.has(codigo) || SIN_CREDITOS.has(tipoOpenAi)) return fallo('sin_creditos');
  if (codigo === 'moderation_blocked' || codigo === 'content_policy_violation') {
    return fallo('moderacion');
  }
  if (estado === 401 || estado === 403) return fallo('llave');
  if (estado === 429) return fallo('limite');
  if (estado >= 400 && estado < 500) {
    // Una petición que OpenAI no aceptó (un modelo que no existe, un tamaño inválido):
    // su mensaje en inglés ayuda más que uno genérico.
    const motivo = texto(error['message']);
    return fallo(
      'servicio',
      motivo ? `OpenAI no aceptó la petición: ${motivo}` : MENSAJES.servicio,
    );
  }
  return fallo('servicio');
}

/**
 * Lo mínimo de la API de imágenes de OpenAI: editar a partir de varias imágenes de
 * entrada (`POST /images/edits`). Con `fetch` y `FormData` de Node, sin SDK.
 */
export class ClienteOpenAi {
  constructor(
    private readonly llave: string,
    private readonly base: string,
    private readonly modelo: string,
    private readonly pedir: typeof fetch = fetch,
    private readonly tiempoMaximo = TIEMPO_MAXIMO,
  ) {}

  get modeloEnUso(): string {
    return this.modelo;
  }

  async editar({ imagenes, prompt, calidad }: PeticionEdicion): Promise<ResultadoEdicion> {
    const formulario = new FormData();
    formulario.append('model', this.modelo);
    formulario.append('prompt', prompt);
    formulario.append('quality', CALIDAD_OPENAI[calidad]);
    formulario.append('size', '1024x1024');
    formulario.append('output_format', 'png');
    formulario.append('n', '1');
    for (const imagen of imagenes) {
      formulario.append(
        'image[]',
        new Blob([new Uint8Array(imagen.datos)], { type: imagen.tipo }),
        imagen.nombre,
      );
    }

    let respuesta: Response;
    try {
      respuesta = await this.pedir(`${this.base}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.llave}` },
        body: formulario,
        signal: AbortSignal.timeout(this.tiempoMaximo),
      });
    } catch (error) {
      const agotado = error instanceof Error && error.name === 'TimeoutError';
      return {
        ok: false,
        tipo: 'servicio',
        mensaje: agotado
          ? 'OpenAI tardó más de 5 minutos y se dejó de esperar. Intenta de nuevo.'
          : 'No se pudo hablar con OpenAI. Revisa la conexión del servidor e intenta de nuevo.',
        detalle: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }

    const cuerpo: unknown = await respuesta.json().catch(() => null);
    if (!respuesta.ok) return { ok: false, ...clasificarError(respuesta.status, cuerpo) };

    const base64 = (cuerpo as { data?: { b64_json?: unknown }[] } | null)?.data?.[0]?.b64_json;
    if (typeof base64 !== 'string' || base64.length === 0) {
      return {
        ok: false,
        tipo: 'servicio',
        mensaje: MENSAJES.servicio,
        detalle: 'La respuesta no trae data[0].b64_json',
      };
    }
    return { ok: true, png: Buffer.from(base64, 'base64') };
  }
}
