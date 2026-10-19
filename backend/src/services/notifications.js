import { query } from '../db.js';

export async function createNotification({ userId, type, title, message, itemId=null, claimId=null }) {
  await query(
    `INSERT INTO notifications(user_id,type,title,message,related_item_id,related_claim_id)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [userId,type,title,message,itemId,claimId]
  );
}
