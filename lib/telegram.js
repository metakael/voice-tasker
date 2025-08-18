import { env } from './env.js';

export async function getTelegramFileUrl(fileId) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const json = await resp.json();
  if (!json.ok) throw new Error('Failed to get Telegram file path');
  const path = json.result.file_path;
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`;
}

export async function downloadArrayBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to download file');
  const arrayBuffer = await resp.arrayBuffer();
  return arrayBuffer;
}

export async function sendTelegramMessage(chatId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  const json = await resp.json();
  if (!json.ok) throw new Error('Failed to send Telegram message');
  return json;
}


