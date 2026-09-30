-- Escrita a mano: permisos de las tablas de capital.
--
-- Desde la 0006, una tabla nueva nace solo con SELECT para gestion_app: la
-- escritura se concede tabla por tabla, a propósito.

-- Un socio se da de alta y se puede dar de baja (activo = false), nunca se borra:
-- sus movimientos siguen colgando de él.
GRANT INSERT, UPDATE ON gestion.socios TO gestion_app;--> statement-breakpoint

-- Un movimiento de capital tampoco se edita ni se borra: se cancela, y eso es un
-- UPDATE sobre su propio renglón.
GRANT INSERT, UPDATE ON gestion.movimientos_capital TO gestion_app;--> statement-breakpoint
