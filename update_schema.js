import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { require: true },
});

async function updateSchema() {
  const client = await pool.connect();
  try {
    console.log('🔄 Updating customer table schema...');
    
    // Add firebase_uid column if not exists
    await client.query(`
      ALTER TABLE customer 
      ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128)
    `);
    console.log('✅ Added firebase_uid column');
    
    // Make email unique if not already
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_email_unique 
      ON customer(email) 
      WHERE email IS NOT NULL
    `);
    console.log('✅ Added unique index on email');
    
    console.log('\n✅ Schema update completed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

updateSchema();
