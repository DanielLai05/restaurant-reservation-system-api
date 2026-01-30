// Migration script to add cancellation columns to reservation table
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
    console.log('Adding cancellation columns to reservation table...');
    
    // Add cancellation_reason column
    await pool.query(`
      ALTER TABLE reservation 
      ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500);
    `);
    
    console.log('✅ Added cancellation_reason column');
    
    // Verify the columns exist
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
