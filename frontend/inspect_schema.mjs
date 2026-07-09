import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://jkunfiidmmphszxknzve.supabase.co',
  process.env.VITE_SUPABASE_ANON_KEY || 'no-key'
);

// wait, frontend doesn't have dotenv installed typically if it's Vite, but we can just hardcode it for a quick test
