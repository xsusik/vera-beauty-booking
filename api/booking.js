'use strict';
const crypto = require('node:crypto');
const { config, quote, slots, minutes } = require('../lib/domain');
const { redis, ready, deliver } = require('../lib/storage');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  try {
    if (req.method === 'GET') {
      const extras = JSON.parse(req.query.extras || '[]');
      const selected = quote(req.query.service, extras);
      const active = config.bookingEnabled && ready();
      const values = active ? await redis(['HGETALL','vera:booking:day:' + req.query.date]) : [];
      const occupied = {};
      for (let i=0; i<values.length; i+=2) occupied[values[i]]=values[i+1];
      return res.status(200).json({preview:!active,slots:slots(req.query.date,selected.duration,occupied)});
    }
    if (req.method !== 'POST') return res.status(405).end();
    if (!config.bookingEnabled || !ready()) return res.status(503).json({error:'Zapisy online są jeszcze przygotowywane. Napisz do nas na Instagramie.'});
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || JSON.stringify(body).length > 6000 || body.website ||
        !/^[a-f0-9-]{36}$/.test(body.id || '') || typeof body.name !== 'string' ||
        body.name.trim().length < 2 || body.name.length > 100 || typeof body.phone !== 'string' ||
        typeof body.note !== 'string' || body.note.length > 600 || body.consent !== true) return res.status(400).json({error:'Sprawdź imię, telefon i zgodę na kontakt.'});
    let phone = body.phone.replace(/[\s()-]/g,'');
    if (/^\d{9}$/.test(phone)) phone = '+48' + phone;
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) return res.status(400).json({error:'Podaj numer telefonu z kodem kraju.'});
    const selected = quote(body.service,body.extras);
    if (!slots(body.date,selected.duration).includes(body.time)) return res.status(400).json({error:'Wybierz dostępny termin.'});
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0];
    const rateKey = 'vera:booking:rate:' + crypto.createHash('sha256').update(ip).digest('hex');
    const count = await redis(['EVAL',"local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],600) end; return n",1,rateKey]);
    if (count > 20) return res.status(429).json({error:'Za dużo prób. Spróbuj ponownie za 10 minut.'});
    const record = {id:body.id,name:body.name.trim(),phone,note:body.note.trim(),service:selected.service.name,
      extras:selected.extras,price:selected.price,maximum:selected.maximum,from:!!selected.service.from,
      duration:selected.duration,date:body.date,time:body.time};
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
    record.fingerprint = fingerprint;
    record.createdAt = new Date().toISOString();
    const occupied=[];
    for(let n=minutes(body.time);n<minutes(body.time)+selected.duration;n+=5)occupied.push(n);
    const script = "local old=redis.call('HGET',KEYS[1],ARGV[1]); if old then local saved=cjson.decode(old); if saved.status=='declined' then return -3 end; if saved.fingerprint==ARGV[2] then return 2 else return -2 end end; " +
      "for i=4,#ARGV do if redis.call('HEXISTS',KEYS[2],ARGV[i])==1 then return 0 end end; " +
      "redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]); redis.call('HSET',KEYS[3],ARGV[1],ARGV[3]); " +
      "for i=4,#ARGV do redis.call('HSET',KEYS[2],ARGV[i],ARGV[1]) end; return 1";
    const result = await redis(['EVAL',script,3,'vera:booking:records','vera:booking:day:'+body.date,'vera:booking:outbox',
      body.id,fingerprint,JSON.stringify(record),...occupied]);
    if (result === 0) return res.status(409).json({error:'Ten termin właśnie został zajęty. Wybierz inną godzinę.'});
    if (result === -2) return res.status(409).json({error:'Ta prośba została już zapisana z innymi danymi. Odśwież stronę.'});
    if (result === -3) return res.status(409).json({error:'Salon odrzucił to zgłoszenie. Wybierz inny termin.'});
    try { await deliver(body.id); } catch { /* The durable outbox is retried by the scheduled job. */ }
    return res.status(200).json({ok:true,id:body.id});
  } catch (error) {
    const validation = error instanceof SyntaxError || ['Wybierz usługę.','Sprawdź dodatki.'].includes(error.message);
    return res.status(validation?400:503).json({error:validation?'Sprawdź wybraną usługę i dodatki.':'Nie udało się potwierdzić zapisu. Spróbuj ponownie z tymi samymi danymi.'});
  }
};
