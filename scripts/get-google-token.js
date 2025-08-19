#!/usr/bin/env node
import 'dotenv/config';
import http from 'http';
import { parse } from 'url';
import readline from 'readline';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET
} = process.env;

async function getGoogleToken() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env file');
    process.exit(1);
  }

  const REDIRECT_URI = 'http://localhost:3000/callback';
  const SCOPE = 'https://www.googleapis.com/auth/tasks';
  let server;

  try {
    // Create a simple HTTP server to receive the callback
    server = http.createServer(async (req, res) => {
      const url = parse(req.url, true);
      
      if (url.pathname === '/callback') {
        const authCode = url.query.code;
        const error = url.query.error;

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error: ${error}</h1><p>You can close this window.</p>`);
          console.error('Authorization error:', error);
          server.close();
          process.exit(1);
          return;
        }

        if (!authCode) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>No authorization code received</h1><p>You can close this window.</p>');
          server.close();
          process.exit(1);
          return;
        }

        try {
          // Exchange code for tokens
          const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: GOOGLE_CLIENT_ID,
              client_secret: GOOGLE_CLIENT_SECRET,
              code: authCode,
              grant_type: 'authorization_code',
              redirect_uri: REDIRECT_URI
            })
          });

          const data = await response.json();

          if (data.error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<h1>Token Error: ${data.error}</h1><p>You can close this window.</p>`);
            console.error('Error getting tokens:', data.error_description);
            server.close();
            process.exit(1);
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <h1>✅ Success!</h1>
            <p>Authorization complete. You can close this window.</p>
            <p>Check your terminal for the refresh token.</p>
          `);

          console.log('\n✅ Success! Add this to your .env file:');
          console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}`);
          console.log('\nAlso add this to your Vercel environment variables.');
          
          server.close();
          process.exit(0);

        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Server Error</h1><p>You can close this window.</p>`);
          console.error('Error:', error.message);
          server.close();
          process.exit(1);
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>Not Found</h1>');
      }
    });

    // Start server
    server.listen(3000, () => {
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
        `scope=${encodeURIComponent(SCOPE)}&` +
        `response_type=code&` +
        `access_type=offline&` +
        `prompt=consent`;

      console.log('🚀 Local server started on http://localhost:3000');
      console.log('\n1. Open this URL in your browser:');
      console.log(authUrl);
      console.log('\n2. Complete the authorization in your browser');
      console.log('3. The browser will redirect back and show a success message');
      console.log('\nWaiting for authorization...');
    });

  } catch (error) {
    console.error('Error starting server:', error.message);
    if (server) server.close();
    process.exit(1);
  }
}

getGoogleToken().catch(console.error);