# A Step in the Right Direction — Tracker

A walk, workout and step tracker. Record walking routes on a map (GPS or click),
generate and log single-day workouts, track daily steps against a goal, and review
everything on a calendar. Data is stored locally in your browser (`localStorage`);
there is no backend.

Built with TanStack Start, React 19, Tailwind CSS 4 and Leaflet. Developed with
[Lovable](https://lovable.dev/projects/37e398cd-5d0e-4cd3-ac11-af7a1a4e19ad); changes
pushed to `main` sync back into Lovable.

## Development

Uses [Bun](https://bun.sh).

```sh
bun install
bun run dev        # start the dev server
bun run typecheck  # TypeScript check
bun run build      # production build
```

## Notes

- Don't rewrite published git history on `main` — it syncs with Lovable.
- Walk paths use the browser Geolocation API, so recording needs location permission.
