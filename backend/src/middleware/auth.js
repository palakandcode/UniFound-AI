import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { isUniversityEmail } from '../utils/auth.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success:false, message:'Authentication required.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query(
      `SELECT id, name, member_id, email, phone, department, course, year_batch,
              avatar_path, id_card_path, verification_status, allow_messages,
              allow_calls, allow_email, role, status
       FROM users WHERE id=$1`,
      [payload.sub]
    );

    if (!result.rows[0] || result.rows[0].status !== 'ACTIVE') {
      return res.status(401).json({ success:false, message:'Account is unavailable.' });
    }
    if (!isUniversityEmail(result.rows[0].email)) {
      return res.status(403).json({ success:false, message:'Only Somaiya university accounts can use student features. Switch to visitor mode to browse.' });
    }

    req.user = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ success:false, message:'Invalid or expired session.' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ success:false, message:'Administrator access required.' });
  }
  next();
}
