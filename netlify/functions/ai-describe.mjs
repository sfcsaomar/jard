import { err, json, readBody, bearer, verifyToken, loadActive, getJSON, setJSON, usageKey } from '../lib/common.mjs';

const PROMPT = 'هذه صورة قطعة أثاث أو تجهيزات مكتبية ضمن عملية جرد أصول. اكتب وصفاً موجزاً بالعربية (جملة واحدة، أقل من ١٥ كلمة) يذكر نوع القطعة، اللون أو الخامة الظاهرة، وأي تفاصيل مميزة. أعد الوصف فقط بدون أي مقدمة أو علامات اقتباس.';
const LABEL_PROMPT = 'This is a photo of an equipment nameplate, rating label, or sticker, taken during a fixed-asset inventory. Extract the manufacturer/brand, the model number, and the serial number exactly as printed (keep letters, digits, dashes and case as shown; the serial is usually marked S/N, SN, Serial No, or SER). Leave a field empty if it is not clearly visible. Do not guess. Reply with JSON only, no other text: {"brand":"","model":"","sn":""}';

function parseLabel(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return { brand: '', model: '', sn: '' };
  try {
    const o = JSON.parse(m[0]);
    const clean = (v) => String(v ?? '').trim().slice(0, 80);
    return { brand: clean(o.brand), model: clean(o.model), sn: clean(o.sn) };
  } catch { return { brand: '', model: '', sn: '' }; }
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default async (req) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const payload = verifyToken(bearer(req));
  if (!payload) return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');

  const res = await loadActive(payload.u, payload.dev);
  if (res.error) return res.error;
  const { license } = res;
  if (license.aiEnabled === false) return err(403, 'ai_disabled', 'ميزة الذكاء الاصطناعي غير مفعّلة في رخصتك');

  const { image, mediaType, mode } = await readBody(req);
  const isLabel = mode === 'label';
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
      max_tokens: isLabel ? 200 : 150,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: type, data: image } },
        { type: 'text', text: isLabel ? LABEL_PROMPT : PROMPT }
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

  const remaining = cap > 0 ? cap - usage.count : null;
  if (isLabel) return json(200, { ok: true, fields: parseLabel(text), remaining });
  return json(200, { ok: true, text, remaining });
};

export const config = { path: '/api/ai-describe' };
