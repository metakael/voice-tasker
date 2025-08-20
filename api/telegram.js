import 'dotenv/config';
import { env } from '../lib/env.js';
import { sendJson, readJsonBody } from '../lib/http.js';

// Fast ACK webhook that enqueues to QStash
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    const update = await readJsonBody(req);

    // Only process voice messages
    const msg = update?.message || update?.edited_message;
    const voice = msg?.voice || msg?.audio || msg?.video_note;
    const chatId = update?.message?.chat?.id || update?.edited_message?.chat?.id;
    const fromId = update?.message?.from?.id || update?.edited_message?.from?.id;
    const fileId = voice?.file_id;
    console.log('[telegram] incoming', {
      hasVoice: Boolean(fileId),
      chatId,
      messageId: update?.message?.message_id || update?.edited_message?.message_id
    });

    // If non-voice, or not allowed user, just ACK and return
    if (!fileId || !chatId || (env.TELEGRAM_ALLOWED_USER_ID && fromId !== env.TELEGRAM_ALLOWED_USER_ID)) {
      return sendJson(res, 200, { ok: true });
    }

    // Enqueue to QStash (URL-in-path style)
    const targetUrl = `${env.PUBLIC_BASE_URL}/api/worker`;
    const enqueueUrl = `https://qstash.upstash.io/v2/publish/${targetUrl}`;
    const payload = {
      chatId,
      fileId,
      fromId
    };

    const headers = {
      Authorization: `Bearer ${env.QSTASH_TOKEN}`,
      'Upstash-Method': 'POST',
      'Upstash-Forward-Authorization': `Bearer ${env.WORKER_SHARED_SECRET}`,
      'Content-Type': 'application/json'
    };

    try {
      console.log('[telegram] publishing to qstash', { targetUrl });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 1500);
      const idempotencyKey = `${chatId}:${update?.message?.message_id || update?.edited_message?.message_id}`;
      const resp = await fetch(enqueueUrl, {
        method: 'POST',
        headers: { ...headers, 'Upstash-Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
        signal: ac.signal
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const text = await resp.text();
        console.error('[telegram] qstash publish failed', resp.status, text);
      } else {
        console.log('[telegram] qstash publish status', resp.status);
      }
    } catch (err) {
      console.error('[telegram] qstash publish error', err?.name || err, String(err));
    }

    // Finally ACK
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    // Best-effort logging only; webhook already ACKed
    console.error('telegram webhook error:', error);
    try {
      if (!res.headersSent) {
        return sendJson(res, 200, { ok: true });
      }
    } catch {}
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb'
    }
  }
};


