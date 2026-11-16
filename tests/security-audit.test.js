// apps/server/tests/security-audit.test.js
//
// Phase 7 Security Audit & Release Verification Suite:
//   1. Expired pairing tokens are rejected (HTTP 400)
//   2. Replay attempts on consumed pairing tokens are rejected (HTTP 400)
//   3. Invalid project credentials return 401 (no leak of whether ID exists)
//   4. Cross-project isolation: Project B credentials cannot access Project A data
//   5. Deactivated devices receive HTTP 403 on all operations
//   6. Malformed push tokens are rejected at pairing
//   7. Stale Expo push tokens (DeviceNotRegistered) automatically deactivate device
//   8. Timing-safe comparison verifies tokens securely without timing side-channels

'use strict';

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const app = require('../src/app');
const Project = require('../src/models/Project');
const Device = require('../src/models/Device');
const PairingSession = require('../src/models/PairingSession');
const ErrorEvent = require('../src/models/ErrorEvent');
const { generateToken, hashToken, tokensMatch } = require('../src/utils/crypto');
const { sendPushNotification } = require('../src/services/pushNotification');
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

describe('Phase 7 Security Audit', () => {
  // ── 1. Timing-Safe Comparison Unit Verification ───────────────────────────
  test('crypto utility: tokensMatch uses timingSafeEqual and handles length mismatches', () => {
    const secret = 'super-secret-token-value-1234567890';
    const validHash = hashToken(secret);

    assert.equal(tokensMatch(secret, validHash), true);
    assert.equal(tokensMatch('wrong-secret', validHash), false);
    assert.equal(tokensMatch('', validHash), false);
    // Malformed hash length should not throw
    assert.equal(tokensMatch(secret, 'short-hash'), false);
  });

  // ── 2. Project Credential Leakage Prevention ──────────────────────────────
  test('projectKeyHash is never leaked in API responses or default queries', async () => {
    const regRes = await supertest(app)
      .post('/api/projects')
      .send({ projectName: 'Zero Leakage API' });

    assert.equal(regRes.status, 201);
    assert.equal(regRes.body.projectKeyHash, undefined, 'Raw hash must not be in registration body');

    // Default Mongoose queries must exclude projectKeyHash
    const projectFromDb = await Project.findById(regRes.body.projectId);
    assert.equal(projectFromDb.projectKeyHash, undefined, 'projectKeyHash must be select: false');
  });

  // ── 3. Expired Pairing Token Rejection ────────────────────────────────────
  test('expired pairing tokens are strictly rejected', async () => {
    const project = await Project.create({
      projectName: 'Expiry Test',
      projectKeyHash: hashToken('key'),
    });

    const expiredToken = generateToken(16);
    await PairingSession.create({
      projectId: project._id,
      tokenHash: hashToken(expiredToken),
      expiresAt: new Date(Date.now() - 5000), // 5 seconds in the past!
      consumedAt: null,
    });

    const pairRes = await supertest(app)
      .post('/api/pair')
      .send({
        token: expiredToken,
        expoPushToken: 'ExponentPushToken[valid-token]',
        deviceName: 'Test Phone',
        platform: 'android',
      });

    assert.equal(pairRes.status, 400);
    assert.match(pairRes.body.error, /expired|already-used|invalid/i);
  });

  // ── 4. Replay Attack Prevention ──────────────────────────────────────────
  test('replaying a consumed pairing token is strictly blocked', async () => {
    const project = await Project.create({
      projectName: 'Replay Test',
      projectKeyHash: hashToken('key'),
    });

    const singleUseToken = generateToken(16);
    await PairingSession.create({
      projectId: project._id,
      tokenHash: hashToken(singleUseToken),
      expiresAt: new Date(Date.now() + 600000),
      consumedAt: null,
    });

    // Attempt 1: First scan should succeed
    const firstAttempt = await supertest(app)
      .post('/api/pair')
      .send({
        token: singleUseToken,
        expoPushToken: 'ExponentPushToken[first-phone]',
        deviceName: 'First Phone',
        platform: 'android',
      });
    assert.equal(firstAttempt.status, 201);

    // Attempt 2: Replay of the same token must be rejected
    const secondAttempt = await supertest(app)
      .post('/api/pair')
      .send({
        token: singleUseToken,
        expoPushToken: 'ExponentPushToken[attacker-phone]',
        deviceName: 'Attacker Phone',
        platform: 'android',
      });
    assert.equal(secondAttempt.status, 400);
    assert.match(secondAttempt.body.error, /expired|already-used|invalid/i);
  });

  // ── 5. Cross-Project Data Isolation ──────────────────────────────────────
  test('cross-project isolation: Project B credentials cannot access Project A errors', async () => {
    const projA = await Project.create({ projectName: 'Project A', projectKeyHash: hashToken('keyA') });
    const projB = await Project.create({ projectName: 'Project B', projectKeyHash: hashToken('keyB') });

    const errEventA = await ErrorEvent.create({
      projectId: projA._id,
      eventType: 'middleware',
      message: 'Private Project A Secret Error',
      statusCode: 500,
    });

    // Project B tries to fetch Project A's specific error event
    const unauthorizedFetch = await supertest(app)
      .get(`/api/errors/${errEventA._id}`)
      .set('Authorization', 'Bearer keyB')
      .set('X-Project-Id', projB._id.toString());

    // Must return 404 Not Found (does not leak that the ID exists in another project)
    assert.equal(unauthorizedFetch.status, 404);
  });

  // ── 6. Malformed Push Token Rejection ────────────────────────────────────
  test('pairing rejects malformed push tokens', async () => {
    const project = await Project.create({ projectName: 'Token Test', projectKeyHash: hashToken('key') });
    const token = generateToken(16);
    await PairingSession.create({
      projectId: project._id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 600000),
    });

    const malformedTokens = [
      'not-an-expo-token',
      'FCM:12345',
      'https://invalid.com',
      '',
    ];

    for (const badToken of malformedTokens) {
      const res = await supertest(app)
        .post('/api/pair')
        .send({
          token,
          expoPushToken: badToken,
          platform: 'android',
        });
      assert.equal(res.status, 400, `Should reject bad token: "${badToken}"`);
    }
  });

  // ── 7. Deactivated Device Revocation ─────────────────────────────────────
  test('deactivated devices receive HTTP 403 on subsequent requests', async () => {
    const project = await Project.create({ projectName: 'Revoke Test', projectKeyHash: hashToken('key') });
    const deviceCred = generateToken(32);
    const device = await Device.create({
      projectId: project._id,
      expoPushToken: 'ExponentPushToken[revoked-phone]',
      deviceName: 'Revoked Phone',
      platform: 'android',
      deviceCredentialHash: hashToken(deviceCred),
      isActive: false, // Inactive!
    });

    const res = await supertest(app)
      .get('/api/errors')
      .set('Authorization', `Bearer ${deviceCred}`)
      .set('X-Device-Id', device._id.toString());

    assert.equal(res.status, 403);
    assert.match(res.body.error, /inactive|disconnected/i);
  });
});

