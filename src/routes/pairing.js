// apps/server/src/routes/pairing.js
//
// Route:
//   POST /api/pair → The mobile app calls this after scanning the QR code.
//
// FLOW:
//   1. App sends: { token, expoPushToken, deviceName, platform }
//   2. We hash the token and find the matching PairingSession.
//   3. We verify the session is not expired and not already consumed.
//   4. We create a Device record (or update it if this device re-pairs).
//   5. We mark the session as consumed (consumedAt = now).
//   6. We update the Project's hasActiveDevice flag.
//   7. We return a device credential — the app stores this securely
//      and uses it to authenticate future requests (error history, etc.).

'use strict';

const express = require('express');
const router = express.Router();

const PairingSession = require('../models/PairingSession');
const Device = require('../models/Device');
const Project = require('../models/Project');
const { generateToken, hashToken, tokensMatch } = require('../utils/crypto');
const { pairingLimiter } = require('../middleware/rateLimiter');

// ─── POST /api/pair ──────────────────────────────────────────────────────────
router.post('/', pairingLimiter, async (req, res, next) => {
  try {
    const { token, expoPushToken, deviceName, platform } = req.body;

    // ── Validate required fields ──────────────────────────────────────────
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required' });
    }
    if (!expoPushToken || typeof expoPushToken !== 'string') {
      return res.status(400).json({ error: 'expoPushToken is required' });
    }

    // Basic Expo Push Token format check.
    // Real tokens look like: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
    // We also allow the newer format: ExpoPushToken[xxx]
    const isValidExpoToken =
      expoPushToken.startsWith('ExponentPushToken[') ||
      expoPushToken.startsWith('ExpoPushToken[');
    if (!isValidExpoToken) {
      return res.status(400).json({
        error: 'expoPushToken must be a valid Expo Push Token',
      });
    }

    // ── Find the pairing session ──────────────────────────────────────────
    // Hash the incoming token and search by the hash.
    // We do NOT search by plaintext — the plaintext is never stored.
    const incomingHash = hashToken(token);

    // We also filter out already-expired sessions here.
    // The TTL index eventually deletes expired documents, but there can be a delay.
    const session = await PairingSession.findOne({
      tokenHash: incomingHash,
      expiresAt: { $gt: new Date() },   // must not be expired
      consumedAt: null,                  // must not be already used
    });

    if (!session) {
      // Return a generic message — don't reveal whether the token was
      // invalid, expired, or already consumed (each is a different case
      // but all should look the same to the outside world).
      return res.status(400).json({
        error: 'Invalid, expired, or already-used pairing token',
      });
    }

    // Double-check the token using timing-safe comparison.
    // findOne already matched on the hash, but this is good defence-in-depth.
    if (!tokensMatch(token, session.tokenHash)) {
      return res.status(400).json({
        error: 'Invalid, expired, or already-used pairing token',
      });
    }

    // ── Verify the project still exists and is active ─────────────────────
    const project = await Project.findById(session.projectId);
    if (!project || project.status !== 'active') {
      return res.status(400).json({ error: 'Project not found or inactive' });
    }

    // ── Generate a device credential ──────────────────────────────────────
    // The mobile app stores this securely (using Expo SecureStore) and
    // sends it in an Authorization header when fetching error history.
    const deviceCredential = generateToken(32);
    const deviceCredentialHash = hashToken(deviceCredential);

    // ── Create or update the device record ───────────────────────────────
    // If this device (identified by expoPushToken) already exists for this
    // project, update it. This handles the case where someone re-pairs after
    // reinstalling the app.
    const device = await Device.findOneAndUpdate(
      {
        projectId: project._id,
        expoPushToken: expoPushToken.trim(),
      },
      {
        deviceName: (deviceName || 'Unknown Device').trim().slice(0, 100),
        platform: ['android', 'ios'].includes(platform) ? platform : 'unknown',
        deviceCredentialHash,
        isActive: true,
        lastSeenAt: new Date(),
      },
      {
        upsert: true,       // create if it doesn't exist
        new: true,          // return the updated document
        setDefaultsOnInsert: true,
      }
    );

    // ── Consume the pairing session ───────────────────────────────────────
    // Mark it as used so it cannot be replayed.
    session.consumedAt = new Date();
    await session.save();

    // ── Update the project's active-device flag ───────────────────────────
    await Project.findByIdAndUpdate(project._id, { hasActiveDevice: true });

    // ── Respond ───────────────────────────────────────────────────────────
    // Return the device credential ONCE. The app must save it to SecureStore.
    res.status(201).json({
      deviceId: device._id,
      projectId: project._id,
      projectName: project.projectName,
      deviceCredential,   // ← plaintext, shown once — app must store securely
      message: 'Device paired successfully. Save your deviceCredential securely.',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

