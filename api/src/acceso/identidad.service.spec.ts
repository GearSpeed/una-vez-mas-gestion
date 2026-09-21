import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leerEntorno } from '../config/entorno.js';
import { IdentidadService } from './identidad.service.js';

/** Una petición de Express mínima: solo lo que lee IdentidadService. */
function solicitudCon(cabeceras: Record<string, string>): Request {
  const minusculas = Object.fromEntries(
    Object.entries(cabeceras).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { header: (nombre: string) => minusculas[nombre.toLowerCase()] } as unknown as Request;
}

/**
 * La identidad sale de un JWT que firma Cloudflare Access. Aquí un servidor
 * local hace de Access: publica la llave pública en /cdn-cgi/access/certs y
 * firmamos tokens buenos y malos.
 */
describe('IdentidadService con Cloudflare Access', () => {
  const AUD = 'aud-de-la-app';
  let servidor: Server;
  let team: string;
  let llavePrivada: CryptoKey;
  let otraLlave: CryptoKey;
  let identidad: IdentidadService;

  beforeAll(async () => {
    const par = await generateKeyPair('RS256');
    llavePrivada = par.privateKey;
    otraLlave = (await generateKeyPair('RS256')).privateKey;
    const publica: JWK = { ...(await exportJWK(par.publicKey)), kid: 'llave-1', alg: 'RS256' };

    servidor = createServer((solicitud, respuesta) => {
      if (solicitud.url === '/cdn-cgi/access/certs') {
        respuesta.setHeader('Content-Type', 'application/json');
        respuesta.end(JSON.stringify({ keys: [publica] }));
      } else {
        respuesta.statusCode = 404;
        respuesta.end();
      }
    });
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
    team = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

    identidad = new IdentidadService(
      leerEntorno({
        DATABASE_URL: 'x',
        AUTH_MODO: 'access',
        CF_ACCESS_TEAM: team,
        CF_ACCESS_AUD: AUD,
      }),
    );
  });

  afterAll(() => {
    servidor.close();
  });

  interface OpcionesToken {
    correo?: string;
    audiencia?: string;
    emisor?: string;
    /** Segundos desde la época Unix, o relativo ("5m"). */
    expira?: number | string;
    llave?: CryptoKey;
  }

  function firmar({
    correo = 'Ana@Demo.local',
    audiencia = AUD,
    emisor = team,
    expira = '5m',
    llave = llavePrivada,
  }: OpcionesToken = {}): Promise<string> {
    return new SignJWT({ email: correo })
      .setProtectedHeader({ alg: 'RS256', kid: 'llave-1' })
      .setIssuer(emisor)
      .setAudience(audiencia)
      .setIssuedAt()
      .setExpirationTime(expira)
      .sign(llave);
  }

  it('acepta un token válido y devuelve el correo en minúsculas', async () => {
    const token = await firmar();
    await expect(
      identidad.correoDe(solicitudCon({ 'Cf-Access-Jwt-Assertion': token })),
    ).resolves.toBe('ana@demo.local');
  });

  it('ignora X-Dev-Correo cuando hay Access', async () => {
    await expect(
      identidad.correoDe(solicitudCon({ 'X-Dev-Correo': 'admin@demo.local' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each<[string, () => OpcionesToken]>([
    ['otra aplicación', () => ({ audiencia: 'otra-app' })],
    ['otro emisor', () => ({ emisor: 'https://intruso.cloudflareaccess.com' })],
    ['otra llave', () => ({ llave: otraLlave })],
    ['hace un minuto (vencido)', () => ({ expira: Math.floor(Date.now() / 1000) - 60 })],
  ])('rechaza un token de %s', async (_caso, opciones) => {
    const token = await firmar(opciones());
    await expect(
      identidad.correoDe(solicitudCon({ 'Cf-Access-Jwt-Assertion': token })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token alterado', async () => {
    const [cabecera, , firma] = (await firmar()).split('.');
    const cuerpoFalso = Buffer.from(
      JSON.stringify({ email: 'admin@demo.local', aud: AUD, iss: team }),
    ).toString('base64url');
    const token = `${cabecera}.${cuerpoFalso}.${firma}`;
    await expect(
      identidad.correoDe(solicitudCon({ 'Cf-Access-Jwt-Assertion': token })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
