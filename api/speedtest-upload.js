// Функція Vercel для перевірки швидкості віддачі (upload).
// Браузер надсилає шматки випадкових даних; ми їх дочитуємо й відкидаємо — нічого не зберігається.
export async function POST(request) {
  await request.arrayBuffer();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
