import express from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../db.js';
import { hashPassword, verifyPassword, signToken, publicUser, isUniversityEmail } from '../utils/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { sendOtpEmail } from '../services/email.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success:false, message:'Too many code requests. Please wait 15 minutes before trying again.' }
});

function emailProviderReady() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function makeOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function saveOtp(email, purpose, code) {
  const hash = await hashPassword(code);
  await query(`DELETE FROM otp_codes WHERE email=$1 AND purpose=$2`, [email,purpose]);
  await query(
    `INSERT INTO otp_codes(email,purpose,code_hash,expires_at)
     VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes')`,
    [email,purpose,hash]
  );
}

router.post('/request-signup-otp', otpRequestLimiter, async (req,res,next) => {
  try {
    const { email } = req.body;
    if (!email || !isUniversityEmail(email)) {
      return res.status(400).json({success:false,message:'Use your @somaiya.edu university email. Personal Gmail accounts can browse only as visitors.'});
    }
    if (!emailProviderReady()) return res.status(503).json({success:false,message:'Email verification is temporarily unavailable: the server needs its Resend API key and verified sender configured.'});

    const existing = await query('SELECT id FROM users WHERE lower(email)=lower($1)',[email]);
    if (existing.rows[0]) return res.status(409).json({success:false,message:'An account with this email already exists.'});

    const code = makeOtp();
    try { await sendOtpEmail({to:email,code}); }
    catch { return res.status(502).json({success:false,message:'The email provider could not deliver your code. Check the Resend key and verified sender, then try again.'}); }
    await saveOtp(email,'SIGNUP',code);

    res.json({success:true,message:'Verification code sent.'});
  } catch(err) { next(err); }
});

