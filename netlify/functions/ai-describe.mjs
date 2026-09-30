import { err, json, readBody, bearer, verifyToken, loadActive, getJSON, setJSON, usageKey } from '../lib/common.mjs';

const PROMPT = 'هذه صورة قطعة أثاث أو تجهيزات مكتبية ضمن عملية جرد أصول. اكتب وصفاً موجزاً بالعربية (جملة واحدة، أقل من ١٥ كلمة) يذكر نوع القطعة، اللون أو الخامة الظاهرة، وأي تفاصيل مميزة. أعد الوصف فقط بدون أي مقدمة أو علامات اقتباس.';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default async (req) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const payload = verifyToken(bearer(req));
  if (!payload) return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');

  const res = await loadActive(payload.u, payload.dev);
  if (res.error) return res.error;
  const { license } = res;
  if (license.aiEnabled === false) return err(403, 'ai_disabled', 'ميزة الذكاء الاصطناعي غير مفعّلة في رخصتك');

  const { image, mediaType } = await readBody(req);
  if (!image || typeof image !== 'string') return err(400, 'no_image', 'لا توجد صورة');
  if (image.length > 4_000_000) return err(413, 'too_large', 'الصورة كبيرة جدًا');
  const type = ALLOWED_TYPES.includes(mediaType) ? mediaType : 'image/jpeg';

  const uKey = usageKey(license.id);
  const usage = (await getJSON(uKey)) || { count: 0 };
  const cap = Number(license.aiMonthlyCap || 0);
  if (cap > 0 && usage.count >= cap) {
    return err(429, 'ai_cap', `استُنفد رصيد الذكاء الاصطناعي لهذا الشهر (${cap} طلب)`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err(500, 'server_config', 'الخادم غير مهيأ للذكاء الاصطناعي');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: type, data: image } },
        { type: 'text', text: PROMPT }
      ] }]
    })
  });
  if (!r.ok) {
    console.error('Anthropic error', r.status, await r.text());
    return err(502, 'ai_failed', 'تعذّر توليد الوصف، حاول مرة أخرى');
  }
  const data = await r.json();
  const text = (data.content || []).map((b) => b.text || '').join('').trim();

  usage.count = (usage.count || 0) + 1;
  usage.inputTokens = (usage.inputTokens || 0) + (data.usage?.input_tokens || 0);
  usage.outputTokens = (usage.outputTokens || 0) + (data.usage?.output_tokens || 0);
  await setJSON(uKey, usage);

  return json(200, { ok: true, text, remaining: cap > 0 ? cap - usage.count : null });
};

export const config = { path: '/api/ai-describe' };
