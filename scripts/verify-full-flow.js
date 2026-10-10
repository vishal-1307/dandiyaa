const register = require('../api/register');
const getPass = require('../api/get-pass');
const { getDb } = require('../api/db');

async function test() {
  console.log('--- 1. Testing Registration in Cloud DB ---');
  const req1 = {
    method: 'POST',
    body: {
      passId: 'JMU-CLOUD88',
      category: 'Married Couple Pass',
      amount: 499,
      name: 'Priya & Rahul',
      phone: '9876543210',
      address: 'Jaynagar Ward 4',
      insta: '@priya_rahul',
      partnerName: 'Rahul Kumar',
      partnerPhone: '9876543211',
      timestamp: Date.now()
    },
    headers: {}
  };
  let resStatus = 0, resBody = null;
  const res1 = {
    setHeader: () => {},
    status: (s) => { resStatus = s; return res1; },
    json: (b) => { resBody = b; return res1; }
  };
  await register(req1, res1);
  console.log('Register response:', resStatus, resBody);

  console.log('\n--- 2. Testing Pass Lookup (Case Insensitive) ---');
  const req2 = {
    method: 'GET',
    query: { id: 'jmu-cloud88' },
    headers: {}
  };
  let getStatus = 0, getBody = null;
  const res2 = {
    setHeader: () => {},
    status: (s) => { getStatus = s; return res2; },
    json: (b) => { getBody = b; return res2; }
  };
  await getPass(req2, res2);
  console.log('Get pass response:', getStatus, JSON.stringify(getBody, null, 2));

  const db = getDb();
  await db`DELETE FROM jmu_passes WHERE pass_id = 'JMU-CLOUD88'`;
  console.log('\n✓ Cleaned up test pass from Neon DB.');
}

test();
