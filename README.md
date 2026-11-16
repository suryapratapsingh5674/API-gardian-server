# API Guardian — Central Backend Service

> The central Node.js/Express and MongoDB backend for API Guardian. Responsible for project registration, pairing sessions, mobile device authentication, error ingestion, and chunked Expo push notification dispatching.

---

## Architecture Overview

```
apps/server/
├── src/
│   ├── app.js               # Express app configuration & middleware
│   ├── index.js             # Server entry point & database connection
│   ├── db.js                # Mongoose connection manager
│   ├── models/
│   │   ├── Project.js       # Registered API projects
│   │   ├── Device.js        # Paired mobile devices & credentials
│   │   ├── PairingSession.js# Ephemeral 10-minute pairing tokens (TTL indexed)
│   │   └── ErrorEvent.js    # Ingested sanitized error events (TTL indexed)
│   ├── routes/
│   │   ├── projects.js      # Project registration & status checks
│   │   ├── pairing.js       # Mobile QR code pairing (POST /api/pair)
│   │   ├── errors.js        # Error ingestion & history queries
│   │   └── devices.js       # Device unpairing & management
│   ├── middleware/
│   │   ├── authenticate.js  # Project API key & mobile device authentication
│   │   └── rateLimiter.js   # Endpoint rate limiting
│   ├── services/
│   │   └── pushNotification.js # Expo Push API delivery service
│   └── utils/
│       └── crypto.js        # SHA-256 hashing & timing-safe token comparison
├── tests/                   # 45 automated unit and integration tests
├── .env.example             # Environment variable template
└── package.json
```

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server listening port | `3001` |
| `NODE_ENV` | Environment mode (`development` or `production`) | `development` |
| `MONGODB_URI` | MongoDB connection string (Local or MongoDB Atlas) | `mongodb://localhost:27017/api-guardian` |
| `JWT_SECRET` | Secret string for hashing/signing | Random hex string |
| `EXPO_PUSH_URL` | Expo push notification gateway | `https://exp.host/--/api/v2/push/send` |

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode (with file watching)
npm run dev

# 3. Run full automated test suite (45 tests)
npm test
```

---

## Production Deployment

### Option A: Render.com (Recommended)
1. Push your repository to GitHub.
2. In Render Dashboard, click **New > Web Service** and connect your repository.
3. Configure settings:
   - **Root Directory:** `apps/server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. In **Environment Variables**, add:
   - `NODE_ENV` = `production`
   - `MONGODB_URI` = Your MongoDB Atlas connection string (`mongodb+srv://...`)
   - `JWT_SECRET` = A secure random 64-character hex string
5. Click **Deploy Web Service**. Your service URL will be: `https://api-guardian-server.onrender.com`.

### Option B: Railway.app
1. Click **New Project > Deploy from GitHub repo**.
2. Set Root Directory to `apps/server`.
3. Add MongoDB plugin or connect external MongoDB Atlas URI.
4. Set environment variables and click Deploy.

---

## API Endpoints Reference

### Public & Health
* `GET /health` — Service health and uptime check.

### Projects & Pairing (SDK & Mobile)
* `POST /api/projects` — Register a new project (returns `{ projectId, apiKey }`).
* `GET /api/projects/:id/status` — Get active paired device count (`Bearer <apiKey>`).
* `POST /api/projects/:id/sessions` — Generate single-use 10-minute pairing token.
* `POST /api/pair` — Submit pairing token and mobile device Expo Push Token.

### Error Ingestion & Alerts
* `POST /api/errors` — Ingest sanitized error from SDK middleware (`Bearer <apiKey>`). Dispatches high-priority push notifications to all paired devices.
* `GET /api/errors?limit=30` — Fetch recent error events for paired mobile device.
* `GET /api/errors/:id` — Retrieve full error event and sanitized stack trace.
* `DELETE /api/devices/:id` — Unpair mobile device.

---

## License

MIT © API Guardian Authors
