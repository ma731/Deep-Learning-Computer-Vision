# Deploy & demo guide

FreshGuard is two parts: a **heavy backend** (FastAPI + TensorFlow + YOLO +
the trained model) and a **light frontend** (static HTML/CSS/JS). The backend
can't run on Vercel/serverless (TF + YOLO + model far exceed the size and
runtime limits), so pick the path that fits.

## ⭐ Recommended for the live demo: laptop + HTTPS tunnel

Runs everything locally and gives a public HTTPS URL — so the professor can
**scan a QR code and try it on their own phone**. No cloud, no wifi-dependent
backend, model runs on the laptop.

```bash
# 1. run the app (frontend + API, one origin)
uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000

# 2. expose it over HTTPS (iOS needs HTTPS for the camera)
ngrok http 8000          # -> https://xxxx.ngrok-free.app
```

Open the ngrok URL on the laptop for the projector, and make a QR of the same
URL for the audience. The page serves the camera UI and the API from one
origin, so there's no CORS and nothing else to configure.

> Make the QR with any generator (e.g. paste the ngrok URL into one). Test it
> on your own phone during rehearsal — ngrok URLs change each run unless you
> have a reserved domain, so generate the QR right before presenting.

## Optional: always-on public frontend on Vercel

Useful for a permanent link in the README/deck. The frontend deploys static;
it then needs to reach a hosted backend.

```bash
cd frontend
vercel deploy --prod        # deploys the static UI
```

Point the deployed page at a backend with `?api=`:
`https://your-app.vercel.app/?api=https://your-backend-url`
(the value is saved to localStorage so a scanned QR keeps working). CORS is
already open on the backend. The backend still needs a host that can run
TensorFlow — a tunnel (above), or a container host like Render / Railway /
Hugging Face Spaces. For grading and the live demo, the tunnel path is
simpler and more robust; Vercel is just a nice-to-have public link.

## Local dev (no tunnel)

```bash
uvicorn main:app --app-dir backend --port 8000
# http://localhost:8000  (laptop webcam works on localhost without HTTPS)
```
