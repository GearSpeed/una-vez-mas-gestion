import { StreamableFile } from '@nestjs/common';

export interface ColumnaCsv<T> {
  readonly titulo: string;
  readonly valor: (fila: T) => string | number | null | undefined;
}

/**
 * CSV que Excel abre bien en español: BOM para los acentos, fin de línea CRLF.
 * Un texto que empiece con = + - @ se antepone con ' para que Excel no lo
 * ejecute como fórmula.
 */
export function aCsv<T>(filas: readonly T[], columnas: readonly ColumnaCsv<T>[]): string {
  const lineas = [
    columnas.map((c) => celda(c.titulo)).join(','),
    ...filas.map((fila) => columnas.map((c) => celda(c.valor(fila))).join(',')),
  ];
  return `﻿${lineas.join('\r\n')}\r\n`;
}

function celda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor);
  if (typeof valor === 'string' && /^[=+\-@]/.test(texto) && Number.isNaN(Number(texto)))
    texto = `'${texto}`;
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** Respuesta de descarga: Nest pone las cabeceras. */
export function archivoCsv(nombre: string, contenido: string): StreamableFile {
  return new StreamableFile(Buffer.from(contenido, 'utf8'), {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${nombre}"`,
  });
}
