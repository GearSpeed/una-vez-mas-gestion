CREATE TABLE "gestion"."qr_transferencia" (
	"posicion" integer PRIMARY KEY NOT NULL,
	"titulo" text NOT NULL,
	"imagen" "bytea" NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_transferencia_posicion" CHECK (posicion in (1, 2))
);
