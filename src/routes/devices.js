// apps/server/src/routes/devices.js
//
// Device management endpoints:
//   DELETE /api/devices/:id → Disconnects/unpairs a mobile device
//
// Requires device authentication (Bearer <deviceCredential> and X-Device-Id or :id).

'use strict';

const express = require('express');
const router = express.Router();

const Device = require('../models/Device');
const Project = require('../models/Project');
const { authenticateDevice } = require('../middleware/authenticate');

// ─── DELETE /api/devices/:id ─────────────────────────────────────────────────
// Mark the device as inactive so it stops receiving notifications
router.delete('/:id', authenticateDevice, async (req, res, next) => {
  try {
    const deviceId = req.params.id;

    // Verify the authenticated device matches the target ID
    if (req.device._id.toString() !== deviceId) {
      return res.status(403).json({ error: 'Cannot unpair a different device' });
    }

    req.device.isActive = false;
    await req.device.save();

    // Check if any other active devices remain for this project
    const remainingCount = await Device.countDocuments({
      projectId: req.device.projectId,
      isActive: true,
    });

    if (remainingCount === 0) {
      await Project.findByIdAndUpdate(req.device.projectId, { hasActiveDevice: false });
    }

    res.json({
      success: true,
      message: 'Device disconnected successfully',
      deviceId: req.device._id,
      remainingActiveDevices: remainingCount,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

