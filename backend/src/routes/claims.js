import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { createNotification } from '../services/notifications.js';

const router=express.Router();

router.post('/items/:itemId/claims',requireAuth,async(req,res,next)=>{
  try{
    const {message}=req.body;
    if(!message || message.trim().length<15) return res.status(400).json({success:false,message:'Please provide at least 15 characters explaining why the item is yours.'});

    const itemResult=await query('SELECT * FROM items WHERE id=$1',[req.params.itemId]);
    const item=itemResult.rows[0];
    if(!item || item.type!=='FOUND' || item.status!=='ACTIVE') return res.status(400).json({success:false,message:'This item is not available for claiming.'});
    if(req.user.verification_status !== 'VERIFIED') return res.status(403).json({success:false,message:'Verify your Somaiya ID before submitting an ownership claim.'});
    if(item.owner_id===req.user.id) return res.status(400).json({success:false,message:'You cannot claim your own found report.'});

    const result=await query(
      `INSERT INTO claims(item_id,claimant_id,message) VALUES($1,$2,$3)
       ON CONFLICT(item_id,claimant_id) DO UPDATE SET message=EXCLUDED.message,status='PENDING'
       RETURNING *`,
      [item.id,req.user.id,message.trim()]
    );

    await createNotification({
      userId:item.owner_id,type:'CLAIM_SUBMITTED',title:'New claim request',
      message:`Someone submitted a claim for “${item.title}”.`,itemId:item.id,claimId:result.rows[0].id
    });

    res.status(201).json({success:true,claim:result.rows[0]});
  }catch(err){next(err);}
});

router.get('/claims',requireAuth,async(req,res,next)=>{
  try{
    const result=await query(
      `SELECT c.*,i.title,i.type,i.status AS item_status,i.owner_id,i.owner_id AS item_owner_id,
              u.name AS claimant_name,u.member_id AS claimant_member_id,u.email AS claimant_email,u.verification_status AS claimant_verification_status
       FROM claims c
       JOIN items i ON i.id=c.item_id
       JOIN users u ON u.id=c.claimant_id
       WHERE c.claimant_id=$1 OR i.owner_id=$1
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    res.json({success:true,claims:result.rows});
  }catch(err){next(err);}
});

router.patch('/claims/:id',requireAuth,async(req,res,next)=>{
  try{
    const {status}=req.body;
    if(!['APPROVED','REJECTED'].includes(status)) return res.status(400).json({success:false,message:'Status must be APPROVED or REJECTED.'});

    const claimResult=await query(
      `SELECT c.*,i.title,i.owner_id,i.status AS item_status
       FROM claims c JOIN items i ON i.id=c.item_id WHERE c.id=$1`,
      [req.params.id]
    );
    const claim=claimResult.rows[0];
    if(!claim) return res.status(404).json({success:false,message:'Claim not found.'});
    if(claim.owner_id!==req.user.id) return res.status(403).json({success:false,message:'Only the finder/report owner can review this claim.'});
    if(claim.status!=='PENDING') return res.status(409).json({success:false,message:'This claim has already been reviewed.'});

    const updated=await query('UPDATE claims SET status=$1 WHERE id=$2 AND status=\'PENDING\' RETURNING *',[status,claim.id]);
    if(!updated.rows[0]) return res.status(409).json({success:false,message:'This claim was already reviewed.'});

    if(status==='APPROVED'){
      if(claim.item_status!=='ACTIVE') return res.status(409).json({success:false,message:'This item is no longer available.'});
      await query(`UPDATE items SET status='CLAIMED' WHERE id=$1`,[claim.item_id]);
      await query(
        `UPDATE claims SET status='REJECTED'
         WHERE item_id=$1 AND id<>$2 AND status='PENDING'`,
        [claim.item_id,claim.id]
      );
      const participantCheck = await query(
        `SELECT c.id FROM conversations c
         JOIN conversation_participants a ON a.conversation_id=c.id AND a.user_id=$1
         JOIN conversation_participants b ON b.conversation_id=c.id AND b.user_id=$2
         WHERE c.item_id=$3 LIMIT 1`,
        [claim.owner_id,claim.claimant_id,claim.item_id]
      );
      if(!participantCheck.rows[0]){
        const conv = await query('INSERT INTO conversations(item_id) VALUES($1) RETURNING id',[claim.item_id]);
        await query(
          'INSERT INTO conversation_participants(conversation_id,user_id) VALUES($1,$2),($1,$3)',
          [conv.rows[0].id,claim.owner_id,claim.claimant_id]
        );
      }
    }

    await createNotification({
      userId:claim.claimant_id,
      type:status==='APPROVED'?'CLAIM_APPROVED':'CLAIM_REJECTED',
      title:status==='APPROVED'?'Claim approved':'Claim rejected',
      message:status==='APPROVED'
        ?`Your claim for “${claim.title}” was approved. Message the finder to coordinate a safe handover, then click Received when you have the item.`
        :`Your claim for “${claim.title}” was rejected.`,
      itemId:claim.item_id,claimId:claim.id
    });

    res.json({success:true,claim:updated.rows[0]});
  }catch(err){next(err);}
});


router.post('/claims/:id/received',requireAuth,async(req,res,next)=>{
  try{
    const r=await query(
      `SELECT c.*,i.title,i.status AS item_status,i.owner_id
       FROM claims c JOIN items i ON i.id=c.item_id WHERE c.id=$1`,
      [req.params.id]
    );
    const claim=r.rows[0];
    if(!claim) return res.status(404).json({success:false,message:'Claim not found.'});
    if(claim.claimant_id!==req.user.id) return res.status(403).json({success:false,message:'Only the approved claimant can confirm receipt.'});
    if(claim.status!=='APPROVED' || claim.item_status!=='CLAIMED') return res.status(409).json({success:false,message:'This claim is not ready to be marked received.'});

    await query('UPDATE items SET status=\'RETURNED\' WHERE id=$1',[claim.item_id]);
    await query('UPDATE claims SET updated_at=NOW() WHERE id=$1',[claim.id]);
    await createNotification({
      userId:claim.owner_id,type:'ITEM_RECEIVED',title:'Item received',
      message:`${req.user.name} confirmed receipt of “${claim.title}”.`,itemId:claim.item_id,claimId:claim.id
    });
    res.json({success:true,message:'Receipt confirmed. The item is now marked returned.'});
  }catch(err){next(err);}
});

export default router;
