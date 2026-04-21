-- Rapport threshold recalibration (2026-04-21)
-- Goal: slow 1→2 (was 1 session best-case → now ≥2), speed up 2→3 (~5
-- sessions typical) while keeping 3→4 around 11-14 typical. Pairs with
-- consolidate.ts lowering the per-session delta cap from ±0.2 to ±0.08.
--   Lv2 (0.45 OR 0.5)  — unchanged; with cap 0.08 one session can no
--                         longer reach 0.5 warmth from 0.3.
--   Lv3 (0.65/0.6)    → (0.55/0.55) — 5 sessions typical at +0.05 delta.
--   Lv4 (0.85/0.8)    — unchanged; ~11-14 sessions typical at +0.05 delta.
UPDATE `rapport_thresholds` SET `trust_min` = 0.55, `warmth_min` = 0.55, `combinator` = 'AND' WHERE `level` = 3;
