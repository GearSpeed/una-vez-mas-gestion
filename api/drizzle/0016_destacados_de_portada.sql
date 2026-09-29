ALTER TABLE "gestion"."productos" ADD COLUMN "destacado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."productos" ADD COLUMN "destacado_etiqueta" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."productos" ADD COLUMN "destacado_quip" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."productos" ADD COLUMN "destacado_texto" text DEFAULT '' NOT NULL;