-- Driver PCO (TfL private-hire) licence number, shown to the exec in the
-- confirmation/en-route emails. Nullable: drivers created before this feature
-- have none on file; the form requires it on every create/edit going forward,
-- so the roster backfills as drivers are touched.
ALTER TABLE "drivers" ADD COLUMN "pco_number" text;
