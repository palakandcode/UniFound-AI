import { pool } from '../db.js';
import { hashPassword } from './auth.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Demo seeding is disabled in production.');
}

const passwordHash = await hashPassword('ChangeMe123!');

const users = [
  ['Demo Finder','DEMO001','demo@somaiya.edu'],
  ['Demo Claimant','TEST002','test2@somaiya.edu']
];

for (const [name,member_id,email] of users) {
  const result = await pool.query(
    `INSERT INTO users(name,member_id,email,password_hash,verification_status)
     VALUES($1,$2,$3,$4,'VERIFIED')
     ON CONFLICT(email) DO UPDATE SET
       password_hash=EXCLUDED.password_hash,
       verification_status='VERIFIED'
     RETURNING id,email`,
    [name,member_id,email,passwordHash]
  );
  console.log('Seed user:', result.rows[0]);
}

// Seed accounts remain useful for local flow checks, but do not create fake
// public reports with missing photos. Public API feeds also exclude these users.
console.log('Demo password: ChangeMe123! — change/remove this before production.');
await pool.end();
