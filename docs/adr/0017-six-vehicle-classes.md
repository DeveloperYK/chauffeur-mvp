# ADR 0017 — Drivers and bookings share JJ's six vehicle types

**Status:** Accepted (2026-09-20)

## Context

Bookings gained an optional free-text *requested car type* (#200), then a
quick-pick row and a "driver doesn't match" warning (#204). The roster still
classified drivers with the original four classes (Executive / Luxury / MPV /
Coach), so the warning had to map JJ's six types onto four classes: it could not
tell a 7-seater from an 8-seater and could not flag an electric-only request at
all.

## Decision

1. The `vehicle_class` enum becomes JJ's six vehicle types, in roster order:
   `executive` (Ex), `vip` (VIP – S Class), `mpv_s` (MPV S – 7 Seater),
   `mpv_l` (MPV L – 8 Seater), `e_car` (E Car – Electric Only), `coach` (C).
2. The booking's car-type quick-picks are generated from the same list
   (`CAR_TYPES` derives from `VEHICLE_CLASS_LABEL`), so ask and driver class are
   1:1 and the mismatch warning is exact.
3. **Every existing driver is remapped to `executive`** by the migration. The
   operator asked for this rather than guessing sizes from the old `mpv` value;
   they re-classify drivers by hand on the roster.
4. Postgres cannot drop enum values, so migration 0033 rebuilds the type
   (rename old → create new → alter column with `USING` → drop old). It runs
   inside the migrator's transaction, unlike `ADD VALUE`.
5. Older bookings may still carry the retired free-text names: `Luxury` is read
   as `vip`; a plain `MPV` is satisfied by either MPV size (no warning).

## Consequences

- Booking requested car type stays free text; only its quick-picks changed.
- `VEHICLE_CLASS_SHORT` (Executive / VIP / MPV S / MPV L / E Car / Coach) is
  used for pills and filter tabs; the full label everywhere there is room.
- The sheet's Car Type column falls back to the driver's full class label when
  no car type was requested, so historic rows read "Executive" etc. unchanged.
- Rollback: rebuild the enum the same way mapping `vip → luxury`,
  `mpv_s`/`mpv_l → mpv`, `e_car → executive`.
