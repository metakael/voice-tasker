import 'dotenv/config';
import { env } from '../lib/env.js';
import { sendJson } from '../lib/http.js';
import { getGoogleAccessToken, listTasklists } from '../lib/google.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    // Optional security check
    if (env.SUMMARY_SECRET_KEY) {
      const key = req.query?.key || req.headers['x-summary-key'];
      if (key !== env.SUMMARY_SECRET_KEY) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }
    }

    const accessToken = await getGoogleAccessToken();
    const taskLists = await listTasklists(accessToken);
    
    const mapping = {};
    const lists = [];
    
    for (const list of taskLists) {
      lists.push({
        name: list.title,
        id: list.id
      });
      mapping[list.title] = list.id;
    }

    const envVarExample = {
      name: 'CATEGORY_TO_LIST_JSON',
      value: JSON.stringify(mapping, null, 2),
      note: 'Map categories to list IDs - customize the keys to match your categories'
    };

    return sendJson(res, 200, {
      lists,
      mapping,
      envVarExample,
      instructions: [
        '1. Copy the CATEGORY_TO_LIST_JSON value below',
        '2. Edit the keys to match your categories (Finance, HR, Personal, etc.)',
        '3. Set this as an environment variable in Vercel',
        '4. Redeploy your app'
      ]
    });

  } catch (error) {
    console.error('List tasklists error:', error);
    return sendJson(res, 500, { error: 'Internal Server Error', details: error.message });
  }
}

export const config = {
  api: {
    bodyParser: false
  }
};