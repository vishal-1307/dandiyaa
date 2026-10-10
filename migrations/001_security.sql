-- Run only through the guarded migration tool after backup and preflight review.
BEGIN;
SELECT pg_advisory_xact_lock(20261019);
CREATE TABLE IF NOT EXISTS jmu_passes (
  id SERIAL PRIMARY KEY, pass_id VARCHAR(64) UNIQUE NOT NULL,
  category VARCHAR(64) NOT NULL, amount NUMERIC(10,2) NOT NULL,
  name VARCHAR(128) NOT NULL, phone VARCHAR(20) NOT NULL, address TEXT DEFAULT '',
  insta VARCHAR(64), partner_name VARCHAR(128), partner_phone VARCHAR(20),
  timestamp BIGINT NOT NULL, date_str VARCHAR(64), time_str VARCHAR(64), venue TEXT,
  organizer VARCHAR(128), checked_in BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE jmu_passes ALTER COLUMN pass_id TYPE VARCHAR(64);
ALTER TABLE jmu_passes ALTER COLUMN address DROP NOT NULL;
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'pending';
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1;
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS payment_method VARCHAR(32) DEFAULT 'razorpay';
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(64);
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(64);
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS check_in_time VARCHAR(64);
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS payment_state TEXT NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS category_key TEXT;
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS recovery_hash CHAR(64);
ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS check_in_at TIMESTAMPTZ;

-- Fail rather than discard or silently repair historical records.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM jmu_passes GROUP BY UPPER(pass_id) HAVING COUNT(*) > 1)
    OR EXISTS (SELECT 1 FROM jmu_passes WHERE quantity IS NULL OR quantity NOT BETWEEN 1 AND 10
      OR amount <= 0 OR amount = 'NaN'::numeric OR name = '' OR phone = '')
    OR EXISTS (SELECT 1 FROM jmu_passes WHERE razorpay_payment_id IS NOT NULL
      GROUP BY razorpay_payment_id HAVING COUNT(*) > 1)
    OR EXISTS (SELECT 1 FROM jmu_passes WHERE razorpay_order_id IS NOT NULL
      GROUP BY razorpay_order_id HAVING COUNT(*) > 1)
  THEN RAISE EXCEPTION 'Historical conflicts require owner reconciliation before migration'; END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS jmu_pass_id_case_unique ON jmu_passes (UPPER(pass_id));
