import { describe, expect, it } from 'vitest';
import { leerEntorno } from './entorno.js';

const BASE = { DATABASE_URL: 'postgres://x@localhost/gestion' };
/** Lo mínimo para que el esquema valide sin hablar de Access. */
const DESARROLLO = { ...BASE, AUTH_MODO: 'desarrollo' };

describe('configuración del servidor', () => {
  it('con Access exige el team y la audiencia', () => {
    expect(() => leerEntorno({ ...BASE, AUTH_MODO: 'access' })).toThrow(/CF_ACCESS_TEAM/);
  });

  it('no acepta las llaves de Access por http fuera de la propia máquina', () => {
    const entorno = {
      ...BASE,
      AUTH_MODO: 'access',
      CF_ACCESS_TEAM: 'http://equipo.cloudflareaccess.com',
      CF_ACCESS_AUD: 'aud',
    };
    // Por http, quien esté en el camino sirve sus llaves y firma cualquier correo.
    expect(() => leerEntorno(entorno)).toThrow(/https/);
    expect(() =>
      leerEntorno({ ...entorno, CF_ACCESS_TEAM: 'https://equipo.cloudflareaccess.com' }),
    ).not.toThrow();
  });

  it('el modo desarrollo no arranca en producción', () => {
    expect(() => leerEntorno({ ...BASE, NODE_ENV: 'production', AUTH_MODO: 'desarrollo' })).toThrow(
      /desarrollo/,
    );
    expect(() => leerEntorno(DESARROLLO)).not.toThrow();
  });

  it('trae un límite de peticiones por omisión', () => {
    expect(leerEntorno(DESARROLLO).LIMITE_PETICIONES).toBe(300);
    expect(leerEntorno({ ...DESARROLLO, LIMITE_PETICIONES: '50' }).LIMITE_PETICIONES).toBe(50);
  });
});
