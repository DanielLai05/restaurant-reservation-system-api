// fix_tables.cjs - Fix table foreign key issue
const { Pool } = require('pg');
require('dotenv').config({ override: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { require: true },
});

async function fixTables() {
  try {
    console.log('=== Fixing table table ===');
    
    // Get all restaurant tables with their details
    const rt = await pool.query('SELECT * FROM restaurant_table ORDER BY id');
    console.log('restaurant_table count:', rt.rows.length);
    
    // Check existing tables in the table table
    const tables = await pool.query('SELECT id FROM "table"');
    const existingIds = tables.rows.map(t => t.id);
    console.log('Existing table ids:', existingIds.length);
    
    // Find missing IDs
    const rtIds = rt.rows.map(r => r.id);
    const missingIds = rtIds.filter(id => !existingIds.includes(id));
    console.log('Missing table IDs to add:', missingIds.length);
    
    // Add missing tables with correct data
    for (const id of missingIds) {
      const rtRow = rt.rows.find(r => r.id === id);
      if (rtRow) {
        // Convert table_number to string if it's a number
        const tableNumber = String(rtRow.table_number || id);
        const capacity = rtRow.capacity || 4;
        const location = rtRow.location || 'Main Hall';
        const isAvailable = rtRow.is_available !== false;
        
        await pool.query(`
          INSERT INTO "table" (id, restaurant_id, table_number, capacity, location, is_available)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            restaurant_id = EXCLUDED.restaurant_id,
            table_number = EXCLUDED.table_number,
            capacity = EXCLUDED.capacity,
            location = EXCLUDED.location,
            is_available = EXCLUDED.is_available
        `, [id, rtRow.restaurant_id, tableNumber, capacity, location, isAvailable]);
        console.log('Added/Updated table id:', id);
      }
    }
    
    // Verify
    const count = await pool.query('SELECT COUNT(*) as count FROM "table"');
    console.log('Total tables in table table:', count.rows[0].count);
    
    console.log('\\nDone! Reservations should work now.');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixTables();
