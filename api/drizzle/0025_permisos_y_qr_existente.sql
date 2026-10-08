-- Escrita a mano: permisos de la tabla de QR y el paso del QR que ya había.
--
-- Desde la 0006, una tabla nueva nace solo con SELECT para gestion_app. Aquí se
-- suben, se cambian de título y se quitan QR, así que hacen falta los tres.
GRANT INSERT, UPDATE, DELETE ON gestion.qr_transferencia TO gestion_app;--> statement-breakpoint
-- El QR que ya estaba subido no se pierde: pasa a ser el primero, titulado con el
-- banco de la cuenta. La siguiente migración quita la columna vieja.
INSERT INTO gestion.qr_transferencia (posicion, titulo, imagen)
SELECT 1, left(banco, 40), qr FROM gestion.datos_transferencia WHERE qr IS NOT NULL;
