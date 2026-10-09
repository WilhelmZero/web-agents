import { randomBytes, createHash } from 'node:crypto';

const project = process.argv[2];
if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(project || '')) {
  console.error('Usage: node scripts/create-integration-key.mjs <project-id>');
  process.exitCode = 1;
} else {
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  console.log(JSON.stringify({ project, token, sha256: digest }, null, 2));
}
