import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { require: true },
});

async function checkDatabase() {
  const client = await pool.connect();
  try {
    console.log('🔄 Checking database tables...\n');
    
    // Check what tables exist
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('📋 Tables in database:');
    tablesResult.rows.forEach(row => console.log(`  - ${row.table_name}`));
    console.log('');
    
    // Check restaurant table columns
    const columnsResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'restaurant'
    `);
    console.log('📋 Restaurant table columns:');
    columnsResult.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));
    console.log('');
    
    // Test the query
    console.log('🔄 Testing the restaurants query...');
    try {
      const result = await client.query(`
        SELECT r.*, 
          (SELECT COUNT(*) FROM reservation WHERE restaurant_id = r.id) as total_reservations,
          (SELECT COUNT(*) FROM orders WHERE restaurant_id = r.id) as total_orders,
          (SELECT COUNT(*) FROM staff WHERE restaurant_id = r.id) as total_staff
        FROM restaurant r
        ORDER BY r.id DESC
        LIMIT 5
      `);
      console.log(`✅ Query successful! Found ${result.rows.length} restaurants`);
      result.rows.forEach(r => console.log(`  - ${r.name} (ID: ${r.id})`));
    } catch (err) {
      console.log(`❌ Query failed: ${err.message}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkDatabase();

