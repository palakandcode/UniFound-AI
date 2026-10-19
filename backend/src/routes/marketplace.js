import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { itemUpload } from '../middleware/upload.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const params = [];
    const where = ["l.status='ACTIVE'"];
    if (['SELL','RENT'].includes(String(req.query.type || '').toUpperCase())) {
      params.push(String(req.query.type).toUpperCase()); where.push(`l.listing_type=$${params.length}`);
    }
    if (req.query.category && req.query.category !== 'all') {
      params.push(String(req.query.category)); where.push(`l.category ILIKE $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).slice(0,100)}%`);
      where.push(`(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length} OR l.category ILIKE $${params.length})`);
    }
    const result = await query(
      `SELECT l.id,l.listing_type,l.title,l.description,l.category,l.price,l.price_period,
              l.location,l.image_path,l.status,l.owner_id,l.created_at,
              u.name AS owner_name,u.avatar_path AS owner_avatar,u.allow_messages
       FROM marketplace_listings l JOIN users u ON u.id=l.owner_id
       WHERE u.email NOT IN ('demo@somaiya.edu','test2@somaiya.edu')
         AND ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT 100`, params
    );
    res.json({ success:true, listings:result.rows });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, itemUpload.single('image'), async (req, res, next) => {
  try {
    const { type,title,description,category,price,period,location } = req.body;
    const listingType=String(type||'').toUpperCase();
    const amount=Number(price);
    if (!['SELL','RENT'].includes(listingType) || !title?.trim() || !description?.trim() || !category?.trim() || !location?.trim() || !Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({success:false,message:'Add a valid type, name, description, category, price and campus location.'});
    }
    const allowedPeriods=['day','week','month','semester'];
    if (listingType==='RENT' && !allowedPeriods.includes(period)) return res.status(400).json({success:false,message:'Choose a valid rental period.'});
    const result=await query(
      `INSERT INTO marketplace_listings(listing_type,title,description,category,price,price_period,location,image_path,owner_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [listingType,title.trim(),description.trim(),category.trim(),amount,listingType==='RENT'?period:null,location.trim(),req.file?.path||null,req.user.id]
    );
    res.status(201).json({success:true,listing:result.rows[0]});
  } catch (err) { next(err); }
});

router.patch('/:id/status', requireAuth, async (req, res, next) => {
  try {
    const status=String(req.body.status||'').toUpperCase();
    if (!['ACTIVE','SOLD','RENTED','CLOSED'].includes(status)) return res.status(400).json({success:false,message:'Invalid listing status.'});
    const result=await query(
      'UPDATE marketplace_listings SET status=$1 WHERE id=$2 AND owner_id=$3 RETURNING id,status',
      [status,req.params.id,req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({success:false,message:'Listing not found or not owned by you.'});
    res.json({success:true,listing:result.rows[0]});
  } catch (err) { next(err); }
});

export default router;
