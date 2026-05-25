-- Branded short links: /s/<code> 302-redirects to the long signed /j/<token>
-- URL, so driver/exec messages carry a clean link. The code is opaque; the
-- token still gates access at /j.
CREATE TABLE "short_links" (
	"code" text PRIMARY KEY NOT NULL,
	"destination" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
