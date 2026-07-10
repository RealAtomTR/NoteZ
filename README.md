# NoteZ

NoteZ is a desktop-first reminder and task assistant built with Electron. It helps users capture tasks quickly, organize them into categories, and surface the right reminders at the right time. The current focus is on the Windows desktop experience, with mobile support planned later.

## What NoteZ does

- Captures tasks with quick input so adding a task takes only a couple of seconds.
- Organizes work into categories, subcategories, and notes.
- Uses popup reminders, countdown flows, and status actions to keep tasks visible.
- Supports local-first storage, with task data mirrored into Markdown files for portability and future import/export workflows.
- Includes debugging and developer visibility tools for popup scheduling, queue state, window tracking, and check-in flows.

## Main areas

- **Desktop UI**: task lists, detail panels, filters, stats, and popup controls.
- **Electron backend**: reminder scheduling, popup rules, window tracking, and database synchronization.
- **Markdown storage**: local files used for notes, categories, and future interoperability.
- **Debug tools**: panel controls and runtime visibility for troubleshooting popup and check-in behavior.

## Project goals

- Keep the app local-first.
- Make task capture fast and low-friction.
- Avoid popup spam while still keeping tasks visible.
- Preserve a clean separation between UI and backend responsibilities.
- Support future workflows like Obsidian-style linking, import/export, and analytics.

## Run

```bash
npm install
npm start
```

## Notes

- The active working docs live in `docs/`.
- UI and backend agents use separate job files to avoid overlapping changes.
