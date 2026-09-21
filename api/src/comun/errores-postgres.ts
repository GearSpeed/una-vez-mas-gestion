/** Lo que interesa de un error de Postgres. Drizzle lo envuelve en `cause`. */
export interface ErrorPostgres {
  readonly code: string;
  readonly constraint?: string;
}

export function errorDePostgres(error: unknown): ErrorPostgres | null {
  let actual: unknown = error;
  for (let nivel = 0; nivel < 5 && typeof actual === 'object' && actual !== null; nivel++) {
    const posible = actual as { code?: unknown; cause?: unknown };
    if (typeof posible.code === 'string' && /^[0-9A-Z]{5}$/.test(posible.code)) {
      return posible as ErrorPostgres;
    }
    actual = posible.cause;
  }
  return null;
}

export function esViolacionUnica(error: unknown, restriccion: string): boolean {
  const pg = errorDePostgres(error);
  return pg?.code === '23505' && (pg.constraint?.includes(restriccion) ?? false);
}