CREATE UNIQUE INDEX IF NOT EXISTS jmu_legacy_payment_unique ON jmu_passes (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS jmu_legacy_order_unique ON jmu_passes (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
ALTER TABLE jmu_passes ALTER COLUMN quantity SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jmu_pass_domain' AND conrelid='jmu_passes'::regclass) THEN
    ALTER TABLE jmu_passes ADD CONSTRAINT jmu_pass_domain CHECK (
      quantity BETWEEN 1 AND 10 AND amount > 0 AND amount <> 'NaN'::numeric
      AND payment_state IN ('legacy_unverified','pending','verified','revoked')
      AND (category_key IS NULL OR category_key IN ('solo','couple'))
      AND (category_key IS DISTINCT FROM 'couple' OR quantity = 1)
      AND (recovery_hash IS NULL OR recovery_hash ~ '^[a-f0-9]{64}$')
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS jmu_orders (
  pass_id VARCHAR(64) PRIMARY KEY REFERENCES jmu_passes(pass_id),
  idempotency_hash CHAR(64) UNIQUE NOT NULL,
  request_hash CHAR(64) NOT NULL,
  order_id VARCHAR(80) UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('solo','couple')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  amount_paise INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  state TEXT NOT NULL DEFAULT 'creating' CHECK (state IN ('creating','ready','unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT jmu_order_catalog_price CHECK ((category='solo' AND amount_paise=24900*quantity) OR
         (category='couple' AND quantity=1 AND amount_paise=39900)),
  CHECK (state <> 'ready' OR order_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS jmu_order_binding_unique ON jmu_orders(pass_id,order_id);
CREATE TABLE IF NOT EXISTS jmu_payments (
  payment_id VARCHAR(80) PRIMARY KEY,
  order_id VARCHAR(80) UNIQUE NOT NULL REFERENCES jmu_orders(order_id),
  pass_id VARCHAR(64) UNIQUE NOT NULL REFERENCES jmu_orders(pass_id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  currency TEXT NOT NULL CHECK (currency='INR'),
  state TEXT NOT NULL CHECK (state IN ('verified','revoked')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pass_id,order_id) REFERENCES jmu_orders(pass_id,order_id)
);
CREATE TABLE IF NOT EXISTS jmu_webhook_events (
  event_id VARCHAR(128) PRIMARY KEY, digest CHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL, order_id VARCHAR(80), payment_id VARCHAR(80),
  state TEXT NOT NULL DEFAULT 'received' CHECK (state IN ('received','retry','done','unmatched')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS jmu_admin_sessions (
  session_hash CHAR(64) PRIMARY KEY, csrf_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS jmu_pending_webhooks ON jmu_webhook_events(order_id,created_at) WHERE state<>'done';
CREATE TABLE IF NOT EXISTS jmu_rate_limits (
  key_hash CHAR(64) NOT NULL, bucket BIGINT NOT NULL,
  count INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(key_hash,bucket)
);
CREATE TABLE IF NOT EXISTS jmu_audit (
  id BIGSERIAL PRIMARY KEY, actor_hash VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL, pass_id VARCHAR(64),
  reason VARCHAR(200) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION jmu_protect_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (NEW.pass_id,NEW.idempotency_hash,NEW.request_hash,NEW.category,NEW.quantity,NEW.amount_paise,NEW.currency)
     IS DISTINCT FROM (OLD.pass_id,OLD.idempotency_hash,OLD.request_hash,OLD.category,OLD.quantity,OLD.amount_paise,OLD.currency)
     OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id)
  THEN RAISE EXCEPTION 'Order association and price snapshot are immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jmu_order_immutable ON jmu_orders;
CREATE TRIGGER jmu_order_immutable BEFORE UPDATE ON jmu_orders FOR EACH ROW EXECUTE FUNCTION jmu_protect_order();
CREATE OR REPLACE FUNCTION jmu_protect_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM jmu_orders o WHERE o.pass_id=NEW.pass_id AND o.order_id=NEW.order_id
    AND o.amount_paise=NEW.amount_paise AND o.currency=NEW.currency)
  THEN RAISE EXCEPTION 'Payment must match the frozen order'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.payment_id,NEW.order_id,NEW.pass_id,NEW.amount_paise,NEW.currency,NEW.verified_at)
     IS DISTINCT FROM (OLD.payment_id,OLD.order_id,OLD.pass_id,OLD.amount_paise,OLD.currency,OLD.verified_at)
     OR (OLD.state='revoked' AND NEW.state <> 'revoked'))
  THEN RAISE EXCEPTION 'Payment evidence is immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jmu_payment_immutable ON jmu_payments;
CREATE TRIGGER jmu_payment_immutable BEFORE INSERT OR UPDATE ON jmu_payments FOR EACH ROW EXECUTE FUNCTION jmu_protect_payment();
CREATE OR REPLACE FUNCTION jmu_protect_pass() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='UPDATE' AND ((OLD.payment_state='revoked' AND NEW.payment_state <> 'revoked')
    OR (OLD.payment_state='verified' AND NEW.payment_state NOT IN ('verified','revoked')))
  THEN RAISE EXCEPTION 'Invalid payment state transition'; END IF;
  IF EXISTS (SELECT 1 FROM jmu_orders o WHERE o.pass_id=NEW.pass_id AND
    (NEW.category_key IS DISTINCT FROM o.category OR NEW.quantity <> o.quantity OR NEW.amount*100 <> o.amount_paise))
  THEN RAISE EXCEPTION 'Ticket category, quantity and price must match frozen booking'; END IF;
  IF NEW.payment_state='verified' AND NOT EXISTS (
    SELECT 1 FROM jmu_payments p JOIN jmu_orders o ON o.order_id=p.order_id AND o.pass_id=p.pass_id
    WHERE p.pass_id=NEW.pass_id AND p.state='verified' AND p.amount_paise=o.amount_paise AND p.currency=o.currency
      AND NEW.razorpay_order_id=p.order_id AND NEW.razorpay_payment_id=p.payment_id
  ) THEN RAISE EXCEPTION 'Verified payment evidence required'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jmu_pass_payment_guard ON jmu_passes;
CREATE TRIGGER jmu_pass_payment_guard BEFORE INSERT OR UPDATE ON jmu_passes FOR EACH ROW EXECUTE FUNCTION jmu_protect_pass();
COMMIT;
