-- Escrita a mano: pasar lo que ya existe a las tablas de pagos, dar los permisos y
-- hasta entonces quitar la columna vieja.
--
-- Hasta ahora una venta tenía un solo método de pago. Las ventas anteriores se
-- traspasan tal cual: un renglón con su método, su total y su comisión.

-- 1. Cada venta con su único pago. Las de total 0 (todo descuento) no llevan
--    renglón: `venta_pagos.importe` exige que sea mayor que cero, y cero pagos
--    suman cero, que es justo su total.
INSERT INTO gestion.venta_pagos (venta_id, metodo_pago, importe, comision)
SELECT v.id, v.metodo_pago, v.total, v.comision
FROM gestion.ventas v
WHERE v.total > 0;--> statement-breakpoint

-- 2. Cada devolución regresó por el mismo método con que se pagó la venta.
INSERT INTO gestion.devolucion_pagos (devolucion_id, metodo_pago, importe)
SELECT d.id, v.metodo_pago, d.reembolso
FROM gestion.devoluciones d
JOIN gestion.ventas v ON v.id = d.venta_id;--> statement-breakpoint

-- 3. Permisos. Desde la 0006 las tablas nuevas nacen solo con SELECT para
--    gestion_app, así que la escritura se concede tabla por tabla. Estas dos son de
--    solo agregar: un cobro registrado no se corrige, se cancela la venta.
GRANT INSERT ON gestion.venta_pagos TO gestion_app;--> statement-breakpoint
GRANT INSERT ON gestion.devolucion_pagos TO gestion_app;--> statement-breakpoint

-- 4. Ya con los datos a salvo, la columna se va: la verdad son los renglones.
ALTER TABLE gestion.ventas DROP COLUMN metodo_pago;
