import 'dotenv/config';
import { env } from '../lib/env.js';
import { sendJson } from '../lib/http.js';

// Fast ACK webhook that enqueues to QStash
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    const update = req.body || {};

    // Only process voice messages
    const voice = update?.message?.voice || update?.edited_message?.voice;
    const chatId = update?.message?.chat?.id || update?.edited_message?.chat?.id;
    const fileId = voice?.file_id;

    // Always ACK quickly
    sendJson(res, 200, { ok: true });

    if (!fileId || !chatId) {
      return; // ignore non-voice updates
    }

    // Enqueue to QStash
    const enqueueUrl = 'https://qstash.upstash.io/v2/publish/json';
    const payload = {
      chatId,
      fileId
    };

    const headers = {
      Authorization: `Bearer ${env.QSTASH_TOKEN}`,
      'Upstash-Method': 'POST',
      'Upstash-Url': `${env.PUBLIC_BASE_URL}/api/worker`,
      'Upstash-Forward-Authorization': `Bearer ${env.WORKER_SHARED_SECRET}`,
      'Content-Type': 'application/json'
    };

    await fetch(enqueueUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
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