router.post('/register', async (req,res,next) => {
  try {
    const { name, memberId, email, password, otp } = req.body;
    if (!name || !memberId || !email || !password || !otp) {
      return res.status(400).json({success:false,message:'Name, Member ID, email, password and OTP are required.'});
    }
    if (!isUniversityEmail(email)) {
      return res.status(400).json({success:false,message:'Use your @somaiya.edu university email. Personal Gmail accounts can browse only as visitors.'});
    }
    if (password.length < 8) {
      return res.status(400).json({success:false,message:'Password must be at least 8 characters.'});
    }

    const otpRow = await query(
      `SELECT * FROM otp_codes
       WHERE lower(email)=lower($1) AND purpose='SIGNUP' AND verified_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    const row = otpRow.rows[0];
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(400).json({success:false,message:'OTP is missing or expired.'});
    }
    if (row.attempts >= 5) return res.status(429).json({success:false,message:'Too many OTP attempts. Request a new code.'});

    const valid = await verifyPassword(String(otp), row.code_hash);
    if (!valid) {
      await query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1',[row.id]);
      return res.status(400).json({success:false,message:'Incorrect OTP.'});
    }

    const duplicate = await query(
      'SELECT id FROM users WHERE lower(email)=lower($1) OR lower(member_id)=lower($2)',
      [email,memberId]
    );
    if (duplicate.rows[0]) return res.status(409).json({success:false,message:'Email or Member ID is already registered.'});

    const passwordHash = await hashPassword(password);
    const created = await query(
      `INSERT INTO users(name,member_id,email,password_hash,verification_status)
       VALUES($1,$2,$3,$4,'PENDING')
       RETURNING *`,
      [name.trim(),memberId.trim(),email.toLowerCase(),passwordHash]
    );
    await query('UPDATE otp_codes SET verified_at=NOW() WHERE id=$1',[row.id]);

    const user = created.rows[0];
    res.status(201).json({success:true,token:signToken(user),user:publicUser(user)});
  } catch(err) { next(err); }
});

router.post('/request-password-reset-otp', otpRequestLimiter, async (req,res,next) => {
  try {
    const email=String(req.body.email||'').trim().toLowerCase();
    if(!email || !isUniversityEmail(email)) return res.status(400).json({success:false,message:'Use your @somaiya.edu university email.'});
    if (!emailProviderReady()) return res.status(503).json({success:false,message:'Email verification is temporarily unavailable: the server needs its Resend API key and verified sender configured.'});
    const existing=await query('SELECT id FROM users WHERE lower(email)=lower($1)',[email]);
    if(!existing.rows[0]) return res.status(404).json({success:false,message:'No account was found for this email.'});
    const code=makeOtp();
    try { await sendOtpEmail({to:email,code}); }
    catch { return res.status(502).json({success:false,message:'The email provider could not deliver your code. Check the Resend key and verified sender, then try again.'}); }
    await saveOtp(email,'PASSWORD_RESET',code);
    res.json({success:true,message:'Password reset OTP sent.'});
  }catch(err){next(err);}
});

router.post('/reset-password', async (req,res,next) => {
  try {
    const {email,otp,password}=req.body;
    if(!email||!otp||!password||String(password).length<8) return res.status(400).json({success:false,message:'Email, OTP and an 8+ character password are required.'});
    const r=await query(`SELECT * FROM otp_codes WHERE lower(email)=lower($1) AND purpose='PASSWORD_RESET' AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1`,[email]);
    const row=r.rows[0];
    if(!row||new Date(row.expires_at)<new Date()) return res.status(400).json({success:false,message:'OTP is missing or expired.'});
    if(row.attempts>=5)return res.status(429).json({success:false,message:'Too many OTP attempts.'});
    if(!await verifyPassword(String(otp),row.code_hash)){await query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1',[row.id]);return res.status(400).json({success:false,message:'Incorrect OTP.'});}
    const passwordHash=await hashPassword(password);
    await query('UPDATE users SET password_hash=$1 WHERE lower(email)=lower($2)',[passwordHash,email]);
    await query('UPDATE otp_codes SET verified_at=NOW() WHERE id=$1',[row.id]);
    res.json({success:true,message:'Password updated.'});
  }catch(err){next(err);}
});

router.post('/login', async (req,res,next) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) return res.status(400).json({success:false,message:'Email/Member ID and password are required.'});
    if (process.env.NODE_ENV === 'production' && ['demo@somaiya.edu','test2@somaiya.edu'].includes(String(identifier).trim().toLowerCase())) {
      return res.status(401).json({success:false,message:'Invalid login details.'});
    }

    const result = await query(
      `SELECT * FROM users
       WHERE lower(email)=lower($1) OR lower(member_id)=lower($1)
       LIMIT 1`,
      [identifier]
    );
    const user = result.rows[0];
    if (!user || !user.password_hash) return res.status(401).json({success:false,message:'Invalid login details.'});
    if (!isUniversityEmail(user.email)) return res.status(403).json({success:false,message:'Only @somaiya.edu accounts can sign in. Use visitor mode to browse with a personal Gmail account.'});
    if (user.status !== 'ACTIVE') return res.status(403).json({success:false,message:'This account is suspended.'});

    const ok = await verifyPassword(password,user.password_hash);
    if (!ok) return res.status(401).json({success:false,message:'Invalid login details.'});

    res.json({success:true,token:signToken(user),user:publicUser(user)});
  } catch(err) { next(err); }
});

router.get('/me', requireAuth, (req,res) => {
  res.json({success:true,user:publicUser(req.user)});
});

router.get('/google', (req,res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
    return res.status(503).json({success:false,message:'Google Sign-In is not configured yet.'});
  }
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  const url = client.generateAuthUrl({
    access_type:'offline',
    scope:['openid','email','profile'],
    prompt:'select_account'
  });
  res.json({success:true,url});
});

router.get('/google/callback', async (req,res,next) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).send('Google Sign-In is not configured.');
    }
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    const {tokens} = await client.getToken(req.query.code);
    client.setCredentials(tokens);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true) return res.status(400).send('Google must provide a verified email address.');

    const email = payload.email.toLowerCase();
    if (!isUniversityEmail(email)) return res.status(403).send('Please use your university Google account.');

    let result = await query('SELECT * FROM users WHERE lower(email)=lower($1)',[email]);
    let user = result.rows[0];

    if (!user) {
      const memberId = `GOOGLE-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      result = await query(
        `INSERT INTO users(name,member_id,email,google_sub,verification_status)
         VALUES($1,$2,$3,$4,'PENDING') RETURNING *`,
        [payload.name || 'UniFind User',memberId,email,payload.sub]
      );
      user = result.rows[0];
    } else {
      await query('UPDATE users SET google_sub=$1 WHERE id=$2',[payload.sub,user.id]);
    }

    const token = signToken(user);
    const redirect = `${process.env.CLIENT_URL || 'http://127.0.0.1:5500'}/#auth-callback?token=${encodeURIComponent(token)}`;
    res.redirect(redirect);
  } catch(err) { next(err); }
});

export default router;
