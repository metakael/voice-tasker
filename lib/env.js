import 'dotenv/config';

function parseJsonSafe(jsonString, fallback) {
  if (!jsonString) return fallback;
  try {
    return JSON.parse(jsonString);
  } catch {
    return fallback;
  }
}

const DEFAULT_CATEGORIES = [
  'Personal',
  'Charities Unit',
  'Onboarding',
  'Learning & Development (L&D)',
  'Finance',
  'HR',
  'Staffing',
  'Knowledge Management (KM)',
  'General Operations'
];

export const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5-mini',

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || '',

  QSTASH_TOKEN: process.env.QSTASH_TOKEN || '',
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || '',
  WORKER_SHARED_SECRET: process.env.WORKER_SHARED_SECRET || '',

  DEFAULT_TASKLIST_ID: process.env.DEFAULT_TASKLIST_ID || '',

  CATEGORY_LIST: parseJsonSafe(process.env.CATEGORY_LIST_JSON, DEFAULT_CATEGORIES),
  CATEGORY_TO_LIST_MAP: parseJsonSafe(process.env.CATEGORY_TO_LIST_JSON, {}),
  DOMAIN_GLOSSARY: parseJsonSafe(process.env.DOMAIN_GLOSSARY_JSON, []),
};

export function assertRequiredEnv() {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'OPENAI_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'QSTASH_TOKEN',
    'PUBLIC_BASE_URL',
    'WORKER_SHARED_SECRET'
  ];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}


