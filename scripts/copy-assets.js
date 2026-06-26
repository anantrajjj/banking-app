/**
 * Post-build asset copier.
 *
 * 1. Copies the built frontend (frontend/dist) into api/dist/public so the API
 *    can serve the SPA from the same origin (FRONTEND_DIR default).
 * 2. Copies SQL migrations into api/dist/db/migrations so the compiled
 *    migration runner can find them at runtime.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function copyDir(src, dest, label) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠  skipped (missing): ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`  ✔  ${label}: ${src} -> ${dest}`);
}

console.log('📂  Copying build assets...');
copyDir(
  path.join(root, 'frontend', 'dist'),
  path.join(root, 'api', 'dist', 'public'),
  'frontend',
);
copyDir(
  path.join(root, 'api', 'src', 'db', 'migrations'),
  path.join(root, 'api', 'dist', 'db', 'migrations'),
  'migrations',
);
console.log('✅  Assets copied.');
