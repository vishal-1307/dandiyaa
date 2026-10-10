const { neon } = require('@neondatabase/serverless');

// Load environment variables locally if .env exists
try {
  require('dotenv').config();
} catch (_) {}

let sql = null;

function getDb() {
  if (!sql) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is missing. Please set DATABASE_URL in Vercel or your environment file.');
    }
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
      status VARCHAR(32) DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await db`
    ALTER TABLE jmu_passes ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'pending';
  `;
  await db`
    CREATE INDEX IF NOT EXISTS idx_jmu_passes_pass_id ON jmu_passes(pass_id);
  `;
  tableChecked = true;
}

module.exports = { getDb, ensureTable };
