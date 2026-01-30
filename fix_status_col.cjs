// Migration script to fix column sizes for cancellation feature
require('dotenv').config();
const pg = require('pg');

const { Pool } = pg;

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      require: true,
    },
  });

  try {
    console.log('Fixing column sizes for cancellation feature...');
    
    // Increase status column size from 20 to 50 to accommodate 'cancellation_requested'
    await pool.query(`
      ALTER TABLE reservation 
      ALTER COLUMN status TYPE VARCHAR(50);
    `);
    
    console.log('✅ Increased status column to VARCHAR(50)');
    
    // Also ensure cancellation_reason exists
    await pool.query(`
      ALTER TABLE reservation 
      ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500);
    `);
    
    console.log('✅ Verified cancellation_reason column');
    
    // Verify the columns
    const result = await pool.query(`
      SELECT column_name, data_type, character_maximum_length 
      FROM information_schema.columns 
      WHERE table_name = 'reservation' 
      AND column_name IN ('cancellation_reason', 'status')
      ORDER BY column_name
    `);
    
    console.log('Current columns:');
    console.log(JSON.stringify(result.rows, null, 2));
    
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
  } finally {
    await pool.end();
  }
}

runMigration();
