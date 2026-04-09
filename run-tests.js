const { spawnSync } = require('child_process');
const fs = require('fs');

const files = process.argv[2] ? [process.argv[2]] : [
  'App.special_moves.test.tsx',
  'modules/specialMoves/client/specialMovesClient.fallback.test.ts'
];

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
  /PASS|FAIL|✓|✗|×|Tests |Duration|ERROR|Error/.test(l)
);
console.log('=== SUMMARY ===');
summaryLines.slice(-30).forEach(l => console.log(l));
console.log('=== EXIT CODE:', result.status, '===');
console.log('Full output: run-tests-out.txt (' + output.length + ' bytes)');

