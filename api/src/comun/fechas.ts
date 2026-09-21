import { UnprocessableEntityException } from '@nestjs/common';
import { fechaDeHoy } from '@uvm/compartido';

/** La fecha del documento, o hoy. Nunca en el futuro. */
export function fechaDelDocumento(fecha: string | undefined): string {
  const hoy = fechaDeHoy();
  if (fecha === undefined) return hoy;
  if (fecha > hoy) {
    throw new UnprocessableEntityException({
      mensaje: 'La fecha no puede ser futura.',
      campos: { fecha: 'No puede ser futura' },
    });
  }
  return fecha;
}
