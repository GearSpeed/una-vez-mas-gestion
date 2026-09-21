You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `computed()` for derived state
- Set `changeDetection: ChangeDetectionStrategy.OnPush` in `@Component` decorator
- Prefer inline templates for small components
- Prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Use the `inject()` function instead of constructor injection

## Este repo

- npm workspaces: `compartido/` (permisos, esquemas Zod, tipos y cuentas), `api/`
  (NestJS + Drizzle + PostgreSQL 18) y `web/` (Angular 22 + Angular Material).
- Todo en español: identificadores, comentarios, mensajes de error y textos de la UI.
- Nada sensible en el repo: ni el `.xlsx`, ni `.env`, ni costos, precios o proveedores
  reales (tampoco en la semilla ni en las pruebas).

## Cuentas y dinero

- Dinero y costos viajan como texto decimal (`Decimal = string`). Las cuentas se hacen
  con las funciones de `compartido/src/calculos.ts` (big.js), nunca con `number`.
- La API y el front usan las mismas funciones: si una regla de cálculo cambia, cambia en
  `compartido` y se prueba ahí contra los números del Excel.

## Back (NestJS)

- Toda ruta declara `@RequierePermiso(...)`, `@Autenticado()` o `@Publico()`. Si no
  declara nada, el guard la niega.
- Todo cambio de existencias pasa por `MovimientosService.aplicar()` dentro de la
  transacción del documento. Nunca se escribe `existencias` ni `movimientos` a mano.
- Costos, márgenes y utilidad solo van dentro de un campo `costos`, armado con
  `conCostos()`: la API filtra, no la pantalla.
- Entradas validadas con los esquemas de `compartido` (`new Validar(esquema)`); los
  errores salen como `{ mensaje, campos }` en español.
- Documentos con `claveIdempotencia` y `conIdempotencia()`.
- Migraciones: `npm run generar-migracion -w api`. Una migración aplicada no se edita.
  Permisos de Postgres y vistas van en migraciones escritas a mano (`--custom`).
- La vista `publico.catalogo` es un contrato con el back del sitio: ver
  `docs/contrato-sitio.md` antes de tocarla.

## Pruebas

- `npm test`: unitarias de los tres paquetes.
- `npm run test:integracion`: la API contra PostgreSQL 18 con Testcontainers (Docker).
  Con el motor del sistema: `DOCKER_HOST=unix:///var/run/docker.sock`.
- `npm run e2e`: Playwright + axe (WCAG 2.1 AA) en escritorio y celular. Una pantalla
  nueva se agrega a `web/e2e/accesibilidad.spec.ts`.
