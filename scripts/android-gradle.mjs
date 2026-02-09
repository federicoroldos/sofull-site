import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const task = process.argv[2];
if (!task) {
  console.error('Usage: node scripts/android-gradle.mjs <gradle-task>');
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const gradlew = isWindows ? 'gradlew.bat' : './gradlew';
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'android');

const child = spawn(gradlew, [task], { cwd, stdio: 'inherit', shell: isWindows });
child.on('exit', (code) => {
  process.exit(code ?? 1);
});
