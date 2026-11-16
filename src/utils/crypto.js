// apps/server/src/utils/crypto.js
//
// Helpers for generating and comparing secret tokens.
// We use Node's built-in 'crypto' module — no extra package needed.
//
// WHY we hash tokens before storing them:
//   If your database is ever stolen, an attacker should not be able to
//   use the data they find. A SHA-256 hash of a random 32-byte token
//   is one-way: you can verify "does this plaintext match this hash?"
//   but you cannot reverse the hash back to the original token.
//
// WHY SHA-256 (not bcrypt) for tokens:
//   bcrypt is designed for low-entropy secrets like passwords (which
//   humans choose and re-use). Our tokens are high-entropy random bytes
//   (256 bits), so a slow hash is not necessary. SHA-256 is fast and
//   correct for this use case.

'use strict';

const crypto = require('crypto');

/**
 * generateToken(byteLength?)
 *
 * Generates a cryptographically random token as a hex string.
 * 32 bytes → 64 hex characters. Used for API keys and pairing tokens.
 */
function generateToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * hashToken(plaintext)
 *
 * Returns the SHA-256 hash of a string, encoded as hex.
 * This is what we store in the database.
 */
function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

/**
 * tokensMatch(plaintext, storedHash)
 *
 * Safely compares a plaintext token to a stored SHA-256 hash.
 *
 * We use crypto.timingSafeEqual to prevent "timing attacks".
 * A normal string comparison (===) returns early when it finds
 * the first mismatched character. An attacker can measure response
 * time to guess how many characters are correct. timingSafeEqual
 * always takes the same amount of time regardless of where the
 * strings differ.
 */
function tokensMatch(plaintext, storedHash) {
  const incomingHash = hashToken(plaintext);

  // Both must be hex strings of the same length (SHA-256 → 64 hex chars).
  // If lengths differ, timingSafeEqual would throw, so we check first.
  if (incomingHash.length !== storedHash.length) return false;

  const a = Buffer.from(incomingHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');

  return crypto.timingSafeEqual(a, b);
}

module.exports = { generateToken, hashToken, tokensMatch };

