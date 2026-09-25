CREATE TABLE "gestion"."devolucion_pagos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."devolucion_pagos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"devolucion_id" integer NOT NULL,
	"metodo_pago" "gestion"."metodo_pago" NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	CONSTRAINT "devolucion_pagos_metodo" UNIQUE("devolucion_id","metodo_pago"),
	CONSTRAINT "devolucion_pagos_importe" CHECK (importe >= 0)
);
--> statement-breakpoint
CREATE TABLE "gestion"."venta_pagos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."venta_pagos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"venta_id" integer NOT NULL,
	"metodo_pago" "gestion"."metodo_pago" NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"comision" numeric(12, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "venta_pagos_metodo" UNIQUE("venta_id","metodo_pago"),
	CONSTRAINT "venta_pagos_importe" CHECK (importe > 0),
	CONSTRAINT "venta_pagos_comision" CHECK (comision >= 0 and comision <= importe)
);
--> statement-breakpoint
ALTER TABLE "gestion"."devolucion_pagos" ADD CONSTRAINT "devolucion_pagos_devolucion_id_devoluciones_id_fk" FOREIGN KEY ("devolucion_id") REFERENCES "gestion"."devoluciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."venta_pagos" ADD CONSTRAINT "venta_pagos_venta_id_ventas_id_fk" FOREIGN KEY ("venta_id") REFERENCES "gestion"."ventas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devolucion_pagos_devolucion" ON "gestion"."devolucion_pagos" USING btree ("devolucion_id");--> statement-breakpoint
CREATE INDEX "venta_pagos_venta" ON "gestion"."venta_pagos" USING btree ("venta_id");