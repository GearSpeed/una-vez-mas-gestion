import type { CalidadImagenIa, ErrorImagenIa } from '@uvm/compartido';

/** Una imagen sale en hasta ~2 minutos; con 5 se da por perdida. */
const TIEMPO_MAXIMO = 5 * 60_000;
/** Describir una imagen toma segundos: con uno se da por perdida. */
const TIEMPO_MAXIMO_TEXTO = 60_000;

/** Los mismos topes que `esquemaReferenciaImagen`: la sugerencia cabe tal cual en el formulario. */
const LARGO_NOMBRE = 60;
const LARGO_PROMPT = 2000;

/**
 * Lo que se le pide al modelo que ve la imagen. Describe solo el escenario: el
 * producto lo pone después la foto real, y una marca o un texto inventados en el
 * prompt acabarían dibujados en la imagen.
 */
const INSTRUCCIONES_REFERENCIA = [
  'Esta imagen es una referencia de escena para fotos de producto de una tienda de dulces',
  'artesanales mexicanos (galletas, borrachitos, alegrías). Devuelve en español:',
  '- nombre: de 2 a 5 palabras que identifiquen la escena, como «Mesa de madera rústica».',
  '- prompt: de 2 a 4 frases que describan la escena para recrearla con un producto al',
  'frente: fondo, superficie y materiales, colores, luz (dirección y temperatura),',
  'ambiente, encuadre y ángulo de cámara, profundidad de campo y estilo fotográfico.',
  'Describe solo el escenario: no describas productos que aparezcan ni inventes marcas,',
  'logotipos o textos.',
].join(' ');

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

export interface SugerenciaReferencia {
  readonly nombre: string;
  readonly prompt: string;
}

export type ResultadoDescripcion =
  ({ readonly ok: true } & SugerenciaReferencia) | ({ readonly ok: false } & FalloOpenAi);

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

/** 300000 → «5 minutos»; 60000 → «1 minuto»; 20 → «1 segundo». */
function duracion(ms: number): string {
  if (ms >= 60_000) {
    const minutos = Math.round(ms / 60_000);
    return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
  }
  const segundos = Math.max(1, Math.round(ms / 1000));
  return `${segundos} ${segundos === 1 ? 'segundo' : 'segundos'}`;
}

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

export interface OpcionesClienteOpenAi {
  readonly llave: string;
  readonly base: string;
  /** El que genera imágenes. */
  readonly modeloImagen: string;
  /** El que ve una imagen y la describe (la sugerencia de una referencia). */
  readonly modeloTexto: string;
  readonly pedir?: typeof fetch;
  readonly tiempoMaximo?: number;
  readonly tiempoMaximoTexto?: number;
}

/**
 * Lo mínimo de la API de OpenAI: generar a partir de varias imágenes de entrada
 * (`POST /images/edits`) y describir una imagen (`POST /responses`). Con `fetch` y
 * `FormData` de Node, sin SDK.
 */
export class ClienteOpenAi {
  private readonly llave: string;
  private readonly base: string;
  private readonly modeloImagen: string;
  private readonly modeloTexto: string;
  private readonly pedir: typeof fetch;
  private readonly tiempoMaximo: number;
  private readonly tiempoMaximoTexto: number;

  constructor(opciones: OpcionesClienteOpenAi) {
    this.llave = opciones.llave;
    this.base = opciones.base;
    this.modeloImagen = opciones.modeloImagen;
    this.modeloTexto = opciones.modeloTexto;
    this.pedir = opciones.pedir ?? fetch;
    this.tiempoMaximo = opciones.tiempoMaximo ?? TIEMPO_MAXIMO;
    this.tiempoMaximoTexto = opciones.tiempoMaximoTexto ?? TIEMPO_MAXIMO_TEXTO;
  }

  get modeloEnUso(): string {
    return this.modeloImagen;
  }

