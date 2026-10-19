import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { createNotification } from '../services/notifications.js';

const router=express.Router();

async function participant(conversationId,userId){
  const r=await query(
    'SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2',
    [conversationId,userId]
  );
  return !!r.rows[0];
}

router.get('/conversations',requireAuth,async(req,res,next)=>{
  try{
    const r=await query(
      `SELECT c.id,c.item_id,c.marketplace_listing_id,c.created_at,c.updated_at,
              COALESCE(i.title,ml.title) AS item_title,
              COALESCE(json_agg(json_build_object(
                'id',u.id,'name',u.name,'avatar',u.avatar_path,
                'phone',CASE WHEN u.allow_calls THEN u.phone ELSE NULL END,
                'email',CASE WHEN u.allow_email THEN u.email ELSE NULL END,
                'allow_calls',u.allow_calls,'allow_email',u.allow_email,'allow_messages',u.allow_messages
              ))
              FILTER (WHERE u.id IS NOT NULL),'[]') AS participants,
              (SELECT content FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT count(*)::int FROM messages um WHERE um.conversation_id=c.id AND um.sender_id<>$1 AND um.read_at IS NULL) AS unread_count
       FROM conversations c
       JOIN conversation_participants me ON me.conversation_id=c.id AND me.user_id=$1
       LEFT JOIN items i ON i.id=c.item_id
       LEFT JOIN marketplace_listings ml ON ml.id=c.marketplace_listing_id
       LEFT JOIN conversation_participants cp ON cp.conversation_id=c.id
       LEFT JOIN users u ON u.id=cp.user_id
       GROUP BY c.id,i.title,ml.title
       ORDER BY c.updated_at DESC`,
      [req.user.id]
    );
    res.json({success:true,conversations:r.rows});
  }catch(err){next(err);}
});

router.post('/conversations',requireAuth,async(req,res,next)=>{
  try{
    const {otherUserId,itemId,marketplaceListingId}=req.body;
    if(!otherUserId || otherUserId===req.user.id) return res.status(400).json({success:false,message:'A different user is required.'});
    if(itemId && marketplaceListingId) return res.status(400).json({success:false,message:'Choose one conversation context.'});

    const user=await query("SELECT id,name,allow_messages FROM users WHERE id=$1 AND status='ACTIVE'",[otherUserId]);
    if(!user.rows[0]) return res.status(404).json({success:false,message:'User not found.'});
    if(!user.rows[0].allow_messages) return res.status(403).json({success:false,message:'This user has disabled in-app messages.'});

    if(itemId){
      const item=await query('SELECT id,owner_id,status,type FROM items WHERE id=$1',[itemId]);
      if(!item.rows[0]) return res.status(404).json({success:false,message:'Item not found.'});
      const approved=await query(
        `SELECT 1 FROM claims WHERE item_id=$1 AND status='APPROVED'
         AND ((claimant_id=$2 AND EXISTS(SELECT 1 FROM items WHERE id=$1 AND owner_id=$3))
           OR (claimant_id=$3 AND EXISTS(SELECT 1 FROM items WHERE id=$1 AND owner_id=$2)))
         LIMIT 1`,
        [itemId,req.user.id,otherUserId]
      );
      if(!approved.rows[0]) return res.status(403).json({success:false,message:'Messaging for an item is unlocked only after its ownership claim is approved.'});
    }
    if(marketplaceListingId){
      const listing=await query("SELECT l.id,l.owner_id,l.status,u.allow_messages FROM marketplace_listings l JOIN users u ON u.id=l.owner_id WHERE l.id=$1",[marketplaceListingId]);
      if(!listing.rows[0] || listing.rows[0].status!=='ACTIVE') return res.status(404).json({success:false,message:'This listing is no longer available.'});
      if(!listing.rows[0].allow_messages) return res.status(403).json({success:false,message:'This student has disabled in-app messages.'});
      if(![req.user.id,otherUserId].includes(listing.rows[0].owner_id)) return res.status(403).json({success:false,message:'Only the listing owner and interested student can message about this listing.'});
    }

    const existing=await query(
      `SELECT c.id FROM conversations c
       WHERE ($1::uuid IN (SELECT user_id FROM conversation_participants WHERE conversation_id=c.id))
         AND ($2::uuid IN (SELECT user_id FROM conversation_participants WHERE conversation_id=c.id))
         AND (($3::uuid IS NULL AND $4::uuid IS NULL) OR c.item_id=$3 OR c.marketplace_listing_id=$4)
       LIMIT 1`,
      [req.user.id,otherUserId,itemId||null,marketplaceListingId||null]
    );

    let conversationId=existing.rows[0]?.id;
    if(!conversationId){
      const c=await query('INSERT INTO conversations(item_id,marketplace_listing_id) VALUES($1,$2) RETURNING id',[itemId||null,marketplaceListingId||null]);
      conversationId=c.rows[0].id;
      await query(
        'INSERT INTO conversation_participants(conversation_id,user_id) VALUES($1,$2),($1,$3)',
        [conversationId,req.user.id,otherUserId]
      );
    }

    res.status(201).json({success:true,conversationId});
  }catch(err){next(err);}
});

