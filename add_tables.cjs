// add_tables.cjs - Add multiple tables for each restaurant
const { Pool } = require('pg');
require('dotenv').config({ override: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  ssl: { require: true },
});

async function addTables() {
  try {
    console.log('Adding multiple tables for each restaurant...\n');
    
    // Define tables for each restaurant
    const tables = [
      // Restaurant 1: Sushi Palace
      { restaurant_id: 1, table_number: 'A1', capacity: 2, location: 'Window' },
      { restaurant_id: 1, table_number: 'A2', capacity: 2, location: 'Window' },
      { restaurant_id: 1, table_number: 'B1', capacity: 4, location: 'Main Hall' },
      { restaurant_id: 1, table_number: 'B2', capacity: 4, location: 'Main Hall' },
      { restaurant_id: 1, table_number: 'B3', capacity: 4, location: 'Main Hall' },
      { restaurant_id: 1, table_number: 'C1', capacity: 6, location: 'Private Room' },
      { restaurant_id: 1, table_number: 'C2', capacity: 6, location: 'Private Room' },
      { restaurant_id: 1, table_number: 'D1', capacity: 8, location: 'VIP Room' },
      
      // Restaurant 2: Pasta Paradise
      { restaurant_id: 2, table_number: 'A1', capacity: 2, location: 'Patio' },
      { restaurant_id: 2, table_number: 'A2', capacity: 2, location: 'Patio' },
      { restaurant_id: 2, table_number: 'A3', capacity: 2, location: 'Patio' },
      { restaurant_id: 2, table_number: 'B1', capacity: 4, location: 'Main Dining' },
      { restaurant_id: 2, table_number: 'B2', capacity: 4, location: 'Main Dining' },
      { restaurant_id: 2, table_number: 'B3', capacity: 4, location: 'Main Dining' },
      { restaurant_id: 2, table_number: 'B4', capacity: 4, location: 'Main Dining' },
      { restaurant_id: 2, table_number: 'C1', capacity: 6, location: 'Private Room' },
      { restaurant_id: 2, table_number: 'C2', capacity: 6, location: 'Private Room' },
      { restaurant_id: 2, table_number: 'D1', capacity: 8, location: 'Family Room' },
      { restaurant_id: 2, table_number: 'D2', capacity: 8, location: 'Family Room' },
      
      // Restaurant 3: Curry House
      { restaurant_id: 3, table_number: '1', capacity: 2, location: 'Ground Floor' },
      { restaurant_id: 3, table_number: '2', capacity: 2, location: 'Ground Floor' },
      { restaurant_id: 3, table_number: '3', capacity: 2, location: 'Ground Floor' },
      { restaurant_id: 3, table_number: '4', capacity: 2, location: 'Ground Floor' },
      { restaurant_id: 3, table_number: '5', capacity: 4, location: 'First Floor' },
      { restaurant_id: 3, table_number: '6', capacity: 4, location: 'First Floor' },
      { restaurant_id: 3, table_number: '7', capacity: 4, location: 'First Floor' },
      { restaurant_id: 3, table_number: '8', capacity: 4, location: 'First Floor' },
      { restaurant_id: 3, table_number: '9', capacity: 6, location: 'Family Section' },
      { restaurant_id: 3, table_number: '10', capacity: 6, location: 'Family Section' },
      { restaurant_id: 3, table_number: '11', capacity: 8, location: 'Banquet Hall' },
      { restaurant_id: 3, table_number: '12', capacity: 8, location: 'Banquet Hall' },
    ];

    for (const table of tables) {
      try {
        await pool.query(
          'INSERT INTO restaurant_table (restaurant_id, table_number, capacity, location) VALUES ($1, $2, $3, $4)',
          [table.restaurant_id, table.table_number, table.capacity, table.location]
        );
      } catch (err) {
        // Ignore duplicate key errors
        if (err.code !== '23505') {
          console.log('Note: Table', table.table_number, 'already exists or error:', err.message);
        }
      }
    }
    
    console.log('✅ Tables added successfully!\n');
    
    // Show summary for each restaurant
    for (let rid = 1; rid <= 3; rid++) {
      const result = await pool.query(
        'SELECT capacity, COUNT(*) as count FROM restaurant_table WHERE restaurant_id = $1 GROUP BY capacity ORDER BY capacity',
        [rid]
      );
      
      const restaurantName = rid === 1 ? 'Sushi Palace' : rid === 2 ? 'Pasta Paradise' : 'Curry House';
      
      console.log(`${restaurantName} (ID: ${rid}):`);
      result.rows.forEach(row => {
        console.log(`  ${row.capacity} seats: ${row.count} tables`);
      });
      console.log('');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

addTables();