  /**
   * Mira la imagen de una referencia y sugiere su nombre y su prompt. Con salida
   * estructurada (JSON Schema estricto): la respuesta trae justo esos dos campos.
   */
  async describirReferencia(imagen: Buffer): Promise<ResultadoDescripcion> {
    const respuesta = await this.llamar(
      '/responses',
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modeloTexto,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: INSTRUCCIONES_REFERENCIA },
                {
                  type: 'input_image',
                  image_url: `data:image/jpeg;base64,${imagen.toString('base64')}`,
                },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'referencia_de_escena',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['nombre', 'prompt'],
                properties: {
                  nombre: { type: 'string', description: 'De 2 a 5 palabras.' },
                  prompt: { type: 'string', description: 'De 2 a 4 frases.' },
                },
              },
            },
          },
          max_output_tokens: 800,
        }),
      },
      this.tiempoMaximoTexto,
    );
    if (!respuesta.ok) return respuesta;

    const salida = (respuesta.cuerpo as { output?: unknown[] } | null)?.output ?? [];
    const partes = salida.flatMap((item) => {
      const mensaje = item as { type?: unknown; content?: unknown[] };
      return mensaje.type === 'message' && Array.isArray(mensaje.content) ? mensaje.content : [];
    }) as { type?: unknown; text?: unknown; refusal?: unknown }[];
    if (partes.some((parte) => parte.type === 'refusal')) {
      return {
        ok: false,
        tipo: 'moderacion',
        mensaje: 'La IA no quiso describir esta imagen. Escribe el nombre y el prompt a mano.',
        detalle: `Rechazo: ${texto(partes.find((p) => p.type === 'refusal')?.refusal)}`,
      };
    }
    const json = texto(partes.find((parte) => parte.type === 'output_text')?.text);
    try {
      const { nombre, prompt } = JSON.parse(json) as { nombre?: unknown; prompt?: unknown };
      const limpio = (valor: unknown, largo: number) => texto(valor).trim().slice(0, largo).trim();
      const sugerencia = {
        nombre: limpio(nombre, LARGO_NOMBRE),
        prompt: limpio(prompt, LARGO_PROMPT),
      };
      if (!sugerencia.nombre || !sugerencia.prompt) throw new Error('Campos vacíos');
      return { ok: true, ...sugerencia };
    } catch (error) {
      return {
        ok: false,
        tipo: 'servicio',
        mensaje: 'La IA no devolvió una sugerencia que se pueda usar. Escríbela a mano.',
        detalle: `Respuesta inválida (${String(error)}): ${json.slice(0, 200)}`,
      };
    }
  }

  /** Hace la petición y separa el éxito (con su JSON) de un fallo ya explicado. */
  private async llamar(
    ruta: string,
    { headers, body }: { headers?: Record<string, string>; body: BodyInit },
    tiempoMaximo: number,
  ): Promise<
    { readonly ok: true; readonly cuerpo: unknown } | ({ readonly ok: false } & FalloOpenAi)
  > {
    let respuesta: Response;
    try {
      respuesta = await this.pedir(`${this.base}${ruta}`, {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${this.llave}` },
        body,
        signal: AbortSignal.timeout(tiempoMaximo),
      });
    } catch (error) {
      const agotado = error instanceof Error && error.name === 'TimeoutError';
      return {
        ok: false,
        tipo: 'servicio',
        mensaje: agotado
          ? `OpenAI tardó más de ${duracion(tiempoMaximo)} y se dejó de esperar. Intenta de nuevo.`
          : 'No se pudo hablar con OpenAI. Revisa la conexión del servidor e intenta de nuevo.',
        detalle: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }
    const cuerpo: unknown = await respuesta.json().catch(() => null);
    if (!respuesta.ok) return { ok: false, ...clasificarError(respuesta.status, cuerpo) };
    return { ok: true, cuerpo };
  }

  async editar({ imagenes, prompt, calidad }: PeticionEdicion): Promise<ResultadoEdicion> {
    const formulario = new FormData();
    formulario.append('model', this.modeloImagen);
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

    const respuesta = await this.llamar('/images/edits', { body: formulario }, this.tiempoMaximo);
    if (!respuesta.ok) return respuesta;
    const base64 = (respuesta.cuerpo as { data?: { b64_json?: unknown }[] } | null)?.data?.[0]
      ?.b64_json;
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
