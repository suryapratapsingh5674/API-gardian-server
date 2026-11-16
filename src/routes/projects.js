// apps/server/src/routes/projects.js
//
// Routes:
//   POST /api/projects          → Register a new project (no auth required)
//   GET  /api/projects/:id/status → Check a project's status (auth required)
//
// WHY POST /api/projects is unauthenticated:
//   The first thing the SDK does is register the project. At that point
//   there are no credentials yet, so the endpoint must be open.
//   We protect it with a rate limiter instead.

'use strict';

const express = require('express');
const router = express.Router();

const Project = require('../models/Project');
const { generateToken, hashToken } = require('../utils/crypto');
const { authenticate } = require('../middleware/authenticate');
const { projectCreationLimiter } = require('../middleware/rateLimiter');

// ─── POST /api/projects ─────────────────────────────────────────────────────
// Register a new project and return credentials.
// The API key is returned ONCE in plaintext — we only store its hash.
// The SDK saves the key to a local .api-guardian.json file (gitignored).
router.post('/', projectCreationLimiter, async (req, res, next) => {
  try {
    const { projectName } = req.body;

    if (!projectName || typeof projectName !== 'string') {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const trimmedName = projectName.trim();
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      return res.status(400).json({
        error: 'projectName must be between 1 and 100 characters',
      });
    }

    // Generate a random 32-byte (64-character hex) API key.
    const apiKey = generateToken(32);
    const projectKeyHash = hashToken(apiKey);

    const project = await Project.create({
      projectName: trimmedName,
      projectKeyHash,
    });

    // Return the plaintext API key HERE and ONLY HERE.
    // After this response, the key is gone — we only have the hash.
    res.status(201).json({
      projectId: project._id,
      projectName: project.projectName,
      apiKey,   // ← plaintext, shown once
      message:
        'Project registered. Save your apiKey — it will not be shown again.',
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/projects/:id/status ───────────────────────────────────────────
// Returns the project's current status and device count.
// Used by the SDK on startup to decide whether to show the QR code.
router.get('/:id/status', authenticate, async (req, res, next) => {
  try {
    // req.project was set by the authenticate middleware.
    // We do a fresh count of active devices rather than relying on the cached flag.
    const Device = require('../models/Device');
    const activeDeviceCount = await Device.countDocuments({
      projectId: req.project._id,
      isActive: true,
    });

    res.json({
      projectId: req.project._id,
      projectName: req.project.projectName,
      status: req.project.status,
      hasActiveDevice: activeDeviceCount > 0,
      activeDeviceCount,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/projects/:id/sessions ────────────────────────────────────────
// Create a short-lived pairing session for this project.
// Returns a plaintext token that goes into the QR code.
// The token expires in 10 minutes and can only be used once.
router.post('/:id/sessions', authenticate, async (req, res, next) => {
  try {
    const PairingSession = require('../models/PairingSession');

    // Generate a short-lived pairing token (16 bytes = 32 hex chars).
    // Shorter than the API key because it only lives for 10 minutes.
    const token = generateToken(16);
    const tokenHash = hashToken(token);

    const TEN_MINUTES = 10 * 60 * 1000;
    const expiresAt = new Date(Date.now() + TEN_MINUTES);

    await PairingSession.create({
      projectId: req.project._id,
      tokenHash,
      expiresAt,
    });

    // Return the plaintext token. It goes into the QR code payload.
    // We never store this plaintext — only the hash lives in the DB.
    res.status(201).json({
      token,           // ← plaintext pairing token (for QR code)
      expiresAt,
      projectId: req.project._id,
      projectName: req.project.projectName,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

