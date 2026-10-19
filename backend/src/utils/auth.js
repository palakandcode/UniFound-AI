import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export function isUniversityEmail(email) {
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS || process.env.ALLOWED_EMAIL_DOMAIN || 'somaiya.edu')
    .split(',').map(domain => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return at > 0 && domains.includes(value.slice(at + 1));
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    memberId: row.member_id,
    email: row.email,
    phone: row.phone,
    department: row.department,
    course: row.course,
    yearBatch: row.year_batch,
    avatar: row.avatar_path,
    verificationStatus: row.verification_status,
    idCard: row.id_card_path,
    idCardOcrText: row.id_card_ocr_text || '',
    contactPreferences: {
      messages: row.allow_messages,
      calls: row.allow_calls,
      email: row.allow_email
    },
    role: row.role
  };
}
