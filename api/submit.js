// Функція Vercel: приймає результати перевірки з форми й пересилає їх у Telegram —
// у гілку (topic) групи техпідтримки: спершу фото з підписом (ім'я, пакет/потік, короткий
// підсумок перевірок), потім аудіозапис.
//
// Токен бота й адреса чату — лише в змінних оточення (Vercel → Settings → Environment Variables,
// локально — .env.local), у код сторінки вони не потрапляють:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_THREAD_ID (необов'язково — без неї в загальний чат).

const MAX_FILE_BYTES = 4 * 1024 * 1024; // запит до функції Vercel — до 4.5 МБ разом
const MAX_TEXT = 120;
const MAX_SUMMARY = 700; // підпис до фото в Telegram — до 1024 символів

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function text(form, key, max) {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function textBlock(form, key, max) {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function file(form, key, typePrefix) {
  const v = form.get(key);
  if (!v || typeof v === 'string' || v.size === 0 || v.size > MAX_FILE_BYTES) return null;
  if (!v.type.startsWith(typePrefix)) return null;
  return v;
}

/** Як Telegram покаже аудіо: OGG/Opus — голосове, M4A/MP3 — аудіо з плеєром, решта — файлом. */
function audioMethod(type) {
  if (type.includes('ogg')) return { method: 'sendVoice', field: 'voice', ext: 'ogg' };
  if (type.includes('mp4') || type.includes('aac') || type.includes('m4a')) return { method: 'sendAudio', field: 'audio', ext: 'm4a' };
  if (type.includes('mpeg')) return { method: 'sendAudio', field: 'audio', ext: 'mp3' };
  return { method: 'sendDocument', field: 'document', ext: type.includes('webm') ? 'webm' : 'bin' };
}

async function telegram(token, method, fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) body.append(k, v[0], v[1]);
    else body.append(k, String(v));
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`${method}: ${data.description ?? res.status}`);
  return data.result;
}

/** Ім'я файлу без пробілів і спецсимволів: лише літери, цифри й дефіс. */
function fileStem(name) {
  const stem = name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return stem || 'uchasnyk';
}

export async function POST(request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const threadId = process.env.TELEGRAM_THREAD_ID;
  if (!token || !chatId) {
    console.error('submit: не задано TELEGRAM_BOT_TOKEN або TELEGRAM_CHAT_ID');
    return json(500, { ok: false, error: 'not_configured' });
  }

  // Приймаємо лише запити з нашої ж сторінки (захист від відправки з чужих сайтів).
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json(403, { ok: false, error: 'origin' });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json(400, { ok: false, error: 'bad_form' });
  }

  const name = text(form, 'name', MAX_TEXT);
  const stream = text(form, 'stream', MAX_TEXT);
  const summary = textBlock(form, 'summary', MAX_SUMMARY);
  const photo = file(form, 'photo', 'image/');
  const audio = file(form, 'audio', 'audio/');
  if (!name || !stream || !photo || !audio) return json(400, { ok: false, error: 'missing_fields' });

  const caption =
    `<b>Нова попередня перевірка відео та звуку</b>\n\n` +
    `<b>Ім’я та прізвище:</b> ${escapeHtml(name)}\n` +
    `<b>Пакет / потік:</b> ${escapeHtml(stream)}` +
    (summary ? `\n\n${escapeHtml(summary)}` : '');
  const thread = threadId ? Number(threadId) : undefined;
  const stem = fileStem(name);

  try {
    const sent = await telegram(token, 'sendPhoto', {
      chat_id: chatId,
      message_thread_id: thread,
      photo: [photo, `${stem}.jpg`],
      caption,
      parse_mode: 'HTML',
    });

    const a = audioMethod(audio.type);
    const audioFields = {
      chat_id: chatId,
      message_thread_id: thread,
      caption: `Аудіо: ${name}`.slice(0, 1024),
      reply_parameters: JSON.stringify({ message_id: sent.message_id, allow_sending_without_reply: true }),
    };
    try {
      await telegram(token, a.method, { ...audioFields, [a.field]: [audio, `${stem}.${a.ext}`] });
    } catch (err) {
      // Якщо Telegram не прийняв формат як аудіо/голосове — надсилаємо просто файлом.
      if (a.method === 'sendDocument') throw err;
      console.warn('submit: аудіо не прийнято, надсилаємо файлом —', err.message);
      await telegram(token, 'sendDocument', { ...audioFields, document: [audio, `${stem}.${a.ext}`] });
    }
  } catch (err) {
    console.error('submit: Telegram відхилив запит —', err.message);
    return json(502, { ok: false, error: 'telegram' });
  }

  return json(200, { ok: true });
}
