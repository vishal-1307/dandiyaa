'use strict';
const { required } = require('./security');

async function withDatabase(env, run) {
  const { Pool } = require('@neondatabase/serverless');
  const pool = new Pool({ connectionString: required(env, 'DATABASE_URL'), max: 1,
    connectionTimeoutMillis: 8000, statement_timeout: 8000 });
  // Idle socket errors are EventEmitter events, not rejected query promises.
  // Handle them without exposing connection strings or transport details.
  pool.on('error',()=>console.error('JMU database transport error',{code:'DATABASE_TRANSPORT_FAILURE'}));
  let client;
  try {
    client = await pool.connect();
    const { Repository } = require('./repository');
    return await run(new Repository(client));
  } finally {
    if (client) client.release();
    await pool.end();
  }
}
module.exports = { withDatabase };
