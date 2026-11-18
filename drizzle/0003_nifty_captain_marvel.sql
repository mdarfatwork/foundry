CREATE TABLE "verification_run" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"generation_job_id" text,
	"runtime_session_id" text,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"diagnostics" text,
	"stage_metrics" text,
	"repair_attempts" integer DEFAULT 0 NOT NULL,
	"repair_success" boolean,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification_run" ADD CONSTRAINT "verification_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_run_project_id_idx" ON "verification_run" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "verification_run_status_idx" ON "verification_run" USING btree ("status");