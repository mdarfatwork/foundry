CREATE TABLE "runtime_log" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"runtime_session_id" text NOT NULL,
	"operation_id" text,
	"level" text NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"details" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence_number" integer DEFAULT 0 NOT NULL,
	"process_exit_code" integer,
	"metadata" text
);
--> statement-breakpoint
ALTER TABLE "runtime_log" ADD CONSTRAINT "runtime_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_log" ADD CONSTRAINT "runtime_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_log_project_occurred_idx" ON "runtime_log" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "runtime_log_project_session_idx" ON "runtime_log" USING btree ("project_id","runtime_session_id");--> statement-breakpoint
CREATE INDEX "runtime_log_session_seq_idx" ON "runtime_log" USING btree ("runtime_session_id","sequence_number");--> statement-breakpoint
CREATE INDEX "runtime_log_project_level_idx" ON "runtime_log" USING btree ("project_id","level");