// apps/server/tests/health.test.js
//
// A simple test for the /health endpoint using Node's built-in test runner.
// Run with: npm test  (from the apps/server directory)
//
// We import the app directly (not index.js) so we can test it
// without connecting to a real database or starting a real server.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  test('returns 200 with status ok', async () => {
    const response = await supertest(app).get('/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.service, 'api-guardian-server');
    assert.ok(response.body.timestamp, 'timestamp should be present');
  });
});

describe('GET /nonexistent-route', () => {
  test('returns 404 with error message', async () => {
    const response = await supertest(app).get('/this-route-does-not-exist');

    assert.equal(response.status, 404);
    assert.ok(response.body.error, 'error field should be present');
  });
});

