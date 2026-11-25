# Awan Challonge: live tournament brackets

A lightweight tournament bracket system, inspired by [evroon/bracket](https://github.com/evroon/bracket), built for running events on the day:

- **Phone scoring, live:** organisers open the scoring page on their phones and tap big **+1 / +2 / +3 / −1** buttons. Every screen updates instantly over WebSockets.
- **Match time limits:** each match has a countdown clock (start, pause, ±10s, ±1m, reset). It turns amber in the last 30 seconds and flashes red with overtime (`+0:12`) when time is up. Phones vibrate when the clock hits zero.
- **Big-screen display:** put `/t/<id>` on a TV or projector. It shows live matches with large scores and timers, plus the full bracket or league table. It has a **QR code** button so scorers can join from their phones.
- **Formats:** single elimination (knockout, automatic byes and seeding) and round robin (league table: 3 points for a win, 1 for a draw, ranked by points, then score difference, then points scored).
- Winners advance automatically. A finished match can be reopened to fix a mistake, as long as the next match hasn't started.
- **Only the organiser can edit:** creating, scoring and deleting require signing in with the organiser ID and password. Everyone else gets view-only pages.
- **Court scorers:** each court has its own PIN (Court 1 = `1111`, Court 2 = `2222`, and so on). Several scorers can enter scores at the same time, but each one can only score and run the clock for matches on their own court.
- **Courts & schedule:** set the number of courts, a start time and a break, and matches are given a court and start time automatically. You can change them per match.
- Neon esports-style interface that works on a TV, a laptop and a phone.

## Run it

Requires Node.js 18+.

```bash
npm install
```

```bash
npm start
```

The server prints its addresses:

```
Tournament server running on http://localhost:3000
  On your phone (same Wi-Fi): http://192.168.1.23:3000
  Sign in as IZWAN to edit scores.
```

1. Open `http://localhost:3000` on the laptop, create a tournament (teams one per line, time limit per match).
2. Open the **📺 Display** page on the TV/projector.
3. Spectators scan the QR code on the display to follow live results on their phones (same Wi-Fi).
4. On your phone, open the tournament's **Score** page and tap the 🔒 lock to sign in. You stay signed in on that phone for 30 days.
5. Pick a match → **▶ Start** the clock → tap points → **✅ Finish match**.

## Court scorer PINs

| Court | Default PIN |
|-------|-------------|
| Court 1 | `1111` |
| Court 2 | `2222` |
| Court 3 | `3333` |
| Court N | the court number written 4 times (Court 10 = `10101010`) |

Scorers open the **Score** page, tap the 🔒 lock, choose **Court scorer** and type their PIN. They can score, run the timer, finish and reopen matches on their court only. They can't move matches, create or delete tournaments, or touch other courts.

The organiser can change any court's PIN under **Court scorer PINs** on the Score page. Changing a PIN signs that court's scorer out straight away. Because the default PINs follow an easy pattern, change them if spectators might guess them. Scorer sign-ins last 24 hours.

## Organiser sign-in

The organiser ID is `IZWAN`. The password is not stored in the code; only a salted scrypt hash of it is (`lib/auth.js`). After 5 wrong attempts, that device is locked out for 5 minutes. To use a different ID or password, set `ADMIN_ID` and `ADMIN_PASSWORD` when starting the server.

For scoring over mobile data instead of Wi-Fi, deploy the app to any Node host (Render, Railway, Fly.io, a VPS). Use HTTPS there so the password isn't sent in the clear.

## Settings (environment variables)

| Variable    | Default         | Meaning                                    |
|-------------|-----------------|--------------------------------------------|
| `ADMIN_ID`  | `IZWAN`         | Organiser sign-in ID                       |
| `ADMIN_PASSWORD` | (built-in) | Overrides the built-in organiser password  |
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
- `lib/auth.js`: organiser sign-in, sessions, lockout
- `lib/store.js`: JSON-file persistence
- `server.js`: Express + Socket.IO server
- `public/`: plain HTML/JS front end (no build step)
