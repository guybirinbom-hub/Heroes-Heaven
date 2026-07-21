import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The tailwindcss PostCSS plugin resolves tailwind.config.js from process.cwd(). The dev server is
// launched from a DIFFERENT directory (`vite --config <path>`, because node/npm aren't on PATH here
// — see .claude/launch.json), so with the default lookup Tailwind never found the config and fell
// back to its defaults: content: [] → it emitted Preflight and NOTHING else, deleting every utility
// AND every `@layer components` rule (.btn/.init-row/.chip/.modal-box...). The layout collapsed
// while colours kept working, which made it look like a CSS bug rather than a config one.
// An absolute config path makes this independent of cwd.
const HERE = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: join(HERE, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
