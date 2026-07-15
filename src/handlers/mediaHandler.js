// WhatsApp media download and Cloudflare R2 upload.
const axios = require('axios');
const logger = require('../utils/logger');

let S3Client;
let PutObjectCommand;
try {
  ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
} catch (_) {
  // Allows the rest of the application and tests to run without cloud SDKs.
}

async function downloadWhatsAppImage(mediaId, accessToken) {
  const graphVersion = process.env.WA_GRAPH_VERSION || 'v20.0';
  const meta = await axios.get(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15000,
  });
  const image = await axios.get(meta.data.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  return { buffer: Buffer.from(image.data), contentType: image.headers['content-type'] || 'image/jpeg' };
}

async function uploadToR2(buffer, contentType, key = `issues/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL } = process.env;
  if (!S3Client) throw new Error('Missing @aws-sdk/client-s3; install dependencies before enabling R2 uploads');
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_BASE_URL) {
    throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_PUBLIC_BASE_URL are required');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  await client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  return `${R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
}

async function saveWhatsAppImage(mediaId, accessToken) {
  const image = await downloadWhatsAppImage(mediaId, accessToken);
  try { return await uploadToR2(image.buffer, image.contentType); }
  catch (err) { logger.error('[R2] Image upload failed:', err.message); throw err; }
}

module.exports = { downloadWhatsAppImage, uploadToR2, saveWhatsAppImage };
