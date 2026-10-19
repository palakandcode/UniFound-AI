import { query } from '../db.js';

function tokens(value='') {
  return new Set(
    value.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/)
      .filter(x => x.length > 3)
  );
}

function score(a,b) {
  let total = 0;
  const reasons = [];

  if (a.category === b.category) { total += 20; reasons.push('same category'); }
  if (a.color && b.color && a.color.toLowerCase() === b.color.toLowerCase()) {
    total += 15; reasons.push('same colour');
  }
  if (a.brand && b.brand && a.brand.toLowerCase() === b.brand.toLowerCase()) {
    total += 15; reasons.push('same brand');
  }
  if (a.location && b.location && a.location.toLowerCase() === b.location.toLowerCase()) {
    total += 20; reasons.push('same location');
  }

  const common = [...tokens(`${a.title} ${a.description}`)]
    .filter(t => tokens(`${b.title} ${b.description}`).has(t));
  total += Math.min(20, common.length * 5);
  if (common.length) reasons.push('similar item wording');

  if (a.event_date && b.event_date) {
    const days = Math.abs(new Date(a.event_date) - new Date(b.event_date)) / 86400000;
    if (days <= 1) { total += 10; reasons.push('very close dates'); }
    else if (days <= 3) { total += 5; reasons.push('close dates'); }
  }

  return { score: Math.min(99,total), reasons };
}

export async function getMatches(itemId, userId) {
  const itemResult = await query(
    `SELECT * FROM items WHERE id=$1 AND owner_id=$2`,
    [itemId,userId]
  );
  const item = itemResult.rows[0];
  if (!item) return null;

  const opposite = item.type === 'LOST' ? 'FOUND' : 'LOST';
  const candidates = await query(
    `SELECT i.*, u.name AS owner_name
     FROM items i JOIN users u ON u.id=i.owner_id
     WHERE i.type=$1 AND i.status='ACTIVE' AND i.owner_id<>$2
     ORDER BY i.created_at DESC LIMIT 200`,
    [opposite,userId]
  );

  return candidates.rows
    .map(c => ({ item:c, ...score(item,c) }))
    .filter(x => x.score >= 40)
    .sort((a,b) => b.score-a.score)
    .slice(0,20);
}
