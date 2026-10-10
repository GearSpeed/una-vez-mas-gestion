import { describe, expect, it, vi } from 'vitest';
import { ClienteOpenAi, clasificarError } from './cliente-openai.js';

const error = (code: string | null, type = 'invalid_request_error', message = 'algo') => ({
  error: { code, type, message },
});

describe('clasificarError', () => {
  it.each([
    [429, error('credit_balance_exhausted', 'insufficient_quota')],
    [429, error(null, 'insufficient_quota')],
    [429, error('insufficient_quota', 'insufficient_quota')],
    [429, error('organization_spend_limit_exceeded')],
    [429, error('project_spend_limit_exceeded')],
    [429, error('organization_usage_limit_exceeded')],
    [400, error('billing_hard_limit_reached')],
  ])('%i %j: se acabaron los créditos, no es un error cualquiera', (estado, cuerpo) => {
    const fallo = clasificarError(estado, cuerpo);
    expect(fallo.tipo).toBe('sin_creditos');
    expect(fallo.mensaje).toMatch(/créditos de OpenAI/);
  });

  it('un 429 de ritmo pide esperar', () => {
    expect(clasificarError(429, error('rate_limit_exceeded', 'requests')).tipo).toBe('limite');
    expect(clasificarError(429, error('slow_down', 'rate_limit_error')).tipo).toBe('limite');
  });

  it('la moderación se explica aparte', () => {
    const fallo = clasificarError(400, error('moderation_blocked', 'image_generation_user_error'));
    expect(fallo.tipo).toBe('moderacion');
  });

  it('una llave mala o sin acceso', () => {
    expect(clasificarError(401, error('invalid_api_key')).tipo).toBe('llave');
    expect(clasificarError(403, error(null)).tipo).toBe('llave');
  });

  it('una petición que OpenAI no aceptó trae su motivo', () => {
    const fallo = clasificarError(400, error('invalid_value', undefined, 'Invalid model'));
    expect(fallo).toMatchObject({ tipo: 'servicio' });
    expect(fallo.mensaje).toContain('Invalid model');
  });

  it('un 500, un 503 o una respuesta sin JSON: el servicio', () => {
    expect(clasificarError(500, null).tipo).toBe('servicio');
    expect(clasificarError(503, error('server_is_overloaded')).tipo).toBe('servicio');
  });
});

describe('ClienteOpenAi', () => {
  const imagenes = [
    { datos: Buffer.from('ref'), nombre: 'referencia.jpg', tipo: 'image/jpeg' as const },
    { datos: Buffer.from('foto'), nombre: 'producto.jpg', tipo: 'image/jpeg' as const },
  ];

  it('manda las dos imágenes en orden con el prompt, y regresa el PNG', async () => {
    const pedir = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }),
    );
    const cliente = new ClienteOpenAi(
      'sk-prueba',
      'https://api.example.test/v1',
      'modelo-x',
      pedir,
    );
    const resultado = await cliente.editar({ imagenes, prompt: 'Una mesa', calidad: 'media' });

    expect(resultado).toEqual({ ok: true, png: Buffer.from('png') });
    const [url, opciones] = pedir.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.test/v1/images/edits');
    expect(opciones?.headers).toEqual({ Authorization: 'Bearer sk-prueba' });
    const cuerpo = opciones?.body as FormData;
    expect(cuerpo.get('model')).toBe('modelo-x');
    expect(cuerpo.get('prompt')).toBe('Una mesa');
    expect(cuerpo.get('quality')).toBe('medium');
    const enviadas = cuerpo.getAll('image[]') as File[];
    expect(enviadas.map((f) => f.name)).toEqual(['referencia.jpg', 'producto.jpg']);
    expect(await enviadas[1]?.text()).toBe('foto');
  });

  it('sin créditos regresa el fallo clasificado, sin lanzar', async () => {
    const pedir = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: 'credit_balance_exhausted', type: 'insufficient_quota', message: 'x' } },
        { status: 429 },
      ),
    );
    const cliente = new ClienteOpenAi('sk', 'https://x.test/v1', 'm', pedir);
    const resultado = await cliente.editar({ imagenes, prompt: 'p', calidad: 'baja' });
    expect(resultado).toMatchObject({ ok: false, tipo: 'sin_creditos' });
  });

  it('si OpenAI no contesta a tiempo, se deja de esperar', async () => {
    const pedir = vi.fn<typeof fetch>(
      (_url, opciones) =>
        new Promise((_resuelve, rechaza) => {
          opciones?.signal?.addEventListener('abort', () => rechaza(opciones.signal?.reason));
        }),
    );
    const cliente = new ClienteOpenAi('sk', 'https://x.test/v1', 'm', pedir, 20);
    const resultado = await cliente.editar({ imagenes, prompt: 'p', calidad: 'alta' });
    expect(resultado).toMatchObject({ ok: false, tipo: 'servicio' });
    if (!resultado.ok) expect(resultado.mensaje).toMatch(/5 minutos/);
  });

  it('la llave nunca sale en el detalle del error', async () => {
    const pedir = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    const cliente = new ClienteOpenAi('sk-secreta', 'https://x.test/v1', 'm', pedir);
    const resultado = await cliente.editar({ imagenes, prompt: 'p', calidad: 'media' });
    expect(JSON.stringify(resultado)).not.toContain('sk-secreta');
  });
});
