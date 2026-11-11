import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function hashes(directory, prefix = '') {
  const entries = {};
  for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error(`Символическая ссылка не включается в релиз: ${relative}`);
    if (item.isDirectory()) Object.assign(entries, hashes(join(directory, item.name), relative));
    else if (item.isFile()) entries[relative] = createHash('sha256').update(readFileSync(join(directory, item.name))).digest('hex');
  }
  return entries;
}

function sourceVersion(root, dist) {
  let sourceCommit = null;
  let sourceDirty = null;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().length > 0;
  } catch { /* Source ZIPs intentionally work without a .git directory. */ }
  return { packagedAt: new Date().toISOString(), sourceCommit, sourceDirty, buildFilesSha256: hashes(dist) };
}

/** Build in a fresh directory; publish the complete ZIP only after all inputs succeed. */
export function packageProject(root = process.cwd()) {
  root = resolve(root);
  if (!existsSync(join(root, 'dist/index.html'))) throw new Error('Сначала выполните npm run build');
  const releaseRoot = join(root, 'release');
  mkdirSync(releaseRoot, { recursive: true });
  const stage = mkdtempSync(join(releaseRoot, '.oqy-stage-'));
  const prepared = join(stage, 'OQY');
  const destination = join(releaseRoot, 'OQY');
  const previous = join(stage, 'previous-OQY');
  let swapped = false;
  let published = false;
  try {
    mkdirSync(prepared);
    for (const item of ['dist', 'artifacts', 'docs']) cpSync(join(root, item), join(prepared, item), { recursive: true });
    cpSync(join(root, 'README.md'), join(prepared, 'SOURCE-README.md'));
    cpSync(join(root, 'HANDOFF.md'), join(prepared, 'HANDOFF.md'));
    cpSync(join(root, 'public/pitch.html'), join(prepared, 'presentation.html'));
    writeFileSync(join(prepared, 'VERSION.json'), JSON.stringify(sourceVersion(root, join(prepared, 'dist')), null, 2) + '\n');
    writeFileSync(join(prepared, 'start.py'), `from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os, webbrowser
from threading import Timer
os.chdir(Path(__file__).resolve().parent / 'dist')
port = int(os.environ.get('OQY_PORT', '4173'))
url = f'http://127.0.0.1:{port}'
try:
    server = ThreadingHTTPServer(('127.0.0.1', port), SimpleHTTPRequestHandler)
except OSError:
    print(f'Порт {port} занят. Закройте старый сервер или задайте OQY_PORT.')
    raise SystemExit(1)
print(f'OQY: {url} — Ctrl+C для остановки', flush=True)
if not os.environ.get('OQY_NO_BROWSER'):
    Timer(1, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
`);
    writeFileSync(join(prepared, 'START-HERE.txt'), `OQY — комплект для демонстрации

1. Распакуйте архив.
2. В папке OQY выполните: python3 start.py (Windows: python start.py).
3. Откроется http://127.0.0.1:4173.

Нужен Python 3. Интернет и Node.js для этого комплекта НЕ нужны.
Для остановки нажмите Ctrl+C в терминале. Другой порт: переменная OQY_PORT.

Презентация: artifacts/OQY-pitch.pdf или presentation.html.
Текст защиты: docs/PITCH.md. Ответы жюри: docs/JURY_QA.md.
Запасной показ: artifacts/e2e-overview.png и e2e-plan.png — сохранённый демонстрационный результат, синтетические данные.
Версия и контрольные суммы сборки: VERSION.json.

Исходный код — приватный репозиторий https://github.com/Nurdaulet362/oqy-curriculum
Весь набор демонстрационных данных вымышленный.
`);
    writeFileSync(join(prepared, 'README.md'), `# OQY — готовое демо

В этом архиве уже собранное приложение. Установка npm не требуется.

1. Установите Python 3, если он отсутствует.
2. Откройте терминал в этой папке и выполните: \`python3 start.py\` (Windows: \`python start.py\`).
3. Откроется http://127.0.0.1:4173. Остановка — Ctrl+C.

После распаковки интернет не нужен. При занятом порте задайте переменную OQY_PORT.

- [Презентация PDF](artifacts/OQY-pitch.pdf), [автономные слайды](presentation.html).
- [Сценарий защиты](docs/PITCH.md), [ответы жюри](docs/JURY_QA.md).
- [Демо CSV](dist/data/demo.csv), [шаблон CSV](dist/data/template.csv).
- [Версия сборки](VERSION.json), [контрольные суммы файлов этого архива](MANIFEST.json).

README исходного проекта сохранён как SOURCE-README.md; команды npm из него предназначены для исходного ZIP или Git-репозитория, а не этого комплекта.
Исходники: https://github.com/Nurdaulet362/oqy-curriculum (приватный репозиторий).
`);
    // Reject links throughout the package rather than following them into unrelated files.
    const packageFiles = hashes(prepared);
    writeFileSync(join(prepared, 'MANIFEST.json'), JSON.stringify({ scope: 'Paths relative to extracted OQY directory; excludes MANIFEST.json itself', filesSha256: packageFiles }, null, 2) + '\n');
    const stagedZip = join(stage, 'OQY-demo');
    execFileSync('python3', ['-c', 'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2], "OQY")', stagedZip, stage]);
    if (existsSync(destination)) renameSync(destination, previous);
    try {
      renameSync(prepared, destination);
      swapped = true;
      // Same-filesystem rename atomically replaces only a fully written archive.
      renameSync(`${stagedZip}.zip`, join(releaseRoot, 'OQY-demo.zip'));
      published = true;
    } catch (error) {
      if (swapped) rmSync(destination, { recursive: true, force: true });
      if (existsSync(previous)) renameSync(previous, destination);
      throw error;
    }
    return join(releaseRoot, 'OQY-demo.zip');
  } finally {
    // Only generated staging data is removed; on failure the last ZIP is unchanged.
    rmSync(stage, { recursive: true, force: true });
    if (published) console.log('release/OQY-demo.zip');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) packageProject();
