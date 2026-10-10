const { neon } = require('@neondatabase/serverless');

const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_rZjFwcL21xRW@ep-morning-scene-aoawys2b-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

let sql = null;

function getDb() {
  if (!sql) {
    sql = neon(connectionString);
  }
  return sql;
}

let tableChecked = false;

async function ensureTable() {
  if (tableChecked) return;
  const db = getDb();
  await db`
    CREATE TABLE IF NOT EXISTS jmu_passes (
      id SERIAL PRIMARY KEY,
      pass_id VARCHAR(32) UNIQUE NOT NULL,
      category VARCHAR(64) NOT NULL,
      amount NUMERIC(10, 2) NOT NULL,
      name VARCHAR(128) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      address TEXT NOT NULL,
      insta VARCHAR(64),
      partner_name VARCHAR(128),
      partner_phone VARCHAR(20),
      timestamp BIGINT NOT NULL,
      date_str VARCHAR(64),
      time_str VARCHAR(64),
      venue TEXT,
      organizer VARCHAR(128),
      checked_in BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await db`
    CREATE INDEX IF NOT EXISTS idx_jmu_passes_pass_id ON jmu_passes(pass_id);
  `;
  tableChecked = true;
}

module.exports = { getDb, ensureTable };
