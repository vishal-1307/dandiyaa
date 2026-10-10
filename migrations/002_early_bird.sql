-- Requires 001_security.sql. No historical registration is repriced or deleted.
BEGIN;
SELECT pg_advisory_xact_lock(20261019);
-- Also upgrades the previously applied 1–4 order constraint without changing rows.
ALTER TABLE jmu_orders DROP CONSTRAINT IF EXISTS jmu_orders_quantity_check;
ALTER TABLE jmu_orders ADD CONSTRAINT jmu_orders_quantity_check CHECK(quantity BETWEEN 1 AND 10);
CREATE TABLE IF NOT EXISTS jmu_campaigns (
  campaign_key VARCHAR(80) PRIMARY KEY, config_hash CHAR(64) NOT NULL,
  max_units INTEGER NOT NULL CHECK(max_units=100), used_units INTEGER NOT NULL DEFAULT 0,
  unit_price INTEGER NOT NULL CHECK(unit_price=19900), regular_unit_price INTEGER NOT NULL CHECK(regular_unit_price=24900),
  CHECK(used_units BETWEEN 0 AND max_units)
);
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS promotion_key VARCHAR(80) REFERENCES jmu_campaigns(campaign_key);
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS promotion_units INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS promotion_expires_at TIMESTAMPTZ;
ALTER TABLE jmu_orders ADD COLUMN IF NOT EXISTS promotion_key VARCHAR(80) REFERENCES jmu_campaigns(campaign_key);
ALTER TABLE jmu_orders ADD COLUMN IF NOT EXISTS promotion_units INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jmu_orders ADD COLUMN IF NOT EXISTS promotion_expires_at TIMESTAMPTZ;
ALTER TABLE jmu_orders DROP CONSTRAINT IF EXISTS jmu_order_catalog_price;
ALTER TABLE jmu_orders ADD CONSTRAINT jmu_order_catalog_price CHECK(
  (category='solo' AND promotion_units BETWEEN 0 AND quantity AND amount_paise=24900*(quantity-promotion_units)+19900*promotion_units) OR
  (category='couple' AND quantity=1 AND promotion_units=0 AND amount_paise=39900)
);
ALTER TABLE jmu_orders DROP CONSTRAINT IF EXISTS jmu_order_promotion_shape;
ALTER TABLE jmu_orders ADD CONSTRAINT jmu_order_promotion_shape CHECK(
  (promotion_units=0 AND promotion_key IS NULL AND promotion_expires_at IS NULL) OR
  (promotion_units>0 AND promotion_key IS NOT NULL AND promotion_expires_at IS NOT NULL AND category='solo')
);
ALTER TABLE jmu_passes DROP CONSTRAINT IF EXISTS jmu_pass_domain;
ALTER TABLE jmu_passes ADD CONSTRAINT jmu_pass_domain CHECK(
  quantity BETWEEN 1 AND 10 AND amount>0 AND amount<>'NaN'::numeric
  AND payment_state IN ('legacy_unverified','pending','verified','revoked','review_required')
  AND (category_key IS NULL OR category_key IN ('solo','couple'))
  AND (category_key IS DISTINCT FROM 'couple' OR quantity=1)
  AND (recovery_hash IS NULL OR recovery_hash ~ '^[a-f0-9]{64}$')
  AND promotion_units BETWEEN 0 AND quantity
  AND ((promotion_units=0 AND promotion_key IS NULL AND promotion_expires_at IS NULL) OR
       (promotion_units>0 AND promotion_key IS NOT NULL AND promotion_expires_at IS NOT NULL AND category_key='solo'))
);
ALTER TABLE jmu_payments DROP CONSTRAINT IF EXISTS jmu_payments_state_check;
ALTER TABLE jmu_payments ADD CONSTRAINT jmu_payments_state_check CHECK(state IN ('verified','revoked','review_required'));
CREATE TABLE IF NOT EXISTS jmu_promotion_reservations (
  pass_id VARCHAR(64) PRIMARY KEY REFERENCES jmu_orders(pass_id),
  campaign_key VARCHAR(80) NOT NULL REFERENCES jmu_campaigns(campaign_key),
  units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 10),
  expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','redeemed','released'))
);
CREATE INDEX IF NOT EXISTS jmu_expiring_reservations ON jmu_promotion_reservations(campaign_key,expires_at) WHERE state='reserved';
ALTER TABLE jmu_promotion_reservations DROP CONSTRAINT IF EXISTS jmu_promotion_reservations_units_check;
ALTER TABLE jmu_promotion_reservations ADD CONSTRAINT jmu_promotion_reservations_units_check CHECK(units BETWEEN 1 AND 10);
CREATE OR REPLACE FUNCTION jmu_protect_campaign() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (NEW.campaign_key,NEW.config_hash,NEW.max_units,NEW.unit_price,NEW.regular_unit_price)
    IS DISTINCT FROM (OLD.campaign_key,OLD.config_hash,OLD.max_units,OLD.unit_price,OLD.regular_unit_price)
  THEN RAISE EXCEPTION 'Campaign policy is immutable'; END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jmu_campaign_immutable ON jmu_campaigns;
