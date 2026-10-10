'use strict';
// Run actual implementation tests instead of a duplicated, misleading mock flow.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result=spawnSync(process.execPath,['--test','tests/security.test.js'],{cwd:path.resolve(__dirname,'..'),stdio:'inherit'});
process.exitCode=result.status===null?1:result.status;
