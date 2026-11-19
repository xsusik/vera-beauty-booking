'use strict';
const crypto = require('node:crypto');
const { redis, deliver, ready } = require('../lib/storage');
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  const expected=Buffer.from('Bearer '+(process.env.CRON_SECRET||''));
  const actual=Buffer.from(req.headers.authorization||'');
  if (!ready() || actual.length!==expected.length || !crypto.timingSafeEqual(actual,expected)) return res.status(401).end();
  try {
    const ids=(await redis(['HKEYS','vera:booking:outbox'])).slice(0,10);
    const results=await Promise.allSettled(ids.map(deliver));
    const failed=results.filter(r=>r.status==='rejected'||!r.value).length;
    return res.status(failed?503:200).json({processed:ids.length,failed});
  } catch { return res.status(503).json({error:'Retry unavailable'}); }
};
