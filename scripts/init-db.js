const { neon } = require('@neondatabase/serverless');

const dbUrl = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_rZjFwcL21xRW@ep-morning-scene-aoawys2b-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const sql = neon(dbUrl);

async function initDb() {
  try {
    console.log('Creating jmu_passes table if not exists...');
    await sql`
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

    await sql`
      CREATE INDEX IF NOT EXISTS idx_jmu_passes_pass_id ON jmu_passes(pass_id);
    `;

    console.log('✓ jmu_passes table created successfully!');

    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public';`;
    console.log('Current tables in DB:', tables);
  } catch (err) {
    console.error('Database initialization failed:', err);
  }
}

initDb();
