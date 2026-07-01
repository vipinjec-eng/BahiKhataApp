/**
 * Cloudflare Worker — हिसाब बहीखाता बैकएंड
 *
 * Endpoints:
 *   POST /vision           → Gemini Vision proxy (GEMINI_KEY secret required)
 *   POST /backup/:code     → Cloud backup save (KV: BAHI_KV binding required)
 *   GET  /backup/:code     → Cloud backup restore
 *
 * Environment variables (set in Cloudflare dashboard):
 *   GEMINI_KEY   (Secret)  — Google Gemini API key starting with AIza...
 *   APP_SECRET   (Secret)  — Optional password to restrict access
 *   BAHI_KV      (KV namespace binding) — for backup storage
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const PROMPT = `यह एक हिसाब रजिस्टर का फोटो है। इसमें से हर entry को पढ़कर नीचे दिए format में JSON array दो।
हर item में ये fields रखो:
- name: व्यक्ति का नाम — हमेशा देवनागरी (हिंदी) में लिखो, चाहे रजिस्टर में कैसे भी लिखा हो। अंग्रेज़ी अक्षरों में मत लिखो।
- amount: रकम (number, सिर्फ़ अंक — अंग्रेज़ी digits 0-9 में)
- date: तारीख़ YYYY-MM-DD format में (अगर सिर्फ़ DD/MM हो तो साल 2026 मान लो)
- direction: "diya" या "liya"
- star: true (50000 से ज़्यादा या हरे highlight) या false
- note: अतिरिक्त टिप्पणी या ""
ज़रूरी: name हमेशा हिंदी (देवनागरी) लिपि में हो। सिर्फ़ valid JSON array दो, कोई markdown fence नहीं।`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    // ── /vision ─────────────────────────────────────────────────────────────
    if (request.method === 'POST' && path === '/vision') {
      const body = await request.json().catch(() => ({}));
      if (env.APP_SECRET && body.password !== env.APP_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      if (!body.image) return new Response(JSON.stringify({ error: 'No image' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: body.image } }] }]
          })
        }
      );
      if (!geminiRes.ok) {
        const errBody = await geminiRes.json().catch(() => ({}));
        const msg = errBody?.error?.message || `Gemini HTTP ${geminiRes.status}`;
        return new Response(JSON.stringify({ error: msg, status: geminiRes.status }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const data = await geminiRes.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      return new Response(JSON.stringify({ text }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── /backup/:code ────────────────────────────────────────────────────────
    const backupMatch = path.match(/^\/backup\/(.+)$/);
    if (backupMatch) {
      const code = decodeURIComponent(backupMatch[1]);
      const kvKey = 'bahi:' + code;

      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (env.APP_SECRET && body.password !== env.APP_SECRET) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        if (!env.BAHI_KV) return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
        await env.BAHI_KV.put(kvKey, JSON.stringify({ entries: body.entries || [], savedAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 365 });
        return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      if (request.method === 'GET') {
        const password = url.searchParams.get('password') || '';
        if (env.APP_SECRET && password !== env.APP_SECRET) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        if (!env.BAHI_KV) return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
        const val = await env.BAHI_KV.get(kvKey);
        if (!val) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
        return new Response(val, { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }

    return new Response('Not found', { status: 404, headers: CORS });
  }
};
