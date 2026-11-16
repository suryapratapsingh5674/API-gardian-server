// apps/server/tests/projects.test.js
//
// Integration tests for:
//   POST /api/projects             (create project)
//   GET  /api/projects/:id/status  (check status — authenticated)
//   POST /api/projects/:id/sessions (create pairing session — authenticated)

'use strict';

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const app = require('../src/app');
const { connectTestDB, disconnectTestDB, clearCollections } = require('./testSetup');

before(async () => {
  await connectTestDB();
});

after(async () => {
  await disconnectTestDB();
});

afterEach(async () => {
  await clearCollections();
});

// ─── POST /api/projects ────────────────────────────────────────────────────

describe('POST /api/projects', () => {
  test('creates a project and returns projectId and apiKey', async () => {
    const res = await supertest(app)
      .post('/api/projects')
      .send({ projectName: 'Test Project' });

    assert.equal(res.status, 201);
    assert.ok(res.body.projectId, 'should return projectId');
    assert.equal(res.body.projectName, 'Test Project');
    assert.ok(res.body.apiKey, 'should return apiKey');
    // The API key should be a 64-character hex string (32 bytes)
    assert.match(res.body.apiKey, /^[a-f0-9]{64}$/, 'apiKey should be 64 hex chars');
  });

  test('returns 400 if projectName is missing', async () => {
    const res = await supertest(app).post('/api/projects').send({});

    assert.equal(res.status, 400);
    assert.ok(res.body.error, 'should return error message');
  });

  test('returns 400 if projectName is empty string', async () => {
    const res = await supertest(app)
      .post('/api/projects')
      .send({ projectName: '   ' });

    assert.equal(res.status, 400);
  });

  test('returns 400 if projectName exceeds 100 characters', async () => {
    const res = await supertest(app)
      .post('/api/projects')
      .send({ projectName: 'A'.repeat(101) });

    assert.equal(res.status, 400);
  });

  test('does not return projectKeyHash in the response', async () => {
    const res = await supertest(app)
      .post('/api/projects')
      .send({ projectName: 'Security Test' });

    assert.equal(res.status, 201);
    assert.equal(res.body.projectKeyHash, undefined, 'projectKeyHash must never be in the response');
  });
});

// ─── GET /api/projects/:id/status ─────────────────────────────────────────

describe('GET /api/projects/:id/status', () => {
  // Helper: create a project and return its credentials
  async function createProject(name = 'Status Test Project') {
    const res = await supertest(app)
      .post('/api/projects')
      .send({ projectName: name });
    return { projectId: res.body.projectId, apiKey: res.body.apiKey };
  }

  test('returns project status when authenticated', async () => {
    const { projectId, apiKey } = await createProject();

    const res = await supertest(app)
      .get(`/api/projects/${projectId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.projectName, 'Status Test Project');
    assert.equal(res.body.status, 'active');
    assert.equal(res.body.hasActiveDevice, false);
    assert.equal(res.body.activeDeviceCount, 0);
  });

  test('returns 401 when Authorization header is missing', async () => {
    const { projectId } = await createProject();

    const res = await supertest(app).get(`/api/projects/${projectId}/status`);

    assert.equal(res.status, 401);
  });

  test('returns 401 when API key is wrong', async () => {
    const { projectId } = await createProject();

    const res = await supertest(app)
      .get(`/api/projects/${projectId}/status`)
      .set('Authorization', 'Bearer wrong-api-key-here');

    assert.equal(res.status, 401);
  });

  test('returns 401 when project ID is invalid', async () => {
    const res = await supertest(app)
      .get('/api/projects/not-a-real-id/status')
      .set('Authorization', 'Bearer somekey');

    assert.equal(res.status, 401);
  });
});

// ─── POST /api/projects/:id/sessions ──────────────────────────────────────

describe('POST /api/projects/:id/sessions', () => {
  async function createProject(name = 'Session Test Project') {
    const res = await supertest(app)
      .post('/api/projects')
      .send({ projectName: name });
    return { projectId: res.body.projectId, apiKey: res.body.apiKey };
  }

  test('creates a pairing session and returns a token', async () => {
    const { projectId, apiKey } = await createProject();

    const res = await supertest(app)
      .post(`/api/projects/${projectId}/sessions`)
      .set('Authorization', `Bearer ${apiKey}`);

    assert.equal(res.status, 201);
    assert.ok(res.body.token, 'should return a token');
    // Token is 16 bytes = 32 hex characters
    assert.match(res.body.token, /^[a-f0-9]{32}$/, 'token should be 32 hex chars');
    assert.ok(res.body.expiresAt, 'should return expiresAt');

    // The expiry must be in the future
    const expiresAt = new Date(res.body.expiresAt);
    assert.ok(expiresAt > new Date(), 'expiresAt must be in the future');
  });

  test('token expires in approximately 10 minutes', async () => {
    const { projectId, apiKey } = await createProject();

    const before = Date.now();
    const res = await supertest(app)
      .post(`/api/projects/${projectId}/sessions`)
      .set('Authorization', `Bearer ${apiKey}`);
    const after = Date.now();

    const expiresAt = new Date(res.body.expiresAt).getTime();
    const tenMinutesMs = 10 * 60 * 1000;

    // expiresAt should be approximately now + 10 minutes (allow 5s leeway)
    assert.ok(expiresAt >= before + tenMinutesMs - 5000);
    assert.ok(expiresAt <= after + tenMinutesMs + 5000);
  });

  test('returns 401 without authentication', async () => {
    const { projectId } = await createProject();

    const res = await supertest(app)
      .post(`/api/projects/${projectId}/sessions`);

    assert.equal(res.status, 401);
  });
});

