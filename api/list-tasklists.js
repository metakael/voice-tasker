import 'dotenv/config';
import { getGoogleAccessToken, listTasklists } from '../lib/google.js';
import { sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
    const accessToken = await getGoogleAccessToken();
    const lists = await listTasklists(accessToken);
    return sendJson(res, 200, { lists });
  } catch (error) {
    console.error('list-tasklists error:', error);
    return sendJson(res, 500, { error: 'Internal Server Error' });
  }
}


