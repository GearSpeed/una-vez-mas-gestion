ALTER TABLE "gestion"."categorias" ADD COLUMN "descuento_desde1" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD COLUMN "descuento_tasa1" numeric(6, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD COLUMN "descuento_desde2" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD COLUMN "descuento_tasa2" numeric(6, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD CONSTRAINT "categorias_descuento_desde" CHECK (descuento_desde1 >= 0 and descuento_desde2 >= 0);--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD CONSTRAINT "categorias_descuento_tasa" CHECK (descuento_tasa1 between 0 and 0.5 and descuento_tasa2 between 0 and 0.5);