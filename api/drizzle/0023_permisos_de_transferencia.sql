-- Escrita a mano: permisos de la tabla de datos de transferencia.
--
-- Desde la 0006, una tabla nueva nace solo con SELECT para gestion_app. Esta
-- tiene una sola fila: se crea la primera vez que se guardan los datos y después
-- solo se actualiza. Quitar el QR es un UPDATE que lo deja en NULL.
GRANT INSERT, UPDATE ON gestion.datos_transferencia TO gestion_app;--> statement-breakpoint