router.get('/conversations/:id/messages',requireAuth,async(req,res,next)=>{
  try{
    if(!await participant(req.params.id,req.user.id)) return res.status(403).json({success:false,message:'Conversation access denied.'});
    const r=await query(
      `SELECT m.*,u.name AS sender_name,u.avatar_path AS sender_avatar
       FROM messages m JOIN users u ON u.id=m.sender_id
       WHERE m.conversation_id=$1 ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    await query(
      `UPDATE messages SET read_at=NOW()
       WHERE conversation_id=$1 AND sender_id<>$2 AND read_at IS NULL`,
      [req.params.id,req.user.id]
    );
    res.json({success:true,messages:r.rows});
  }catch(err){next(err);}
});

router.post('/conversations/:id/messages',requireAuth,async(req,res,next)=>{
  try{
    if(!await participant(req.params.id,req.user.id)) return res.status(403).json({success:false,message:'Conversation access denied.'});
    const content=String(req.body.content||'').trim();
    if(!content) return res.status(400).json({success:false,message:'Message cannot be empty.'});
    if(content.length>4000) return res.status(400).json({success:false,message:'Message is too long.'});

    const result=await query(
      `INSERT INTO messages(conversation_id,sender_id,content) VALUES($1,$2,$3) RETURNING *`,
      [req.params.id,req.user.id,content]
    );
    await query('UPDATE conversations SET updated_at=NOW() WHERE id=$1',[req.params.id]);

    const others=await query(
      `SELECT user_id FROM conversation_participants WHERE conversation_id=$1 AND user_id<>$2`,
      [req.params.id,req.user.id]
    );
    for(const row of others.rows){
      await createNotification({
        userId:row.user_id,type:'MESSAGE',title:'New message',
        message:`You have a new UniFind message from ${req.user.name}.`
      });
    }

    res.status(201).json({success:true,message:result.rows[0]});
  }catch(err){next(err);}
});

router.post('/conversations/:id/calls',requireAuth,async(req,res,next)=>{
  try{
    if(!await participant(req.params.id,req.user.id)) return res.status(403).json({success:false,message:'Conversation access denied.'});
    const peer=await query(
      `SELECT u.id,u.name,u.allow_calls,u.phone
       FROM conversation_participants cp JOIN users u ON u.id=cp.user_id
       WHERE cp.conversation_id=$1 AND cp.user_id<>$2 AND u.status='ACTIVE' LIMIT 1`,
      [req.params.id,req.user.id]
    );
    if(!peer.rows[0]) return res.status(404).json({success:false,message:'The other participant is unavailable.'});
    if(!peer.rows[0].allow_calls) return res.status(403).json({success:false,message:'This student has not enabled calls in their contact preferences.'});
    await query("UPDATE call_sessions SET status='FAILED',updated_at=NOW(),ended_at=NOW() WHERE conversation_id=$1 AND status='RINGING' AND created_at<NOW()-INTERVAL '90 seconds'",[req.params.id]);
    const active=await query("SELECT id FROM call_sessions WHERE conversation_id=$1 AND status IN ('RINGING','ACCEPTED') AND created_at>NOW()-INTERVAL '30 minutes' LIMIT 1",[req.params.id]);
    if(active.rows[0]) return res.status(409).json({success:false,message:'A call is already in progress for this conversation.'});
    const created=await query(
      `INSERT INTO call_sessions(conversation_id,caller_id,callee_id) VALUES($1,$2,$3) RETURNING id,status,created_at`,
      [req.params.id,req.user.id,peer.rows[0].id]
    );
    res.status(201).json({success:true,call:created.rows[0],peer:{id:peer.rows[0].id,name:peer.rows[0].name,phone:peer.rows[0].phone}});
  }catch(err){next(err);}
});

router.get('/calls/incoming',requireAuth,async(req,res,next)=>{
  try{
    await query("UPDATE call_sessions SET status='FAILED',updated_at=NOW(),ended_at=NOW() WHERE callee_id=$1 AND status='RINGING' AND created_at<NOW()-INTERVAL '90 seconds'",[req.user.id]);
    const r=await query(
      `SELECT c.id,c.conversation_id,c.created_at,u.id AS caller_id,u.name AS caller_name,u.avatar_path AS caller_avatar
       FROM call_sessions c JOIN users u ON u.id=c.caller_id
       WHERE c.callee_id=$1 AND c.status='RINGING' ORDER BY c.created_at DESC LIMIT 5`,
      [req.user.id]
    );
    res.json({success:true,calls:r.rows});
  }catch(err){next(err);}
});

router.patch('/calls/:id',requireAuth,async(req,res,next)=>{
  try{
    const status=String(req.body.status||'').toUpperCase();
    if(!['ACCEPTED','REJECTED','ENDED','FAILED'].includes(status)) return res.status(400).json({success:false,message:'Invalid call state.'});
    const found=await query('SELECT * FROM call_sessions WHERE id=$1',[req.params.id]);
    const call=found.rows[0];
    if(!call) return res.status(404).json({success:false,message:'Call not found.'});
    if(![call.caller_id,call.callee_id].includes(req.user.id)) return res.status(403).json({success:false,message:'Call access denied.'});
    if(['ACCEPTED','REJECTED'].includes(status) && call.callee_id!==req.user.id) return res.status(403).json({success:false,message:'Only the person receiving the call can answer it.'});
    if(status==='ACCEPTED' && call.status!=='RINGING') return res.status(409).json({success:false,message:'This call is no longer ringing.'});
    if(['REJECTED','ENDED','FAILED'].includes(status) && !['RINGING','ACCEPTED'].includes(call.status)) return res.json({success:true,call:{id:call.id,status:call.status}});
    const updated=await query(
      `UPDATE call_sessions SET status=$1,updated_at=NOW(),ended_at=CASE WHEN $1 IN ('REJECTED','ENDED','FAILED') THEN NOW() ELSE NULL END WHERE id=$2 RETURNING id,status,updated_at`,
      [status,req.params.id]
    );
    res.json({success:true,call:updated.rows[0]});
  }catch(err){next(err);}
});

router.get('/calls/:id/signals',requireAuth,async(req,res,next)=>{
  try{
    const r=await query(
      `SELECT c.id,c.status,s.id AS signal_id,s.signal_type,s.payload,s.created_at
       FROM call_sessions c LEFT JOIN call_signals s ON s.call_id=c.id AND s.recipient_id=$2 AND s.id>$3
       WHERE c.id=$1 AND (c.caller_id=$2 OR c.callee_id=$2)
       ORDER BY s.id ASC`,
      [req.params.id,req.user.id,Math.max(0,Number(req.query.after)||0)]
    );
    if(!r.rows.length) return res.status(404).json({success:false,message:'Call not found.'});
    res.json({success:true,status:r.rows[0].status,signals:r.rows.filter(x=>x.signal_id).map(x=>({id:x.signal_id,type:x.signal_type,payload:x.payload,created_at:x.created_at}))});
  }catch(err){next(err);}
});

router.post('/calls/:id/signals',requireAuth,async(req,res,next)=>{
  try{
    const type=String(req.body.type||'').toUpperCase(),payload=req.body.payload;
    if(!['OFFER','ANSWER','ICE'].includes(type) || !payload || typeof payload!=='object' || Array.isArray(payload) || JSON.stringify(payload).length>12000) return res.status(400).json({success:false,message:'Invalid call signal.'});
    const r=await query('SELECT * FROM call_sessions WHERE id=$1',[req.params.id]);
    const call=r.rows[0];
    if(!call) return res.status(404).json({success:false,message:'Call not found.'});
    if(![call.caller_id,call.callee_id].includes(req.user.id)) return res.status(403).json({success:false,message:'Call access denied.'});
    if(!['RINGING','ACCEPTED'].includes(call.status)) return res.status(409).json({success:false,message:'This call has ended.'});
    const recipient=call.caller_id===req.user.id?call.callee_id:call.caller_id;
    const inserted=await query(
      `INSERT INTO call_signals(call_id,sender_id,recipient_id,signal_type,payload) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id`,
      [call.id,req.user.id,recipient,type,JSON.stringify(payload)]
    );
    res.status(201).json({success:true,signalId:inserted.rows[0].id});
  }catch(err){next(err);}
});

export default router;
