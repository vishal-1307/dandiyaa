'use strict';
function localDatabase(value) {
  if (!value) throw new Error('Set TEST_DATABASE_URL explicitly; .env and DATABASE_URL are never loaded');
  const url=new URL(value);
  const database=decodeURIComponent(url.pathname.slice(1));
  if(!['postgres:','postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) ||
      !/^jmu_test_[a-z0-9_]+$/.test(database) || url.search || url.hash) {
    throw new Error('Only loopback PostgreSQL databases named jmu_test_* are permitted');
  }
  return value;
}
module.exports={localDatabase};
