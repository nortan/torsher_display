#!/usr/bin/env node
/*
 * Сборка статической витрины в dist/ (без зависимостей, Node 18+).
 *
 *   node tools/build.mjs              — плеер + данные + фото → dist/
 *   node tools/build.mjs --with-admin — то же + админка (для GitHub Pages)
 *   node tools/build.mjs --server     — полный сайт для PHP-хостинга: плеер + админка + api/ + sql/
 *   node tools/build.mjs --manifest   — только обновить build-files.json
 *
 * build-files.json — список файлов плеера; его же читает админка при сборке ZIP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = new Set(process.argv.slice(2));
const out = path.join(root, 'dist');

const PLAYER = ['index.html', 'app.js', 'styles.css', 'shared', 'vendor/gsap', 'vendor/swiper', 'assets/fonts', 'assets/img'];
const ADMIN = ['admin', 'vendor/jszip', 'vendor/bootstrap', 'docs', 'build-files.json'];
const SERVER = ['api', 'sql', 'uploads/.htaccess', 'content/data.json'];

function walk(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error('Нет файла: ' + rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).sort().flatMap((f) => walk(path.posix.join(rel, f)));
}

const playerFiles = PLAYER.flatMap(walk);
fs.writeFileSync(path.join(root, 'build-files.json'), JSON.stringify(playerFiles, null, 2) + '\n');
console.log(`build-files.json: ${playerFiles.length} файлов плеера`);
if (args.has('--manifest')) process.exit(0);

const data = JSON.parse(fs.readFileSync(path.join(root, 'content/data.json'), 'utf8'));
const photos = new Set();
for (const o of [...(data.dishes || []), ...(data.events || []), ...(data.slides || [])]) if (typeof o.photo === 'string' && o.photo && !/^(https?:|data:)/.test(o.photo)) photos.add(o.photo);
if (data.cafe && data.cafe.logo) photos.add(data.cafe.logo);

const files = new Set(playerFiles);
for (const p of photos) {
  if (fs.existsSync(path.join(root, p))) files.add(p);
  else console.warn('⚠ фото не найдено: ' + p);
}
if (args.has('--with-admin') || args.has('--server')) ADMIN.flatMap(walk).forEach((f) => files.add(f));
// config.php с паролями в сборку не попадает никогда
if (args.has('--server')) SERVER.flatMap(walk).filter((f) => f !== 'api/config.php').forEach((f) => files.add(f));

fs.rmSync(out, { recursive: true, force: true });
for (const f of files) {
  fs.mkdirSync(path.join(out, path.dirname(f)), { recursive: true });
  fs.copyFileSync(path.join(root, f), path.join(out, f));
}

const json = JSON.stringify(data, null, 2);
fs.mkdirSync(path.join(out, 'content'), { recursive: true });
fs.writeFileSync(path.join(out, 'content/data.json'), json + '\n');
fs.writeFileSync(path.join(out, 'content/data.js'), 'window.__TORSHER_DATA__ = ' + json + ';\n');

let commit = process.env.GITHUB_SHA;
if (!commit) { try { commit = execSync('git rev-parse HEAD', { cwd: root }).toString().trim(); } catch { commit = 'local'; } }
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ commit, builtAt: new Date().toISOString() }) + '\n');
fs.copyFileSync(path.join(root, 'docs/SERVER.md'), path.join(out, 'SERVER.md'));
fs.copyFileSync(path.join(root, 'docs/nginx.conf.example'), path.join(out, 'nginx.conf.example'));

console.log(`dist/: ${files.size + 5} файлов, версия ${commit.slice(0, 7)}${args.has('--server') ? ', PHP-сайт с админкой' : args.has('--with-admin') ? ', с админкой' : ''}`);
