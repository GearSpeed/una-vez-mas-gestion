-- Escrita a mano: permisos de las tablas de imágenes con IA.
--
-- Desde la 0006, una tabla nueva nace solo con SELECT para gestion_app. Nada se
-- borra: una referencia se desactiva, y una generación cambia de estado (y suelta
-- sus imágenes, que se ponen en NULL) con un UPDATE.
GRANT INSERT, UPDATE ON gestion.referencias_imagen TO gestion_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON gestion.imagenes_generadas TO gestion_app;
