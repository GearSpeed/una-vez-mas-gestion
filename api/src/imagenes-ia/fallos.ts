import { HttpException } from '@nestjs/common';
import type { FalloOpenAi } from './cliente-openai.js';

export const SIN_LLAVE = 'Falta configurar la llave de OpenAI (OPENAI_API_KEY) en el servidor.';

/** Con qué estado HTTP sale cada fallo de OpenAI cuando se responde en el momento. */
const ESTADO_DEL_FALLO: Readonly<Record<FalloOpenAi['tipo'], number>> = {
  sin_creditos: 402,
  limite: 429,
  llave: 502,
  moderacion: 422,
  servicio: 502,
};

/** Un fallo de OpenAI como respuesta HTTP, con su mensaje en español. */
export function falloHttp(fallo: FalloOpenAi): HttpException {
  return new HttpException(
    { mensaje: fallo.mensaje, tipo: fallo.tipo },
    ESTADO_DEL_FALLO[fallo.tipo],
  );
}
