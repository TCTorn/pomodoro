# Pomodoro app

Plain HTML, CSS and JavaScript. No build step, no dependencies.

## Run

Serve the folder and open it in a browser. Do not double-click `index.html`:
ES modules do not load from `file://`.

- Linux: `python3 -m http.server`
- Windows: `py -m http.server`

Then open http://localhost:8000.

Optional testing aid: `?focus=0.1` gives a six-second focus phase.
When a phase ends the app moves to the next one (short break, long break after every 4th focus session, then focus) and waits for Start.

## Test

`node --test`
