-- ============================================================================
-- EXTEND asset_type ENUM to match every type the UI already offers.
-- ----------------------------------------------------------------------------
-- The Asset Registration form (and company_profiles.asset_types) let clients
-- pick construction_dealers / electronics / furnitures / heavy_equipment, but
-- the base enum only had ('property','vehicle','equipment','other'). That means
-- both the manual form AND the website-sync endpoint couldn't store those types.
-- Add them (idempotent) so multi-type dealers are first-class.
--
-- NOTE: ALTER TYPE ... ADD VALUE is additive and safe. On PG12+ it may run in a
-- transaction as long as the new value isn't USED in that same transaction — we
-- only add here, so this is fine.
-- ============================================================================

ALTER TYPE public.asset_type ADD VALUE IF NOT EXISTS 'construction_dealers';
ALTER TYPE public.asset_type ADD VALUE IF NOT EXISTS 'electronics';
ALTER TYPE public.asset_type ADD VALUE IF NOT EXISTS 'furnitures';
ALTER TYPE public.asset_type ADD VALUE IF NOT EXISTS 'heavy_equipment';
