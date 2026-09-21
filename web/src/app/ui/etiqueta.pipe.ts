import { Pipe, type PipeTransform } from '@angular/core';
import {
  ETIQUETAS_CANAL,
  ETIQUETAS_ESTADO,
  ETIQUETAS_METODO_PAGO,
  ETIQUETAS_MOTIVO,
  ETIQUETAS_MOVIMIENTO,
  ETIQUETAS_UBICACION,
} from '@uvm/compartido';

const CATALOGOS = {
  canal: ETIQUETAS_CANAL,
  metodo: ETIQUETAS_METODO_PAGO,
  estado: ETIQUETAS_ESTADO,
  movimiento: ETIQUETAS_MOVIMIENTO,
  motivo: ETIQUETAS_MOTIVO,
  ubicacion: ETIQUETAS_UBICACION,
} as const;

/** `{{ venta.canal | etiqueta: 'canal' }}` → "WhatsApp". */
@Pipe({ name: 'etiqueta' })
export class EtiquetaPipe implements PipeTransform {
  transform(valor: string | null | undefined, catalogo: keyof typeof CATALOGOS): string {
    if (!valor) return '';
    return (CATALOGOS[catalogo] as Readonly<Record<string, string>>)[valor] ?? valor;
  }
}
