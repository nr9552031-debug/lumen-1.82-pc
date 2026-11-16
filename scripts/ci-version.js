// Prints the version for this CI build: <major>.<minor> from package.json, then a patch that goes up by one every build.
// patch = GITHUB_RUN_NUMBER - versionBuildOffset (offset lives in package.json).
// To start a new minor (e.g. 1.9): set package.json "version" to "1.9.0" and set "versionBuildOffset" to the current run number - 1.
// Usage: node scripts/ci-version.js        -> prints e.g. 1.8.3
//        node scripts/ci-version.js --apply -> also writes it into package.json (CI only; not committed)
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const [major, minor] = pkg.version.split('.');
const run = parseInt(process.env.GITHUB_RUN_NUMBER || '', 10);
const offset = pkg.versionBuildOffset || 0;
const patch = Number.isFinite(run) ? Math.max(0, run - offset) : parseInt(pkg.version.split('.')[2] || '0', 10);
const version = `${major}.${minor}.${patch}`;
if (process.argv.includes('--apply')) {
  pkg.version = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
console.log(version);
