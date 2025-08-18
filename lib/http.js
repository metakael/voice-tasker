export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function formatJson(obj) {
  return JSON.stringify(obj, null, 2);
}


