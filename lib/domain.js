'use strict';
const config = require('../config.json');
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const time = value => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
function quote(serviceId, extras = []) {
  const service = config.services.find(item => item.id === serviceId);
  if (!service || !Array.isArray(extras) || extras.length > config.extras.length) throw new Error('Wybierz usługę.');
  let price = service.price, maximum = service.price, duration = service.duration;
  const seen = new Set();
  const selected = extras.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Sprawdź dodatki.');
    const extra = config.extras.find(extra => extra.id === item.id && extra.services.includes(service.id));
    if (!extra || seen.has(extra.id) || !Number.isInteger(item.quantity) ||
        item.quantity < 1 || item.quantity > (extra.maxQuantity || 1)) throw new Error('Sprawdź dodatki.');
    seen.add(extra.id);
    price += extra.price * item.quantity;
    maximum += (extra.maxPrice || extra.price) * item.quantity;
    duration += extra.duration * item.quantity;
    return { name: extra.name, quantity: item.quantity };
  });
  return { service, extras: selected, price, maximum, duration };
}
function slots(date, duration, occupied = {}) {
  const schedule = config.schedule;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < schedule.from || date > schedule.to) return [];
  const parsed = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ||
      !schedule.weekdays.includes(parsed.getUTCDay()) || schedule.closedDates.includes(date)) return [];
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 16);
  const blocked = [...schedule.breaks, ...(schedule.blocked[date] || [])].map(([start, end]) => [minutes(start), minutes(end)]);
  const result = [];
  for (let start = minutes(schedule.start); start + duration <= minutes(schedule.end); start += schedule.step) {
    if (date + ' ' + time(start) <= now || blocked.some(([a, b]) => start < b && start + duration > a)) continue;
    let free = true;
    for (let value = start; value < start + duration; value += 5) if (occupied[value]) { free = false; break; }
    if (free) result.push(time(start));
  }
  return result;
}
module.exports = { config, quote, slots, minutes };
