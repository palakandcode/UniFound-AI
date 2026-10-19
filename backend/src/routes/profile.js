import express from 'express';
import fs from 'fs/promises';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { avatarUpload, idCardUpload } from '../middleware/upload.js';
import { publicUser } from '../utils/auth.js';
import { createWorker } from 'tesseract.js';

const router = express.Router();

router.get('/', requireAuth, (req,res) => res.json({success:true,user:publicUser(req.user)}));


router.get('/id-card', requireAuth, async (req,res,next) => {
  try {
    if (!req.user.id_card_path) {
      return res.status(404).json({success:false,message:'No ID card has been uploaded.'});
    }
    res.sendFile(req.user.id_card_path);
  } catch(err) { next(err); }
});

router.patch('/', requireAuth, async (req,res,next) => {
  try {
    const allowed = ['name','memberId','phone','department','course','yearBatch','allowMessages','allowCalls','allowEmail'];
    const body = req.body || {};
    const fields = [];
    const values = [];
    const map = {
      name:'name', memberId:'member_id', phone:'phone', department:'department',
      course:'course', yearBatch:'year_batch', allowMessages:'allow_messages',
      allowCalls:'allow_calls', allowEmail:'allow_email'
    };

    for (const key of allowed) {
      if (body[key] !== undefined) {
        fields.push(`${map[key]}=$${values.length+1}`);
        values.push(body[key]);
      }
    }
    if (!fields.length) return res.status(400).json({success:false,message:'No profile changes supplied.'});

    if (body.memberId) {
      const duplicate = await query(
        'SELECT id FROM users WHERE lower(member_id)=lower($1) AND id<>$2',
        [body.memberId,req.user.id]
      );
      if (duplicate.rows[0]) return res.status(409).json({success:false,message:'Member ID is already in use.'});
    }

    values.push(req.user.id);
    const result = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id=$${values.length} RETURNING *`,
      values
    );
    res.json({success:true,user:publicUser(result.rows[0])});
  } catch(err) { next(err); }
});

router.post('/avatar', requireAuth, avatarUpload.single('avatar'), async (req,res,next) => {
  try {
    if (!req.file) return res.status(400).json({success:false,message:'Avatar image is required.'});
    if (req.user.avatar_path) await fs.rm(req.user.avatar_path,{force:true});
    const result = await query(
      'UPDATE users SET avatar_path=$1 WHERE id=$2 RETURNING *',
      [req.file.path,req.user.id]
    );
    res.json({success:true,user:publicUser(result.rows[0])});
  } catch(err) { next(err); }
});

router.delete('/avatar', requireAuth, async (req,res,next) => {
  try {
    if (req.user.avatar_path) await fs.rm(req.user.avatar_path,{force:true});
    const result = await query(
      'UPDATE users SET avatar_path=NULL WHERE id=$1 RETURNING *',
      [req.user.id]
    );
    res.json({success:true,user:publicUser(result.rows[0])});
  } catch(err) { next(err); }
});

router.post('/id-card', requireAuth, idCardUpload.single('idCard'), async (req,res,next) => {
  try {
    if (!req.file) return res.status(400).json({success:false,message:'ID-card image is required.'});
    if (req.user.id_card_path) await fs.rm(req.user.id_card_path,{force:true});

    let ocrText = '';
    try {
      const worker = await createWorker('eng');
      const result = await worker.recognize(req.file.path);
      ocrText = String(result.data?.text || '').trim();
      await worker.terminate();
    } catch (ocrErr) {
      console.warn('ID-card OCR unavailable:', ocrErr.message);
    }

    const normalized = ocrText.toLowerCase().replace(/[^a-z0-9]/g,'');
    const memberId = String(req.user.member_id || '').toLowerCase().replace(/[^a-z0-9]/g,'');
    const memberMatch = memberId.length >= 4 && normalized.includes(memberId);
    const nameWords = String(req.user.name || '').toLowerCase().split(/\s+/).filter(x=>x.length>2);
    const nameMatch = nameWords.length > 0 && nameWords.filter(w=>ocrText.toLowerCase().includes(w)).length >= Math.min(2,nameWords.length);
    const verified = memberMatch && nameMatch;

    const result = await query(
      `UPDATE users SET id_card_path=$1,id_card_ocr_text=$2,
         verification_status=$3,id_card_verified_at=$4
       WHERE id=$5 RETURNING *`,
      [req.file.path,ocrText,verified?'VERIFIED':'PENDING',verified?new Date():null,req.user.id]
    );
    res.json({
      success:true,
      message: verified
        ? 'ID card uploaded and identity details matched.'
        : 'ID card uploaded. Your identity is pending verification.',
      extractedText: ocrText,
      verificationMatched: verified,
      user:publicUser(result.rows[0])
    });
  } catch(err) { next(err); }
});

export default router;
