import express from 'express';
import fs from 'fs/promises';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { itemUpload } from '../middleware/upload.js';
import { createNotification } from '../services/notifications.js';
import { getMatches } from '../services/matching.js';

const router = express.Router();

function normalizeType(v) {
  return String(v || '').toUpperCase() === 'FOUND' ? 'FOUND' : 'LOST';
}

router.get('/', async (req,res,next) => {
  try {
    const {
      search='', type='', category='', location='', status='ACTIVE',
      dateFrom='', dateTo='', sort='newest', page='1', limit='20'
    } = req.query;

    const params = [];
    const where = [];
    if (status !== 'all') { params.push(status.toUpperCase()); where.push(`i.status=$${params.length}`); }
    if (type) { params.push(normalizeType(type)); where.push(`i.type=$${params.length}`); }
    if (category) { params.push(category); where.push(`i.category=$${params.length}`); }
    if (location) { params.push(`%${location}%`); where.push(`i.location ILIKE $${params.length}`); }
    if (dateFrom) { params.push(dateFrom); where.push(`i.event_date >= $${params.length}`); }
    if (dateTo) { params.push(dateTo); where.push(`i.event_date <= $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(i.title ILIKE $${params.length} OR i.description ILIKE $${params.length} OR i.location ILIKE $${params.length} OR coalesce(i.brand,'') ILIKE $${params.length} OR coalesce(i.color,'') ILIKE $${params.length})`);
    }

    const pageNum = Math.max(1,Number(page)||1);
    const limitNum = Math.min(100,Math.max(1,Number(limit)||20));
    const offset = (pageNum-1)*limitNum;
    const order = sort === 'oldest' ? 'i.created_at ASC' : 'i.created_at DESC';

    const sql = `
      SELECT i.id,i.type,i.title,i.description,i.category,i.location,i.event_date,
             i.approximate_time,i.color,i.brand,i.image_path,i.storage_location,
             i.status,i.owner_id,i.matched_item_id,i.created_at,i.updated_at,
             u.name AS owner_name,u.avatar_path AS owner_avatar,
             u.allow_messages,u.allow_calls,u.allow_email
      FROM items i JOIN users u ON u.id=i.owner_id
      WHERE u.email NOT IN ('demo@somaiya.edu','test2@somaiya.edu')
      ${where.length ? 'AND '+where.join(' AND ') : ''}
      ORDER BY ${order}
      LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limitNum,offset);

    const result = await query(sql,params);
    res.json({success:true,page:pageNum,limit:limitNum,items:result.rows});
  } catch(err) { next(err); }
});

router.post('/', requireAuth, itemUpload.single('image'), async (req,res,next) => {
  try {
    const {
      type,title,description,category,location,eventDate,approximateTime,
      color,brand,identifyingCharacteristics,storageLocation
    } = req.body;

    const normalizedType = normalizeType(type);
    if (!title || !description || !category || !location || !eventDate) {
      return res.status(400).json({success:false,message:'Title, description, category, date and location are required.'});
    }
    if (normalizedType === 'FOUND' && !storageLocation) {
      return res.status(400).json({success:false,message:'Storage location is required for found items.'});
    }

    const result = await query(
      `INSERT INTO items(type,title,description,category,location,event_date,approximate_time,
         color,brand,identifying_characteristics,image_path,storage_location,owner_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [normalizedType,title.trim(),description.trim(),category,location,eventDate,approximateTime||null,
       color||null,brand||null,identifyingCharacteristics||null,req.file?.path||null,
       storageLocation||null,req.user.id]
    );

    res.status(201).json({success:true,item:result.rows[0]});
  } catch(err) { next(err); }
});

router.get('/:id', async (req,res,next) => {
  try {
    const result = await query(
      `SELECT i.*,u.name AS owner_name,u.avatar_path AS owner_avatar,
              u.phone,u.email,u.allow_messages,u.allow_calls,u.allow_email
       FROM items i JOIN users u ON u.id=i.owner_id WHERE i.id=$1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({success:false,message:'Item not found.'});
    const item = result.rows[0];

    // Do not expose private distinguishing characteristics publicly.
    delete item.identifying_characteristics;
    delete item.phone;
    delete item.email;

    res.json({success:true,item});
  } catch(err) { next(err); }
});

router.patch('/:id', requireAuth, itemUpload.single('image'), async (req,res,next) => {
  try {
    const existing = await query('SELECT * FROM items WHERE id=$1',[req.params.id]);
    const item = existing.rows[0];
    if (!item) return res.status(404).json({success:false,message:'Item not found.'});
    if (item.owner_id !== req.user.id) return res.status(403).json({success:false,message:'You can only edit your own report.'});

    const body=req.body;
    const fields=[]; const values=[];
    const map = {
      title:'title',description:'description',category:'category',location:'location',
      eventDate:'event_date',approximateTime:'approximate_time',color:'color',
      brand:'brand',identifyingCharacteristics:'identifying_characteristics',
      storageLocation:'storage_location',status:'status'
    };
    for (const [key,col] of Object.entries(map)) {
      if (body[key] !== undefined) {
        fields.push(`${col}=$${values.length+1}`); values.push(body[key]);
      }
    }
    if (req.file) {
      if (item.image_path) await fs.rm(item.image_path,{force:true});
      fields.push(`image_path=$${values.length+1}`); values.push(req.file.path);
    }
    if (!fields.length) return res.status(400).json({success:false,message:'No changes supplied.'});

    values.push(req.params.id);
    const result = await query(`UPDATE items SET ${fields.join(',')} WHERE id=$${values.length} RETURNING *`,values);
    res.json({success:true,item:result.rows[0]});
  } catch(err) { next(err); }
});

router.delete('/:id', requireAuth, async (req,res,next) => {
  try {
    const result = await query('SELECT * FROM items WHERE id=$1',[req.params.id]);
    const item=result.rows[0];
    if (!item) return res.status(404).json({success:false,message:'Item not found.'});
    if (item.owner_id !== req.user.id) return res.status(403).json({success:false,message:'You can only delete your own report.'});
    if (item.image_path) await fs.rm(item.image_path,{force:true});
    await query('DELETE FROM items WHERE id=$1',[req.params.id]);
    res.json({success:true,message:'Report deleted.'});
  } catch(err) { next(err); }
});

router.post('/:id/return', requireAuth, async (req,res,next) => {
  try {
    const result=await query('SELECT * FROM items WHERE id=$1',[req.params.id]);
    const item=result.rows[0];
    if (!item) return res.status(404).json({success:false,message:'Item not found.'});
    if (item.owner_id !== req.user.id) return res.status(403).json({success:false,message:'Only the report owner can close this item.'});
    if(item.type==='FOUND' && item.status==='CLAIMED') return res.status(409).json({success:false,message:'A claimed found item can only be closed by the approved claimant using “I received it”.'});
    await query(`UPDATE items SET status='RETURNED' WHERE id=$1`,[item.id]);
    await createNotification({
      userId:req.user.id,type:'STATUS',title:'Item marked returned',
      message:`Your report “${item.title}” has been marked returned.`,itemId:item.id
    });
    res.json({success:true,message:'Item marked returned.'});
  } catch(err) { next(err); }
});

router.get('/:id/matches', requireAuth, async (req,res,next) => {
  try {
    const matches=await getMatches(req.params.id,req.user.id);
    if (matches===null) return res.status(403).json({success:false,message:'You can only view matches for your own reports.'});
    res.json({success:true,matches});
  } catch(err) { next(err); }
});

export default router;