CREATE TRIGGER jmu_campaign_immutable BEFORE UPDATE ON jmu_campaigns FOR EACH ROW EXECUTE FUNCTION jmu_protect_campaign();
CREATE OR REPLACE FUNCTION jmu_protect_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (NEW.pass_id,NEW.idempotency_hash,NEW.request_hash,NEW.category,NEW.quantity,NEW.amount_paise,NEW.currency,
      NEW.promotion_key,NEW.promotion_units,NEW.promotion_expires_at)
    IS DISTINCT FROM (OLD.pass_id,OLD.idempotency_hash,OLD.request_hash,OLD.category,OLD.quantity,OLD.amount_paise,OLD.currency,
      OLD.promotion_key,OLD.promotion_units,OLD.promotion_expires_at)
    OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id)
  THEN RAISE EXCEPTION 'Order association and price snapshot are immutable'; END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION jmu_protect_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM jmu_orders o WHERE o.pass_id=NEW.pass_id AND o.order_id=NEW.order_id AND o.amount_paise=NEW.amount_paise AND o.currency=NEW.currency)
  THEN RAISE EXCEPTION 'Payment must match the frozen order'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.payment_id,NEW.order_id,NEW.pass_id,NEW.amount_paise,NEW.currency,NEW.verified_at)
    IS DISTINCT FROM (OLD.payment_id,OLD.order_id,OLD.pass_id,OLD.amount_paise,OLD.currency,OLD.verified_at)
    OR (OLD.state='revoked' AND NEW.state<>'revoked') OR (OLD.state='review_required' AND NEW.state NOT IN ('review_required','revoked')))
  THEN RAISE EXCEPTION 'Payment evidence is immutable'; END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION jmu_protect_pass() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='UPDATE' AND ((OLD.payment_state='revoked' AND NEW.payment_state<>'revoked')
    OR (OLD.payment_state='verified' AND NEW.payment_state NOT IN ('verified','revoked'))
    OR (OLD.payment_state='review_required' AND NEW.payment_state NOT IN ('review_required','revoked')))
  THEN RAISE EXCEPTION 'Invalid payment state transition'; END IF;
  IF EXISTS(SELECT 1 FROM jmu_orders o WHERE o.pass_id=NEW.pass_id AND
    (NEW.category_key IS DISTINCT FROM o.category OR NEW.quantity<>o.quantity OR NEW.amount*100<>o.amount_paise OR
     NEW.promotion_key IS DISTINCT FROM o.promotion_key OR NEW.promotion_units<>o.promotion_units OR NEW.promotion_expires_at IS DISTINCT FROM o.promotion_expires_at))
  THEN RAISE EXCEPTION 'Ticket must match the frozen price and promotion'; END IF;
  IF NEW.payment_state='verified' AND (NOT EXISTS(
    SELECT 1 FROM jmu_payments p JOIN jmu_orders o ON o.order_id=p.order_id AND o.pass_id=p.pass_id
    WHERE p.pass_id=NEW.pass_id AND p.state='verified' AND p.amount_paise=o.amount_paise AND p.currency=o.currency
      AND NEW.razorpay_order_id=p.order_id AND NEW.razorpay_payment_id=p.payment_id)
    OR (NEW.promotion_units>0 AND NOT EXISTS(SELECT 1 FROM jmu_promotion_reservations r WHERE r.pass_id=NEW.pass_id AND r.state='redeemed' AND r.units=NEW.promotion_units AND r.campaign_key=NEW.promotion_key)))
  THEN RAISE EXCEPTION 'Verified payment and promotion evidence required'; END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION jmu_protect_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM jmu_orders o WHERE o.pass_id=NEW.pass_id AND o.promotion_key=NEW.campaign_key
    AND o.promotion_units=NEW.units AND o.promotion_expires_at=NEW.expires_at)
    OR (TG_OP='INSERT' AND NEW.state<>'reserved')
  THEN RAISE EXCEPTION 'Reservation must match the frozen promotional assignment'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.pass_id,NEW.campaign_key,NEW.units,NEW.expires_at) IS DISTINCT FROM (OLD.pass_id,OLD.campaign_key,OLD.units,OLD.expires_at)
    OR (OLD.state IN ('released','redeemed') AND NEW.state<>OLD.state))
  THEN RAISE EXCEPTION 'Promotion reservation is immutable after release or redemption'; END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jmu_reservation_immutable ON jmu_promotion_reservations;
CREATE TRIGGER jmu_reservation_immutable BEFORE INSERT OR UPDATE ON jmu_promotion_reservations FOR EACH ROW EXECUTE FUNCTION jmu_protect_reservation();
COMMIT;
