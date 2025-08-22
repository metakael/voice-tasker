import 'dotenv/config';
import { env } from '../lib/env.js';
import { sendJson } from '../lib/http.js';
import { sendTelegramMessage } from '../lib/telegram.js';

// Fast ACK webhook that enqueues to QStash
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    const update = req.body || {};

    const messageText = (update?.message?.text || update?.edited_message?.text || '').trim();
    // Only process voice messages
    const voice = update?.message?.voice || update?.edited_message?.voice;
    const chatId = update?.message?.chat?.id || update?.edited_message?.chat?.id;
    const fileId = voice?.file_id;

    // Handle manual summary command
    const commandToken = messageText.split(/\s+/)[0];
    if (/^\/summary(@[A-Za-z0-9_]+)?(\b|$)/.test(commandToken) && chatId) {
      console.log('Telegram /summary command detected', { chatId, commandToken });
      try {
        await sendTelegramMessage(chatId, '🔄 Generating your daily summary...');
      } catch (err) {
        console.error('Failed to send summary ack message:', err);
      }

      // Fire-and-forget trigger of the API route to avoid heavy work in webhook
      const summaryUrl = `${env.PUBLIC_BASE_URL}/api/daily-summary${env.SUMMARY_SECRET_KEY ? `?key=${encodeURIComponent(env.SUMMARY_SECRET_KEY)}` : ''}&chatId=${encodeURIComponent(chatId)}`;
      console.log('Triggering daily summary via API', { summaryUrl });
      fetch(summaryUrl).catch((e) => console.error('Failed to trigger daily summary:', e));
      return sendJson(res, 200, { ok: true });
    }

    if (!fileId || !chatId) {
      return sendJson(res, 200, { ok: true }); // ignore non-voice updates
    }

    // Enqueue to QStash
    console.log('Enqueuing voice for processing', { chatId, hasFileId: !!fileId });
    const targetUrl = `${env.PUBLIC_BASE_URL}/api/worker`;
    const enqueueUrl = `https://qstash.upstash.io/v2/publish/json/${targetUrl}`;
    const payload = {
      chatId,
      fileId
    };

    const headers = {
      Authorization: `Bearer ${env.QSTASH_TOKEN}`,
      'Upstash-Method': 'POST',
      'Upstash-Forward-Authorization': `Bearer ${env.WORKER_SHARED_SECRET}`,
      'Content-Type': 'application/json'
    };

    const qstashResp = await fetch(enqueueUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    try {
      console.log('QStash enqueue status', { ok: qstashResp.ok, status: qstashResp.status, enqueueUrl: enqueueUrl });
      if (!qstashResp.ok) {
        const text = await qstashResp.text();
        console.error('QStash enqueue failed', { status: qstashResp.status, text });
      }
    } catch {}
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


