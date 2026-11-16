// apps/server/src/routes/errors.js
//
// Routes:
//   POST /api/errors            → Report and record an error event, trigger push notification (SDK)
//   GET  /api/errors            → Retrieve recent error history (SDK or paired Mobile device)
//   GET  /api/errors/:eventId   → Retrieve single error details (SDK or paired Mobile device)

'use strict';

const express = require('express');
const router = express.Router();

const ErrorEvent = require('../models/ErrorEvent');
const { authenticate, authenticateProjectOrDevice } = require('../middleware/authenticate');
const { sendPushNotification } = require('../services/pushNotification');

// Helper: sanitize a stack trace string.
// Removes lines from node_modules (usually not useful to the developer)
// and caps the total length to avoid huge database documents.
function sanitizeStack(rawStack) {
  if (!rawStack || typeof rawStack !== 'string') return undefined;

  return rawStack
    .split('\n')
    .filter((line) => !line.includes('node_modules'))
    .join('\n')
    .slice(0, 3000);
}

// ─── POST /api/errors ────────────────────────────────────────────────────────
// Called by SDK error middleware or captureError().
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { eventType, message, stack, statusCode, route, correlationId, timestamp } =
      req.body;

    // Validate required fields.
    if (!eventType || !['middleware', 'manual'].includes(eventType)) {
      return res.status(400).json({
        error: "eventType must be 'middleware' or 'manual'",
      });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    // Only report 5xx errors automatically (4xx are expected user errors).
    // 'manual' events bypass this check — the developer chose to report it.
    if (eventType === 'middleware' && statusCode && statusCode < 500) {
      return res.status(204).send(); // Accepted but not stored
    }

    const errorEvent = await ErrorEvent.create({
      projectId: req.project._id,
      eventType,
      message: message.slice(0, 500),
      safeStack: sanitizeStack(stack),
      statusCode: Number.isInteger(statusCode) ? statusCode : undefined,
      route: typeof route === 'string' ? route.slice(0, 200) : undefined,
      correlationId: typeof correlationId === 'string' ? correlationId.slice(0, 100) : undefined,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    // Fire and forget push notifications to all paired active devices
    sendPushNotification(req.project, errorEvent).catch((err) => {
      console.warn('[Errors Route] Background push delivery error:', err.message);
    });

    res.status(201).json({
      eventId: errorEvent._id,
      message: 'Error event recorded and push notification dispatched.',
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/errors ─────────────────────────────────────────────────────────
// List recent error events for the authenticated project.
// Accessible by BOTH the SDK (using project API key) and Mobile App (using device credential).
router.get('/', authenticateProjectOrDevice, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const [events, totalCount] = await Promise.all([
      ErrorEvent.find({ projectId: req.project._id })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v'),
      ErrorEvent.countDocuments({ projectId: req.project._id }),
    ]);

    res.json({
      events,
      totalCount,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/errors/:eventId ─────────────────────────────────────────────────
// Get details for a single error event.
// Accessible by BOTH the SDK (using project API key) and Mobile App (using device credential).
router.get('/:eventId', authenticateProjectOrDevice, async (req, res, next) => {
  try {
    const event = await ErrorEvent.findOne({
      _id: req.params.eventId,
      projectId: req.project._id, // ensure the event belongs to this project
    }).select('-__v');

    if (!event) {
      return res.status(404).json({ error: 'Error event not found' });
    }

    res.json({ event });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: 'Error event not found' });
    }
    next(err);
  }
});

module.exports = router;
