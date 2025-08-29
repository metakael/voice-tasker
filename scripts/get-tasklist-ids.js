#!/usr/bin/env node
import 'dotenv/config';
import { getGoogleAccessToken, listTasklists } from '../lib/google.js';

async function main() {
  try {
    console.log('Fetching your Google Tasks lists...\n');
    
    const accessToken = await getGoogleAccessToken();
    const taskLists = await listTasklists(accessToken);
    
    console.log('📋 Your Google Tasks Lists:');
    console.log('=' .repeat(50));
    
    const mapping = {};
    for (const list of taskLists) {
      console.log(`Name: "${list.title}"`);
      console.log(`ID:   "${list.id}"`);
      console.log('-'.repeat(30));
      
      // Build mapping for easy copy-paste
      mapping[list.title] = list.id;
    }
    
    console.log('\n🔧 Environment Variable Setup:');
    console.log('Copy this to your Vercel environment variables:');
    console.log('\nCATEGORY_TO_LIST_JSON=');
    console.log(JSON.stringify(mapping, null, 2));
    
    console.log('\n💡 Usage Example:');
    console.log('If you want "Finance" category to map to "Work Tasks" list:');
    console.log(`"Finance": "${mapping[Object.keys(mapping)[0]] || 'your-list-id'}"`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n🔍 Make sure these environment variables are set:');
    console.log('- GOOGLE_CLIENT_ID');
    console.log('- GOOGLE_CLIENT_SECRET'); 
    console.log('- GOOGLE_REFRESH_TOKEN');
  }
}

main();
