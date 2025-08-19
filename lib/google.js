import { env } from './env.js';

export async function getGoogleAccessToken() {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google token error: ${text}`);
  }
  const json = await resp.json();
  return json.access_token;
}

export async function listTasklists(accessToken) {
  const resp = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!resp.ok) throw new Error('Failed to list tasklists');
  const json = await resp.json();
  return json.items || [];
}

export async function createGoogleTask({ accessToken, listId, title, notes, due }) {
  const payload = { title, notes };
  if (due) {
    // Google Tasks expects RFC3339 with time; use 00:00:00Z for date-only
    payload.due = `${due}T00:00:00.000Z`;
  }
  const url = listId
    ? `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`
    : 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create task: ${text}`);
  }
  return resp.json();
}

export async function findDuplicateTask({ accessToken, listId, title, due }) {
  const url = listId
    ? `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?showCompleted=true&maxResults=50`
    : 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=true&maxResults=50';
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) return null;
  const json = await resp.json();
  const items = json.items || [];
  const duePrefix = due ? `${due}T` : null;
  const match = items.find((t) => t.title === title && (!duePrefix || (t.due || '').startsWith(duePrefix)));
  return match || null;
}


