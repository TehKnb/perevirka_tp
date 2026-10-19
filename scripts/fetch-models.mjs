// Готує файли, яких немає в git:
//   - моделі MediaPipe у public/models/ (завантажує зі сховища Google);
//   - wasm із node_modules у public/mediapipe/wasm/;
//   - файли перевірки інтернету в public/speedtest/ (випадкові дані, генеруються локально).
// Запуск: npm run fetch-models (повторний запуск пропускає вже наявні файли; --force перезавантажує).
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const BASE = 'https://storage.googleapis.com/mediapipe-models';
const MODELS = [
  ['face_landmarker.task', `${BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`],
  ['pose_landmarker_lite.task', `${BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`],
  [
    'selfie_segmenter_landscape.tflite',
    `${BASE}/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite`,
  ],
];

// Варіанти без ES-модулів: SIMD і запасний без SIMD (FilesetResolver сам обирає потрібний).
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

async function fetchModels() {
  const dir = join(root, 'public', 'models');
  await mkdir(dir, { recursive: true });
  for (const [name, url] of MODELS) {
    const target = join(dir, name);
    if (!force && (await exists(target))) {
      console.log(`✓ ${name} уже є`);
      continue;
    }
    console.log(`↓ ${name} ← ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    await writeFile(target, data);
    console.log(`✓ ${name} (${mb(data.length)})`);
  }
}

async function copyWasm() {
  const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  const dir = join(root, 'public', 'mediapipe', 'wasm');
  await mkdir(dir, { recursive: true });
  for (const name of WASM_FILES) {
    await copyFile(join(src, name), join(dir, name));
  }
  console.log(`✓ wasm скопійовано в public/mediapipe/wasm/`);
}

/** Розмір файлу для заміру завантаження. Потоки читають його повторно, якщо канал дуже швидкий. */
const SPEEDTEST_BYTES = 16 * 1024 * 1024;

async function makeSpeedtestFiles() {
  const dir = join(root, 'public', 'speedtest');
  await mkdir(dir, { recursive: true });
  // Розширення .jpg — щоб хостинг (Vercel) не стискав файл на льоту: він стискає
  // application/octet-stream, а на випадкових байтах це лише гальмує віддачу (вимірювали: 4–5 Мбіт/с
  // замість 19–36 з нестиснутого джерела). Картинки Vercel не стискає. Вміст — просто випадкові байти.
  const download = join(dir, 'download.jpg');
  if (force || !(await exists(download))) {
    await writeFile(download, randomBytes(SPEEDTEST_BYTES));
  }
  await writeFile(join(dir, 'ping.txt'), 'ok');
  console.log(`✓ файли перевірки інтернету в public/speedtest/ (${mb(SPEEDTEST_BYTES)})`);
}

try {
  await fetchModels();
  await copyWasm();
  await makeSpeedtestFiles();
} catch (err) {
  console.error('Помилка:', err.message);
  process.exit(1);
}
