// apps/server/src/middleware/rateLimiter.js
//
// Rate limiting for anonymous (unauthenticated) endpoints.
//
// WHY rate limiting?
//   Without it, anyone could flood POST /api/projects with thousands of
//   fake project registrations, filling your database and hitting your
//   MongoDB storage limits.
//
// We apply different limits to different endpoints:
//   - Project creation: 10 per IP per hour (strict — one-time action)
//   - Pairing consumption: 20 per IP per 15 minutes (slightly looser — scanning may retry)
//
// The 'express-rate-limit' package tracks request counts in memory by default.
// For multiple server instances you would use a shared store (e.g. Redis),
// but for our single-server MVP, in-memory is fine.

'use strict';

const rateLimit = require('express-rate-limit');

// Applied to POST /api/projects (anonymous project creation).
const projectCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,                   // max 10 requests per IP per window
  standardHeaders: true,     // return rate-limit info in RateLimit-* headers
  legacyHeaders: false,
  message: {
    error: 'Too many project registration requests. Please try again in an hour.',
  },
});

// Applied to POST /api/pair (anonymous pairing token consumption).
const pairingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many pairing attempts. Please try again in 15 minutes.',
  },
});

module.exports = { projectCreationLimiter, pairingLimiter };

