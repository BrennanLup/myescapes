CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"country" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_puzzles" (
	"day" date PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"seed" text NOT NULL,
	"max_guesses" integer DEFAULT 6 NOT NULL,
	"game_id" text,
	"theme" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_puzzles_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "daily_results" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"number" integer NOT NULL,
	"time_zone" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"solved" boolean DEFAULT false NOT NULL,
	"guesses" integer DEFAULT 0 NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"time_ms" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"grid" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"status" text NOT NULL,
	"requested_by" text NOT NULL,
	"blocked_by" text,
	"a_auto_accepts" boolean DEFAULT false NOT NULL,
	"b_auto_accepts" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friendships_order_ck" CHECK ("friendships"."user_a" < "friendships"."user_b")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"genre" text,
	"min_players" integer,
	"max_players" integer,
	"duration_minutes" integer,
	"description" text,
	"website" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"inviter_id" text NOT NULL,
	"guest_name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" text,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"visit_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"visit_id" text NOT NULL,
	"author_id" text NOT NULL,
	"overall_score" integer NOT NULL,
	"overall_comment" text DEFAULT '' NOT NULL,
	"puzzles_score" integer NOT NULL,
	"puzzles_comment" text DEFAULT '' NOT NULL,
	"setting_score" integer NOT NULL,
	"setting_comment" text DEFAULT '' NOT NULL,
	"storyline_score" integer NOT NULL,
	"storyline_comment" text DEFAULT '' NOT NULL,
	"difficulty_score" integer NOT NULL,
	"difficulty_comment" text DEFAULT '' NOT NULL,
	"transcript" text DEFAULT '' NOT NULL,
	"memorable_puzzle_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"contains_spoilers" boolean DEFAULT false NOT NULL,
	"scores_copied" boolean DEFAULT false NOT NULL,
	"copied_from_review_id" text,
	"hidden_at" timestamp with time zone,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_scores_ck" CHECK ("reviews"."overall_score" between 1 and 100 and "reviews"."puzzles_score" between 1 and 100 and "reviews"."setting_score" between 1 and 100 and "reviews"."storyline_score" between 1 and 100 and "reviews"."difficulty_score" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"license" text NOT NULL,
	"attribution" text DEFAULT '' NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"subject" text NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_subject_day_kind_pk" PRIMARY KEY("subject","day","kind")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handle" text,
	"display_name" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"onboarded_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"address" text DEFAULT '' NOT NULL,
	"city" text NOT NULL,
	"city_slug" text NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"country" text NOT NULL,
	"postal_code" text,
	"lat" double precision,
	"lng" double precision,
	"website" text,
	"phone" text,
	"google_place_id" text,
	"fsq_id" text,
	"osm_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_edits" (
	"id" text PRIMARY KEY NOT NULL,
	"visit_id" text NOT NULL,
	"editor_id" text,
	"editor_name" text DEFAULT '' NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"visit_id" text NOT NULL,
	"user_id" text,
	"guest_name" text,
	"status" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "visit_participants_who_ck" CHECK ("visit_participants"."user_id" is not null or "visit_participants"."guest_name" is not null)
);
--> statement-breakpoint
CREATE TABLE "visit_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"visit_id" text NOT NULL,
	"uploader_id" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"caption" text DEFAULT '' NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_puzzles" (
	"id" text PRIMARY KEY NOT NULL,
	"visit_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"type" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"date" date NOT NULL,
	"created_by" text,
	"escaped" boolean,
	"escape_time_minutes" real,
	"visible_timer" boolean,
	"multi_room" boolean,
	"flashlights" boolean,
	"live_actors" boolean,
	"tools_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legacy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"added_by" text DEFAULT '' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"game_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD CONSTRAINT "daily_puzzles_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_results" ADD CONSTRAINT "daily_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_edits" ADD CONSTRAINT "visit_edits_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_edits" ADD CONSTRAINT "visit_edits_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_participants" ADD CONSTRAINT "visit_participants_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_participants" ADD CONSTRAINT "visit_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_participants" ADD CONSTRAINT "visit_participants_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_puzzles" ADD CONSTRAINT "visit_puzzles_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_puzzles" ADD CONSTRAINT "visit_puzzles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_uq" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "cities_country_idx" ON "cities" USING btree ("country");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_results_user_day_uq" ON "daily_results" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "daily_results_day_idx" ON "daily_results" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_uq" ON "friendships" USING btree ("user_a","user_b");--> statement-breakpoint
CREATE INDEX "friendships_b_idx" ON "friendships" USING btree ("user_b");--> statement-breakpoint
CREATE INDEX "games_venue_idx" ON "games" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_venue_name_uq" ON "games" USING btree ("venue_id",lower("name"));--> statement-breakpoint
CREATE INDEX "games_name_trgm" ON "games" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invites_inviter_idx" ON "invites" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_visit_author_uq" ON "reviews" USING btree ("visit_id","author_id");--> statement-breakpoint
CREATE INDEX "reviews_author_idx" ON "reviews" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_entity_source_uq" ON "sources" USING btree ("entity_type","entity_id","source","source_id");--> statement-breakpoint
CREATE INDEX "sources_entity_idx" ON "sources" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_lower_uq" ON "users" USING btree (lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX "venues_fsq_uq" ON "venues" USING btree ("fsq_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_osm_uq" ON "venues" USING btree ("osm_id");--> statement-breakpoint
CREATE INDEX "venues_city_idx" ON "venues" USING btree ("country","city_slug");--> statement-breakpoint
CREATE INDEX "venues_latlng_idx" ON "venues" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "venues_name_trgm" ON "venues" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "visit_edits_visit_idx" ON "visit_edits" USING btree ("visit_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_participants_user_uq" ON "visit_participants" USING btree ("visit_id","user_id");--> statement-breakpoint
CREATE INDEX "visit_participants_user_idx" ON "visit_participants" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "visit_participants_guest_idx" ON "visit_participants" USING btree (lower("guest_name"));--> statement-breakpoint
CREATE INDEX "visit_photos_visit_idx" ON "visit_photos" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "visit_puzzles_visit_idx" ON "visit_puzzles" USING btree ("visit_id","position");--> statement-breakpoint
CREATE INDEX "visits_game_date_idx" ON "visits" USING btree ("game_id","date");--> statement-breakpoint
CREATE INDEX "visits_created_by_idx" ON "visits" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_legacy_uq" ON "visits" USING btree ("created_by","legacy_id");--> statement-breakpoint
CREATE INDEX "wishlist_user_idx" ON "wishlist_items" USING btree ("user_id","priority");