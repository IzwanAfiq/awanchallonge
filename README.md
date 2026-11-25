# Awan Challonge: live tournament brackets

A lightweight tournament bracket system, inspired by [evroon/bracket](https://github.com/evroon/bracket), built for running events on the day:

- **Phone scoring, live:** organisers open the scoring page on their phones and tap big **+1 / +2 / +3 / −1** buttons. Every screen updates instantly over WebSockets.
- **Match time limits:** each match has a countdown clock (start, pause, ±10s, ±1m, reset). It turns amber in the last 30 seconds and flashes red with overtime (`+0:12`) when time is up. Phones vibrate when the clock hits zero.
- **Big-screen display:** put `/t/<id>` on a TV or projector. It shows live matches with large scores and timers, plus the full bracket or league table. It has a **QR code** button so scorers can join from their phones.
- **Formats:** single elimination (knockout, automatic byes and seeding) and round robin (league table: 3 points for a win, 1 for a draw, ranked by points, then score difference, then points scored).
- Winners advance automatically. A finished match can be reopened to fix a mistake, as long as the next match hasn't started.
- Organiser actions are protected by a PIN. Anyone can watch.

## Run it

Requires Node.js 18+.

```bash
npm install
```

```bash
ADMIN_PIN=2468 npm start
```

The server prints its addresses:

```
Tournament server running on http://localhost:3000
  On your phone (same Wi-Fi): http://192.168.1.23:3000
```

1. Open `http://localhost:3000` on the laptop, create a tournament (teams one per line, time limit per match).
2. Open the **📺 Display** page on the TV/projector.
3. Press **📱 Score on phone** and scan the QR code with each scorer's phone (phones must be on the same Wi-Fi). Enter the PIN once; it's remembered on that phone.
4. On the phone: pick a match → **▶ Start** the clock → tap points → **✅ Finish match**.

For scoring over mobile data instead of Wi-Fi, deploy the app to any Node host (Render, Railway, Fly.io, a VPS) and set `ADMIN_PIN`.

## Settings (environment variables)

| Variable    | Default         | Meaning                                    |
|-------------|-----------------|--------------------------------------------|
| `ADMIN_PIN` | `1234`          | PIN for creating, scoring and deleting     |
| `PORT`      | `3000`          | HTTP port                                  |
| `DATA_FILE` | `data/db.json`  | Where tournaments are saved                |

## Pages

| URL              | For                                     |
|------------------|-----------------------------------------|
| `/`              | List, create, delete tournaments        |
| `/t/<id>`        | Big-screen bracket / standings + timers |
| `/t/<id>/score`  | Phone scoring                           |

## Development

```bash
npm test
```

- `lib/bracket.js`: bracket generation, scoring, timers, advancement, standings (pure functions, unit tested)
- `lib/store.js`: JSON-file persistence
- `server.js`: Express + Socket.IO server
- `public/`: plain HTML/JS front end (no build step)
