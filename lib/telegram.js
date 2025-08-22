import { env } from './env.js';

function getNormalizedToken() {
  const raw = (env.TELEGRAM_BOT_TOKEN || '').trim();
  if (raw.toLowerCase().startsWith('bot')) return raw.slice(3);
  return raw;
}

export async function getTelegramFileUrl(fileId) {
  const token = getNormalizedToken();
  const resp = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  const json = await resp.json();
  if (!json.ok) throw new Error(`Failed to get Telegram file path: ${json.description || 'unknown'}`);
  const path = json.result.file_path;
  return `https://api.telegram.org/file/bot${token}/${path}`;
}

export async function downloadArrayBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to download file');
  const arrayBuffer = await resp.arrayBuffer();
  return arrayBuffer;
}

export async function sendTelegramMessage(chatId, text) {
  const token = getNormalizedToken();
  try {
    console.log('Sending Telegram message', { chatId, length: (text || '').length });
  } catch {}
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  const json = await resp.json();
  try {
    if (!json.ok) {
      console.error('Telegram sendMessage failed', { description: json.description });
    } else {
      console.log('Telegram sendMessage ok');
    }
  } catch {}
  if (!json.ok) throw new Error('Failed to send Telegram message');
  return json;
}


