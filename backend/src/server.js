import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { query, pool } from './db.js';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import itemRoutes from './routes/items.js';
import marketplaceRoutes from './routes/marketplace.js';
import claimRoutes from './routes/claims.js';
import messagingRoutes from './routes/messaging.js';
import notificationRoutes from './routes/notifications.js';
import savedRoutes from './routes/saved.js';
import adminRoutes from './routes/admin.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

const app=express();
const PORT=Number(process.env.PORT||5000);
const allowedClientOrigins=new Set([process.env.CLIENT_URL||'http://127.0.0.1:5500']);
if(process.env.NODE_ENV!=='production'){
  allowedClientOrigins.add('http://127.0.0.1:5500');
  allowedClientOrigins.add('http://localhost:5500');
}

app.disable('x-powered-by');
// Public item/avatar photos are loaded by the static frontend from a different
// local origin (usually :5500 -> :5000). ID-card uploads are never static.
app.use(helmet({ crossOriginResourcePolicy:{ policy:'cross-origin' } }));
app.use(cors({
  origin(origin,callback){callback(null,!origin||allowedClientOrigins.has(origin))},
  credentials: true
}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true,limit:'1mb'}));

const authLimiter=rateLimit({
  windowMs:15*60*1000,
  limit:50,
  standardHeaders:true,
  legacyHeaders:false,
  message:{success:false,message:'Too many authentication attempts. Please try again later.'}
});
app.use('/api/auth',authLimiter);

// Public item images only. ID cards are deliberately NOT served statically.
app.use('/uploads/items',express.static(path.resolve('uploads/items')));
app.use('/uploads/avatars',express.static(path.resolve('uploads/avatars')));

app.get('/api/health',async(_req,res)=>{
  try{
    await query('SELECT 1');
    res.json({success:true,message:'UniFind API is running',database:'connected'});
  }catch{
    res.status(503).json({success:false,message:'API is running but database is unavailable.',database:'disconnected'});
  }
});

app.use('/api/auth',authRoutes);
app.use('/api/profile',profileRoutes);
app.use('/api/items',itemRoutes);
app.use('/api/marketplace',marketplaceRoutes);
app.use('/api',claimRoutes);
app.use('/api',messagingRoutes);
app.use('/api/notifications',notificationRoutes);
app.use('/api/saved-items',savedRoutes);
app.use('/api/admin',adminRoutes);

app.use((err,req,res,_next)=>{
  console.error(err);
  if(err.code==='LIMIT_FILE_SIZE') return res.status(400).json({success:false,message:'Uploaded image is too large.'});
  if(err.message?.includes('Only JPG')) return res.status(400).json({success:false,message:err.message});
  res.status(500).json({success:false,message:'Internal server error.'});
});

const server=app.listen(PORT,async()=>{
  try{
    await query('SELECT 1');
    console.log(`UniFind API listening on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  }catch(err){
    console.error('Server started but PostgreSQL connection failed:',err.message);
  }
});

process.on('SIGINT',async()=>{
  server.close();
  await pool.end();
  process.exit(0);
});
