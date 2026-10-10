import type { Provider } from '@nestjs/common';
import { ENTORNO, type Entorno } from '../config/entorno.js';
import { ClienteOpenAi } from './cliente-openai.js';

/** El cliente de OpenAI, o `null` si no hay `OPENAI_API_KEY`. */
export interface OpenAi {
  readonly cliente: ClienteOpenAi | null;
}

export const OPENAI = Symbol('OPENAI');

export const proveedorOpenAi: Provider = {
  provide: OPENAI,
  inject: [ENTORNO],
  useFactory: (entorno: Entorno): OpenAi => ({
    cliente: entorno.OPENAI_API_KEY
      ? new ClienteOpenAi({
          llave: entorno.OPENAI_API_KEY,
          base: entorno.OPENAI_URL_BASE,
          modeloImagen: entorno.OPENAI_MODELO_IMAGEN,
          modeloTexto: entorno.OPENAI_MODELO_TEXTO,
        })
      : null,
  }),
};
