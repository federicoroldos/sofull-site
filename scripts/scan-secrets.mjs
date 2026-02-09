import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const run = (command) => execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const root = process.cwd();
const tracked = run('git ls-files -z')
  .split('\0')
  .filter(Boolean);

const patterns = [
  {
    name: 'Private key block',
    regex: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g
  },
  {
    name: 'Firebase service account JSON',
    regex: /"type"\s*:\s*"service_account"[\s\S]*?"private_key"\s*:\s*"[^"]{20,}"/g
  },
  {
    name: 'Google API key',
    regex: /AIza[0-9A-Za-z_-]{35}/g
  },
  {
    name: 'Brevo API key',
    regex: /xkeysib-[0-9a-zA-Z]{10,}/g
  },
  {
    name: 'Stripe live key',
    regex: /sk_live_[0-9a-zA-Z]{16,}/g
  }
];

const isBinary = (buffer) => buffer.includes(0);

const findings = [];

for (const file of tracked) {
  const fullPath = path.join(root, file);
  let buffer;
  try {
    buffer = fs.readFileSync(fullPath);
  } catch {
    continue;
  }
  if (isBinary(buffer)) continue;
  const content = buffer.toString('utf8');

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(content)) {
      findings.push({ file, pattern: pattern.name });
      break;
    }
  }
}

if (findings.length) {
  console.error('Secret scan failed. Potential secrets detected:');
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.pattern}`);
  }
  process.exit(1);
}

console.log(`Secret scan passed (${tracked.length} files scanned).`);
