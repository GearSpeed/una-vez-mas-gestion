ALTER TABLE "gestion"."gastos" ADD COLUMN "vendedor_id" integer;--> statement-breakpoint
ALTER TABLE "gestion"."gastos" ADD CONSTRAINT "gastos_vendedor_id_usuarios_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gastos_vendedor" ON "gestion"."gastos" USING btree ("vendedor_id");