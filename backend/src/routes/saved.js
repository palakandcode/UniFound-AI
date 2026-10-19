import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router=express.Router();

router.get('/',requireAuth,async(req,res,next)=>{
  try{
    const r=await query(
      `SELECT i.* FROM saved_items s JOIN items i ON i.id=s.item_id
       WHERE s.user_id=$1 ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json({success:true,items:r.rows});
  }catch(err){next(err);}
});

router.post('/:itemId',requireAuth,async(req,res,next)=>{
  try{
    await query(
      `INSERT INTO saved_items(user_id,item_id) VALUES($1,$2)
       ON CONFLICT DO NOTHING`,
      [req.user.id,req.params.itemId]
    );
    res.status(201).json({success:true});
  }catch(err){next(err);}
});

router.delete('/:itemId',requireAuth,async(req,res,next)=>{
  try{
    await query('DELETE FROM saved_items WHERE user_id=$1 AND item_id=$2',[req.user.id,req.params.itemId]);
    res.json({success:true});
  }catch(err){next(err);}
});

export default router;
