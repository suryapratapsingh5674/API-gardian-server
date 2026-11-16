// apps/server/src/middleware/authenticate.js
//
// Authentication middleware supporting two client types:
//
// 1. SDK / Backend:
//    - Authorization: Bearer <apiKey>
//    - X-Project-Id: <projectId> (or :id URL param)
//    - Verifies apiKey matches Project.projectKeyHash.
//
// 2. Mobile Companion App:
//    - Authorization: Bearer <deviceCredential>
//    - X-Device-Id: <deviceId>
//    - Verifies deviceCredential matches Device.deviceCredentialHash
//      and verifies that Device.isActive is true.
//
// Both attach req.project to the request so route handlers work seamlessly.
// Device requests also attach req.device.

'use strict';

const Project = require('../models/Project');
const Device = require('../models/Device');
const { tokensMatch } = require('../utils/crypto');

/**
 * authenticate
 *
 * Verifies project API key (used by SDK for registration sessions, status checks, error reports).
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing or invalid Authorization header. Expected: Bearer <token>',
      });
    }

    const apiKey = authHeader.slice(7).trim();
    if (!apiKey) {
      return res.status(401).json({ error: 'API key is empty' });
    }

    const projectId = req.params.id || req.params.projectId || req.headers['x-project-id'];

    const project = await Project.findById(projectId).select('+projectKeyHash');

    if (!project) {
      return res.status(401).json({ error: 'Invalid project ID or API key' });
    }

    if (project.status !== 'active') {
      return res.status(403).json({ error: 'Project is not active' });
    }

    const isValid = tokensMatch(apiKey, project.projectKeyHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid project ID or API key' });
    }

    req.project = project;
    next();
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(401).json({ error: 'Invalid project ID or API key' });
    }
    next(err);
  }
}

/**
 * authenticateDevice
 *
 * Verifies mobile companion app device credential.
 * Expects:
 *   Authorization: Bearer <deviceCredential>
 *   X-Device-Id: <deviceId> (or req.params.id on /api/devices/:id)
 */
async function authenticateDevice(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing or invalid Authorization header. Expected: Bearer <deviceCredential>',
      });
    }

    const credential = authHeader.slice(7).trim();
    if (!credential) {
      return res.status(401).json({ error: 'Device credential is empty' });
    }

    const deviceId = req.headers['x-device-id'] || req.params.id;
    if (!deviceId) {
      return res.status(401).json({ error: 'Missing device ID. Expected X-Device-Id header or URL parameter.' });
    }

    const device = await Device.findById(deviceId).select('+deviceCredentialHash');
    if (!device) {
      return res.status(401).json({ error: 'Invalid device ID or credential' });
    }

    if (!device.isActive) {
      return res.status(403).json({ error: 'Device is inactive or has been disconnected' });
    }

    const isValid = tokensMatch(credential, device.deviceCredentialHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid device ID or credential' });
    }

    const project = await Project.findById(device.projectId);
    if (!project || project.status !== 'active') {
      return res.status(403).json({ error: 'Associated project is inactive or not found' });
    }

    // Touch device lastSeenAt quietly
    device.lastSeenAt = new Date();
    await device.save();

    req.device = device;
    req.project = project;
    next();
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(401).json({ error: 'Invalid device ID or credential' });
    }
    next(err);
  }
}

/**
 * authenticateProjectOrDevice
 *
 * Unified authentication for endpoints accessible to BOTH the SDK and Mobile app:
 * - If X-Device-Id is present, authenticates as mobile device.
 * - Otherwise, authenticates as project API key.
 */
async function authenticateProjectOrDevice(req, res, next) {
  if (req.headers['x-device-id']) {
    return authenticateDevice(req, res, next);
  }
  return authenticate(req, res, next);
}

module.exports = {
  authenticate,
  authenticateDevice,
  authenticateProjectOrDevice,
};
