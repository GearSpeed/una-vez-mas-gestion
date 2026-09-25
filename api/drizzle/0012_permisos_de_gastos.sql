-- Escrita a mano: permisos de las tablas de gastos y las categorías con las que
-- arranca el negocio.
--
-- Desde la 0006, una tabla nueva nace solo con SELECT para gestion_app: la
-- escritura se concede tabla por tabla, a propósito.

-- Un gasto no se edita ni se borra: se cancela, y eso es un UPDATE sobre su
-- propio renglón.
GRANT INSERT, UPDATE ON gestion.gastos TO gestion_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON gestion.gasto_categorias TO gestion_app;--> statement-breakpoint

-- Categorías para empezar. El negocio agrega o da de baja las que quiera.
INSERT INTO gestion.gasto_categorias (nombre, orden) VALUES
  ('Empaque', 1),
  ('Comisiones', 2),
  ('Servicios', 3),
  ('Publicidad y eventos', 4),
  ('Renta', 5),
  ('Otros', 6)
ON CONFLICT (nombre) DO NOTHING;
