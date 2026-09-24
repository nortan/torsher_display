#!/usr/bin/env node
/*
 * Обновляет справочные таблицы в docs/04-layouts-and-animation.md из shared/model.js
 * (раскладки, пресеты анимаций, эффекты, переходы, шрифты, настройки по умолчанию).
 *
 *   node tools/docs.mjs          — переписать блок между маркерами
 *   node tools/docs.mjs --check  — проверить, что документация актуальна (код выхода 1, если нет)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const M = createRequire(import.meta.url)(path.join(root, 'shared/model.js'));
const file = path.join(root, 'docs/04-layouts-and-animation.md');
const START = '<!-- tables:start (генерируется: node tools/docs.mjs) -->';
const END = '<!-- tables:end -->';

const out = [];
const label = (v) => (typeof v === 'string' ? v : v.label);
function table(title, obj) {
  out.push(`### ${title}`, '', '| Ключ | Название |', '|---|---|');
  for (const k of Object.keys(obj)) out.push(`| \`${k}\` | ${label(obj[k])} |`);
  out.push('');
}

out.push('### Раскладки слайдов с блюдами (`layout`)', '', '| Ключ | Название | Фото | Текстом |', '|---|---|---|---|');
for (const [k, L] of Object.entries(M.LAYOUTS)) out.push(`| \`${k}\` | ${L.label} | ${L.photos} | ${L.texts} |`);
out.push('');
table('Появление элементов слайда (`animation.preset`)', M.ANIMATION_PRESETS);
table('Заголовок слайда (`animation.title`)', M.TITLE_EFFECTS);
table('Порядок появления (`animation.order`)', M.ORDERS);
table('Изображения: появление (`animation.photoIn`)', M.PHOTO_IN);
table('Изображения: постоянный эффект (`animation.photoLoop`)', M.PHOTO_LOOP);
table('Названия блюд (`animation.name`)', M.NAME_EFFECTS);
table('Цены: появление (`animation.priceIn`)', M.PRICE_IN);
table('Цены: постоянный эффект (`animation.priceLoop`)', M.PRICE_LOOP);
table('Акцент на блюде: оформление (`settings.accentStyle`)', M.ACCENT_STYLES);
table('Акцент на блюде: анимация цены (`settings.accentAnim`)', M.ACCENT_ANIMS);
table('Значок NEW: анимация (`settings.newBadge.anim`)', M.NEW_ANIMS);
table('Переходы между слайдами (`settings.transition.effect`)', M.TRANSITIONS);
table('Вид афиши (`slide.style`)', M.EVENT_STYLES);
table('Выравнивание заголовка (`slide.titleAlign`)', M.TITLE_ALIGNS);
table('Темы (`settings.theme`)', M.THEMES);
table('Шрифты (`settings.fonts.*`)', M.FONTS);
out.push('### Настройки по умолчанию (`settings`)', '', '```json', JSON.stringify(M.defaultSettings(), null, 2), '```', '');
out.push('### Анимация по умолчанию (`settings.animation`)', '', '```json', JSON.stringify(M.defaultAnimation(), null, 2), '```');

const block = `${START}\n\n${out.join('\n')}\n\n${END}`;
const src = fs.readFileSync(file, 'utf8');
const a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0) throw new Error('Нет маркеров таблиц в ' + file);
const next = src.slice(0, a) + block + src.slice(b + END.length);

if (process.argv.includes('--check')) {
  if (next !== src) { console.error('docs/04-layouts-and-animation.md устарел: выполните node tools/docs.mjs'); process.exit(1); }
  console.log('Документация актуальна');
} else {
  fs.writeFileSync(file, next);
  console.log('Обновлено: docs/04-layouts-and-animation.md');
}
