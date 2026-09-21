import {
  BadRequestException,
  type PipeTransform,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { z } from 'zod';

/**
 * Valida el cuerpo o la query con un esquema de `@uvm/compartido`. Si falla,
 * responde 422 con el primer error de cada campo, listo para marcarlo en el
 * formulario: `{ mensaje, campos: { "lineas.0.cantidad": "…" } }`.
 */
export class Validar<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly esquema: T) {}

  transform(valor: unknown): z.output<T> {
    const resultado = this.esquema.safeParse(valor);
    if (resultado.success) return resultado.data;

    const campos: Record<string, string> = {};
    for (const problema of resultado.error.issues) {
      const ruta = problema.path.map(String).join('.') || '_';
      campos[ruta] ??= problema.message;
    }
    throw new UnprocessableEntityException({ mensaje: 'Revisa los datos marcados.', campos });
  }
}

/** Id de la ruta (`/ventas/:id`): entero positivo o 400. */
export class ParseId implements PipeTransform<string, number> {
  transform(valor: string): number {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('Id inválido.');
    return id;
  }
}
