# تقريباً (Taqreeban) — Arabic estimation party game

One screen shows the questions (TV / shared screen). Everyone guesses on their phone after scanning a QR code.
Closest guess wins. Score = how many times off you were (×1 = perfect). Lower is better.

## How a game runs
1. Host opens `/host` → **إنشاء غرفة جديدة** → QR code + 4-letter room code appear.
2. Players scan the QR (or open `/play` and type the code), enter a name, pick a team if team mode is on.
3. Host picks: فردي / فرق (2–6 teams), timer 30 / 45 / 60 s → **ابدأ اللعبة**.
4. For each of the 10 questions: host presses **ابدأ** (or Space) → question + timer → phones lock in guesses →
   reveal (answer, source, napkin math, everyone's guesses on a log-scale line) → leaderboard → next.
5. Final podium → **جولة جديدة** keeps the same players and avoids repeating questions.

## Scoring (lib/scoring.js)
- Question score = max(guess/answer, answer/guess). No cap.
- No answer = 100× or the worst guess on that question, whichever is bigger.
- Round score = plain average of the 10 question scores.
- Team question score = plain average of its members' scores.

## Run locally
```bash
npm install
npm start            # http://localhost:3000/host
npm test             # with the server running: full 10-question simulated team game
```
Phones on the same Wi-Fi can join via `http://<your-computer-ip>:3000/play`.

## Deploy (Render, free)
1. Push this folder to a new GitHub repo.
2. render.com → sign in with GitHub → **New → Blueprint** → pick the repo (uses `render.yaml`).
3. Open `https://<your-app>.onrender.com/host`.

Free tier sleeps after 15 min idle; the first visit wakes it (can take up to ~1 min). Open the host page a minute before guests arrive.
Games live in memory: a server restart ends any game in progress.

## Questions (data/questions.json)
Each question: `text`, `unit` (metric), `answer`, `year`, `source {name,url}`, `napkin` (quick reasoning),
`category`, `scope` (kuwait / gcc / world), `verified`. Only `verified: true` questions are used.

## Settings
- Arabic-Indic vs Western digits: `DIGITS` in `public/shared.js`.
- Game name: `GAME_NAME` in `public/shared.js` and the titles in `public/*.html`.
