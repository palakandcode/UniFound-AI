import express from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router=express.Router();
router.use(requireAuth,requireAdmin);

router.get('/stats',async(_req,res,next)=>{
  try{
    const [users,items,claims]=await Promise.all([
      query(`SELECT count(*)::int AS count FROM users`),
      query(`SELECT count(*)::int AS count FROM items`),
      query(`SELECT count(*)::int AS count FROM claims WHERE status='PENDING'`)
    ]);
    res.json({success:true,stats:{
      users:users.rows[0].count,items:items.rows[0].count,pendingClaims:claims.rows[0].count
    }});
  }catch(err){next(err);}
});

router.get('/users',async(req,res,next)=>{
  try{
    const r=await query(
      `SELECT id,name,member_id,email,verification_status,role,status,created_at
       FROM users ORDER BY created_at DESC LIMIT 500`
    );
    res.json({success:true,users:r.rows});
  }catch(err){next(err);}
});


router.get('/users/:id/id-card',async(req,res,next)=>{
  try{
    const r=await query('SELECT id_card_path FROM users WHERE id=$1',[req.params.id]);
    const user=r.rows[0];
    if(!user)return res.status(404).json({success:false,message:'User not found.'});
    if(!user.id_card_path)return res.status(404).json({success:false,message:'No ID card has been uploaded.'});
    res.sendFile(user.id_card_path);
  }catch(err){next(err);}
});

router.patch('/users/:id',async(req,res,next)=>{
  try{
    const {status,verificationStatus}=req.body;
    const fields=[];const values=[];
    if(status){fields.push(`status=$${values.length+1}`);values.push(status);}
    if(verificationStatus){fields.push(`verification_status=$${values.length+1}`);values.push(verificationStatus);}
    if(!fields.length)return res.status(400).json({success:false,message:'No changes supplied.'});
    values.push(req.params.id);
    const r=await query(`UPDATE users SET ${fields.join(',')} WHERE id=$${values.length} RETURNING id,name,member_id,email,verification_status,status,role`,values);
    if(!r.rows[0])return res.status(404).json({success:false,message:'User not found.'});
    res.json({success:true,user:r.rows[0]});
  }catch(err){next(err);}
});

router.get('/claims',async(_req,res,next)=>{
  try{
    const r=await query(
      `SELECT c.*,i.title,u.name AS claimant_name
       FROM claims c JOIN items i ON i.id=c.item_id JOIN users u ON u.id=c.claimant_id
       ORDER BY c.created_at DESC LIMIT 500`
    );
    res.json({success:true,claims:r.rows});
  }catch(err){next(err);}
});

export default router;
