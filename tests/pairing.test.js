// apps/server/tests/pairing.test.js
//
// Integration tests for:
//   POST /api/pair  (consume a pairing token, register a device)

'use strict';

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const app = require('../src/app');
const PairingSession = require('../src/models/PairingSession');
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

// Helper: create a project and return its credentials
async function createProject(name = 'Pairing Test Project') {
  const res = await supertest(app)
    .post('/api/projects')
    .send({ projectName: name });
  return { projectId: res.body.projectId, apiKey: res.body.apiKey };
}

// Helper: create a pairing session and return its token
async function createSession(projectId, apiKey) {
  const res = await supertest(app)
    .post(`/api/projects/${projectId}/sessions`)
    .set('Authorization', `Bearer ${apiKey}`);
  return { token: res.body.token, expiresAt: res.body.expiresAt };
}

const VALID_EXPO_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

// ─── POST /api/pair ────────────────────────────────────────────────────────

describe('POST /api/pair', () => {
  test('successfully pairs a device and returns deviceId and credential', async () => {
    const { projectId, apiKey } = await createProject();
    const { token } = await createSession(projectId, apiKey);

    const res = await supertest(app).post('/api/pair').send({
      token,
      expoPushToken: VALID_EXPO_TOKEN,
      deviceName: 'Pixel 8',
      platform: 'android',
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.deviceId, 'should return deviceId');
    assert.ok(res.body.deviceCredential, 'should return deviceCredential');
    assert.equal(res.body.projectId.toString(), projectId.toString());
    // deviceCredential is a 64 hex char string
    assert.match(res.body.deviceCredential, /^[a-f0-9]{64}$/);
  });

  test('marks the project hasActiveDevice as true after pairing', async () => {
    const { projectId, apiKey } = await createProject();
    const { token } = await createSession(projectId, apiKey);

    await supertest(app).post('/api/pair').send({
      token,
      expoPushToken: VALID_EXPO_TOKEN,
      platform: 'android',
    });

    // Now check the project status
    const statusRes = await supertest(app)
      .get(`/api/projects/${projectId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);

    assert.equal(statusRes.body.hasActiveDevice, true);
    assert.equal(statusRes.body.activeDeviceCount, 1);
  });

  test('returns 400 with an invalid token', async () => {
    const res = await supertest(app).post('/api/pair').send({
      token: 'not-a-real-token',
      expoPushToken: VALID_EXPO_TOKEN,
      platform: 'android',
    });

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('returns 400 when token is reused (already consumed)', async () => {
    const { projectId, apiKey } = await createProject();
    const { token } = await createSession(projectId, apiKey);

    // First use — should succeed
    await supertest(app).post('/api/pair').send({
      token,
      expoPushToken: VALID_EXPO_TOKEN,
      platform: 'android',
    });

    // Second use — should fail (session already consumed)
    const res = await supertest(app).post('/api/pair').send({
      token,
      expoPushToken: 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]',
      platform: 'android',
    });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /expired|already-used|invalid/i);
  });

  test('returns 400 when token is expired', async () => {
    const { projectId } = await createProject();

    // Directly insert an already-expired session into the database.
    const { hashToken } = require('../src/utils/crypto');
    const fakeToken = 'deadbeefdeadbeef';
    await PairingSession.create({
      projectId,
      tokenHash: hashToken(fakeToken),
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    });

    const res = await supertest(app).post('/api/pair').send({
      token: fakeToken,
      expoPushToken: VALID_EXPO_TOKEN,
      platform: 'android',
    });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /expired|already-used|invalid/i);
  });

  test('returns 400 if expoPushToken is missing', async () => {
    const { projectId, apiKey } = await createProject();
    const { token } = await createSession(projectId, apiKey);

    const res = await supertest(app).post('/api/pair').send({ token });

    assert.equal(res.status, 400);
  });

  test('returns 400 if expoPushToken has wrong format', async () => {
    const { projectId, apiKey } = await createProject();
    const { token } = await createSession(projectId, apiKey);

    const res = await supertest(app).post('/api/pair').send({
      token,
      expoPushToken: 'not-an-expo-token',
      platform: 'android',
    });

    assert.equal(res.status, 400);
  });
});

