CREATE TABLE "gestion"."datos_transferencia" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"banco" text NOT NULL,
	"titular" text NOT NULL,
	"clabe" text NOT NULL,
	"qr" "bytea",
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "datos_transferencia_una_fila" CHECK (id = 1),
	CONSTRAINT "datos_transferencia_clabe" CHECK (clabe ~ '^[0-9]{18}$')
);
