# LaLiga Brains on Render

This copy runs the website and its API on Render. Firebase Authentication, Realtime Database, and Storage remain the app's existing data services.

## Deploy

Create a Render Blueprint from this repository and apply `render.yaml`. It creates a Node web service and a Render Key Value instance in Frankfurt. The Blueprint intentionally leaves the Piero identity and PIN hash unsynced so they can be entered as Render environment variables without putting them in Git.

Set these values in the web service's Environment page:

- `PIERO_EMAIL`: the Firebase Authentication email used for the Piero account.
- `PIERO_PIN_SHA512`: SHA-512 hex digest of the existing four-digit Piero PIN.
- `PIERO_TOKEN_ENCRYPTION_KEY`: a new 32-byte Base64URL key. Do not reuse or commit it.

Render generates `CRON_SECRET` and supplies the private `REDIS_URL` from the Render Key Value service. After the first deploy, unlock Piero mode once to establish the Firebase session in the new Render instance.

## Run locally

```sh
npm ci
npm run build
REDIS_URL=redis://localhost:6379 npm start
```

## Free service limits

The Blueprint uses Render's free web and Key Value plans. Free web services can sleep when idle; free Key Value stores data in memory and can lose it on restart. If that happens, unlock Piero mode again to reconnect the backend to Firebase. Choose persistent paid plans before relying on this copy as the only production deployment.
