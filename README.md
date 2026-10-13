# Cliploom

Next.js App Router starter with TypeScript, Tailwind CSS, and ESLint.

## Local development

Use Node.js 20.9 or newer and npm.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Edit `src/app/page.tsx` to update the home page.
Shared layout and styles live in `src/app/layout.tsx` and `src/app/globals.css`.
The `@/*` import alias points to `src/*`.

On Windows, if PowerShell blocks npm scripts, use `npm.cmd` in place of `npm`.

## Checks and production

```sh
npm run lint
npx tsc --noEmit
npm run build
npm start
```

`npm start` serves the production build after `npm run build`.
