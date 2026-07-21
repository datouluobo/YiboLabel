# YiboLabel Client App

> Status: current frontend workspace note.
> Scope: this file replaces the original Vite template README and only documents project-local frontend usage.

This folder contains the React + TypeScript frontend for the YiboLabel desktop application.

The frontend is built by Vite and hosted by `src/YiboLabel.App` as static files under `wwwroot`.

## Common Commands

Install dependencies:

```powershell
npm install
```

Run the local Vite dev server:

```powershell
npm run dev
```

Run lint:

```powershell
npm run lint
```

Build the production frontend into the ASP.NET Core host:

```powershell
npm run build
```

## Project Notes

- `src/App.tsx` owns the main editor state and wires together the workspace shell.
- `src/components/` contains reusable UI panels and editor surfaces.
- `src/domain/` contains frontend domain helpers for workspace, label geometry, print workflow, and template data.
- `src/hooks/` contains stateful frontend workflow helpers split out of the main app.
- Production output is written to `../wwwroot`; generated files there should be refreshed with `npm run build`.

## Related Docs

- [Root README](E:/Program/YiboLabel/README.md)
- [Documentation Index](E:/Program/YiboLabel/docs/README.md)
- [Template and Lexicon Design](E:/Program/YiboLabel/docs/template-lexicon-design.md)
