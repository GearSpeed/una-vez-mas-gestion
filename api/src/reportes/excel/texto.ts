/** Lo más largo que cabe en una celda de Excel. */
const LARGO_MAXIMO = 32_767;

// Caracteres de control que XML 1.0 no admite: con uno solo, Excel pide «reparar» el libro.
// oxlint-disable-next-line no-control-regex
const INVALIDOS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Texto listo para ir dentro de un elemento o atributo XML. */
export function escaparXml(texto: string): string {
  return texto
    .replace(INVALIDOS, '')
    .slice(0, LARGO_MAXIMO)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
