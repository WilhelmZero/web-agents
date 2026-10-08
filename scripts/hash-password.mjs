import { passwordHash } from '../server/security.mjs';

async function readPassword() {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) value += chunk;
    return value.replace(/\r?\n$/, '');
  }
  process.stdout.write('Password (input hidden): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolve) => {
    let value = '';
    process.stdin.on('data', (chunk) => {
      const char = chunk.toString('utf8');
      if (char === '\r' || char === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); resolve(value); }
      else if (char === '\u0003') { process.stdin.setRawMode(false); process.exit(130); }
      else if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
      else value += char;
    });
  });
}

try { process.stdout.write(`${passwordHash(await readPassword())}\n`); }
catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
