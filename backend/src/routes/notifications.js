import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router=express.Router();

router.get('/',requireAuth,async(req,res,next)=>{
  try{
    const r=await query(
      `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({success:true,notifications:r.rows});
  }catch(err){next(err);}
});

router.patch('/:id/read',requireAuth,async(req,res,next)=>{
  try{
    const r=await query(
      `UPDATE notifications SET read_at=NOW()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id,req.user.id]
    );
    if(!r.rows[0]) return res.status(404).json({success:false,message:'Notification not found.'});
    res.json({success:true,notification:r.rows[0]});
  }catch(err){next(err);}
});

router.patch('/read-all',requireAuth,async(req,res,next)=>{
  try{
    await query('UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL',[req.user.id]);
    res.json({success:true});
  }catch(err){next(err);}
});

export default router;
