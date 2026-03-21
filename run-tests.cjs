const { spawnSync } = require('child_process');
const fs = require('fs');

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [
  'App.special_moves.test.tsx',
  'modules/specialMoves/client/specialMovesClient.fallback.test.ts'
];

console.log('Running tests:', files.join(', '));

const result = spawnSync(
  'npx',
  ['vitest', 'run', ...files, '--reporter=verbose'],
  {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    shell: true
  }
);

const output = (result.stdout || '') + (result.stderr || '');
fs.writeFileSync('run-tests-out.txt', output);

// Print summary lines
const lines = output.split('\n');
const summaryLines = lines.filter(l =>
  /PASS|FAIL|pass|fail|Tests |Duration|Error|FALLBACK|✓|✗/.test(l)
);
console.log('\n=== SUMMARY ===');
summaryLines.forEach(l => console.log(l));
console.log('\n=== EXIT CODE:', result.status, '===');
console.log('Full output written to: run-tests-out.txt (' + output.length + ' bytes)');

