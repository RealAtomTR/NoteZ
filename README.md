# NoteZ Mobile

NoteZ Mobile is the mobile task and planning experience for NoteZ. This branch contains only the Capacitor mobile application; the Electron desktop application is developed separately.

## Features

- Daily task and category views
- Plan wheel with time-based notes and activities
- Sleep, activity, and water tracking
- Weekly statistics and account screens
- Local persistence through the mobile repository layer

## Browser development

```powershell
npm install
npm run mobile:verify
npm run mobile:build
python -m http.server 4173 --directory .capacitor/mobile
```

Open `http://localhost:4173` in a browser.

## Android development

```powershell
npm run mobile:sync
npm run mobile:android:build
```

Desktop Electron source and desktop-only dependencies are intentionally not part of this branch.
