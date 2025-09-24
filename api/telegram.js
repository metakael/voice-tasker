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
      const urlParams = new URLSearchParams();
      if (env.SUMMARY_SECRET_KEY) {
        urlParams.append('key', env.SUMMARY_SECRET_KEY);
      }
      urlParams.append('chatId', chatId);
      const summaryUrl = `${env.PUBLIC_BASE_URL}/api/daily-summary?${urlParams.toString()}`;
      console.log('Triggering daily summary via API', { summaryUrl });
      fetch(summaryUrl).catch((e) => console.error('Failed to trigger daily summary:', e));
      return sendJson(res, 200, { ok: true });
    }

    // Handle feedback command
    if (/^\/feedback(@[A-Za-z0-9_]+)?(\b|$)/.test(commandToken) && chatId) {
      console.log('Telegram /feedback command detected', { chatId, commandToken });
      try {
        const feedbackText = messageText.replace(/^\/feedback(@[A-Za-z0-9_]+)?\s*/, '').trim();
        if (!feedbackText) {
          await sendTelegramMessage(chatId, '💭 Please provide feedback after the command.\n\nExample: /feedback The budget task should be higher priority than routine emails');
          return sendJson(res, 200, { ok: true });
        }

        // Trigger feedback storage
        const feedbackUrl = `${env.PUBLIC_BASE_URL}/api/store-feedback${env.SUMMARY_SECRET_KEY ? `?key=${encodeURIComponent(env.SUMMARY_SECRET_KEY)}` : ''}&chatId=${encodeURIComponent(chatId)}&feedback=${encodeURIComponent(feedbackText)}`;
        console.log('Storing feedback via API', { feedbackUrl });
        fetch(feedbackUrl).catch((e) => console.error('Failed to store feedback:', e));
        
        await sendTelegramMessage(chatId, '✅ Feedback received! This will help improve future task prioritization.');
      } catch (err) {
        console.error('Failed to handle feedback command:', err);
      }
      return sendJson(res, 200, { ok: true });
    }

    // Handle /task command to create from typed text
    if (/^\/task(@[A-Za-z0-9_]+)?(\b|$)/.test(commandToken) && chatId) {
      try {
        const taskText = messageText.replace(/^\/task(@[A-Za-z0-9_]+)?\s*/, '').trim();
        if (!taskText) {
          await sendTelegramMessage(chatId, '📝 Please provide the task text after /task.\n\nExample: /task Schedule dentist appointment next Tuesday');
          return sendJson(res, 200, { ok: true });
        }

        await sendTelegramMessage(chatId, '🔄 Processing your message...');
        const targetUrl = `${env.PUBLIC_BASE_URL}/api/worker`;
        const enqueueUrl = `https://qstash.upstash.io/v2/publish/${targetUrl}`;
        console.log('Enqueuing text via /task for processing', { chatId, hasText: true });
        const payload = { chatId, text: taskText };
        const headers = {
          Authorization: `Bearer ${env.QSTASH_TOKEN}`,
          'Upstash-Forward-Authorization': `Bearer ${env.WORKER_SHARED_SECRET}`,
          'Content-Type': 'application/json'
        };
        const qstashResp = await fetch(enqueueUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        try {
          console.log('QStash enqueue status', { ok: qstashResp.ok, status: qstashResp.status, enqueueUrl });
          if (!qstashResp.ok) {
            const text = await qstashResp.text();
            console.error('QStash enqueue failed', { status: qstashResp.status, text });
          }
        } catch {}
      } catch (err) {
        console.error('Failed to handle /task command:', err);
      }
      return sendJson(res, 200, { ok: true });
    }

    // Handle /start or unknown commands with a helpful hint
    if (messageText.startsWith('/') && chatId) {
      try {
        await sendTelegramMessage(chatId, '👋 You can send a voice note or just type a task.\nCommands: /summary, /feedback <text>, /task <text>');
      } catch (err) {
        console.error('Failed to send help message for command:', err);
      }
      return sendJson(res, 200, { ok: true });
    }

    // If we have plain text (non-command), enqueue for processing
    if (chatId && messageText && !messageText.startsWith('/')) {
      try {
        await sendTelegramMessage(chatId, '🔄 Processing your message...');
      } catch (err) {
        console.error('Failed to send processing ack (text):', err);
      }

      const targetUrl = `${env.PUBLIC_BASE_URL}/api/worker`;
      const enqueueUrl = `https://qstash.upstash.io/v2/publish/${targetUrl}`;
      console.log('Enqueuing text for processing', { chatId, hasText: true });
      const payload = { chatId, text: messageText };
      const headers = {
        Authorization: `Bearer ${env.QSTASH_TOKEN}`,
        'Upstash-Forward-Authorization': `Bearer ${env.WORKER_SHARED_SECRET}`,
        'Content-Type': 'application/json'
      };
      const qstashResp = await fetch(enqueueUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      try {
        console.log('QStash enqueue status', { ok: qstashResp.ok, status: qstashResp.status, enqueueUrl });
        if (!qstashResp.ok) {
          const text = await qstashResp.text();
          console.error('QStash enqueue failed', { status: qstashResp.status, text });
        }
      } catch {}
      return sendJson(res, 200, { ok: true });
    }

    // Voice flow
    if (!chatId || !fileId) {
      return sendJson(res, 200, { ok: true }); // ignore updates we don't handle
    }

    // Send immediate processing message
    try {
      await sendTelegramMessage(chatId, '🔄 Processing your message...');
    } catch (err) {
      console.error('Failed to send processing ack (voice):', err);
    }

    // Enqueue to QStash
    console.log('Enqueuing voice for processing', { chatId, hasFileId: !!fileId });
    const targetUrl = `${env.PUBLIC_BASE_URL}/api/worker`;
    const enqueueUrl = `https://qstash.upstash.io/v2/publish/${targetUrl}`;
    console.log('QStash URL being used:', enqueueUrl);
    const payload = {
      chatId,
      fileId
    };

    const headers = {
      Authorization: `Bearer ${env.QSTASH_TOKEN}`,
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


