import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { ENTORNO, type Entorno } from '../config/entorno.js';

/**
 * De quién es la petición. En producción lo dice Cloudflare Access: cada
 * petición que pasó por Access trae un JWT firmado en `Cf-Access-Jwt-Assertion`,
 * y aquí se verifica la firma, el emisor (el team) y la audiencia (la app).
 * Nunca se confía en un correo que venga en claro.
 *
 * En desarrollo no hay Access: el correo sale de `X-Dev-Correo` o de DEV_CORREO.
 */
@Injectable()
export class IdentidadService {
  private readonly llaves: JWTVerifyGetKey | null;

  constructor(@Inject(ENTORNO) private readonly entorno: Entorno) {
    this.llaves =
      entorno.AUTH_MODO === 'access' && entorno.CF_ACCESS_TEAM
        ? createRemoteJWKSet(new URL('/cdn-cgi/access/certs', entorno.CF_ACCESS_TEAM))
        : null;
  }

  get modoDesarrollo(): boolean {
    return this.entorno.AUTH_MODO === 'desarrollo';
  }

  async correoDe(solicitud: Request): Promise<string> {
    if (this.modoDesarrollo) {
      const correo = solicitud.header('x-dev-correo') ?? this.entorno.DEV_CORREO;
      if (!correo)
        throw new UnauthorizedException('Modo desarrollo sin DEV_CORREO ni cabecera X-Dev-Correo.');
      return correo.trim().toLowerCase();
    }

    const token = solicitud.header('cf-access-jwt-assertion');
    if (!token || !this.llaves)
      throw new UnauthorizedException('Falta la identidad de Cloudflare Access.');
    try {
      const { payload } = await jwtVerify(token, this.llaves, {
        issuer: this.entorno.CF_ACCESS_TEAM,
        audience: this.entorno.CF_ACCESS_AUD,
      });
      const correo = payload['email'];
      if (typeof correo !== 'string' || correo === '') throw new Error('El token no trae correo');
      return correo.toLowerCase();
    } catch {
      throw new UnauthorizedException('La identidad de Cloudflare Access no es válida.');
    }
  }
}
