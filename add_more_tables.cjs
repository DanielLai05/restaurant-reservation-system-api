// add_more_tables.cjs - Add more tables for each restaurant
const { Pool } = require('pg');
require('dotenv').config({ override: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  ssl: { require: true },
});

async function addMoreTables() {
  try {
    console.log('Adding more tables for each restaurant...\n');
    
    // Define more tables for each restaurant - using numeric table numbers
    const tables = [
      // Restaurant 1: Sushi Palace (2-seaters)
      { restaurant_id: 1, table_number: '101', capacity: 2, location: 'Window' },
      { restaurant_id: 1, table_number: '102', capacity: 2, location: 'Window' },
      { restaurant_id: 1, table_number: '103', capacity: 2, location: 'Window' },
      
      // Restaurant 1: Sushi Palace (4-seaters)
      { restaurant_id: 1, table_number: '201', capacity: 4, location: 'Main Hall' },
      { restaurant_id: 1, table_number: '202', capacity: 4, location: 'Main Hall' },
      { restaurant_id: 1, table_number: '203', capacity: 4, location: 'Main Hall' },
      { restaurant_id: 1, table_number: '204', capacity: 4, location: 'Main Hall' },
      
      // Restaurant 1: Sushi Palace (6-seaters)
      { restaurant_id: 1, table_number: '301', capacity: 6, location: 'Private Room' },
      { restaurant_id: 1, table_number: '302', capacity: 6, location: 'Private Room' },
      
      // Restaurant 1: Sushi Palace (8-seaters)
      { restaurant_id: 1, table_number: '401', capacity: 8, location: 'VIP Room' },
      { restaurant_id: 1, table_number: '402', capacity: 8, location: 'VIP Room' },
      
      // Restaurant 2: Pasta Paradise (2-seaters)
      { restaurant_id: 2, table_number: '101', capacity: 2, location: 'Patio' },
      { restaurant_id: 2, table_number: '102', capacity: 2, location: 'Patio' },
      { restaurant_id: 2, table_number: '103', capacity: 2, location: 'Patio' },
      { restaurant_id: 2, table_number: '104', capacity: 2, location: 'Patio' },
      
      // Restaurant 2: Pasta Paradise (4-seaters)
      { restaurant_id: 2, table_number: '201', capacity: 4, location: 'Main Dining' },
      { restaurant_id: 2, table_number: '202', capacity: 4, location: 'Main Dining' },
      { restaurant_id: 2, table_number: '203', capacity: 4, location: 'Main Dining' },
      { restaurant_id: 2, table_number: '204', capacity: 4, location: 'Main Dining' },
      { restaurant_id: 2, table_number: '205', capacity: 4, location: 'Main Dining' },
      
      // Restaurant 2: Pasta Paradise (6-seaters)
      { restaurant_id: 2, table_number: '301', capacity: 6, location: 'Private Room' },
      { restaurant_id: 2, table_number: '302', capacity: 6, location: 'Private Room' },
      
      // Restaurant 2: Pasta Paradise (8-seaters)
      { restaurant_id: 2, table_number: '401', capacity: 8, location: 'Family Room' },
      { restaurant_id: 2, table_number: '402', capacity: 8, location: 'Family Room' },
      
      // Restaurant 3: Curry House (2-seaters)
      { restaurant_id: 3, table_number: '1', capacity: 2, location: 'Ground Floor' },
      { restaurant_id: 3, table_number: '2', capacity: 2, location: 'Ground Floor' },
      { restaurant_id: 3, table_number: '3', capacity: 2, location: 'Ground Floor' },
      { restaurant_id: 3, table_number: '4', capacity: 2, location: 'Ground Floor' },
      { restaurant_id: 3, table_number: '5', capacity: 2, location: 'Ground Floor' },
      
      // Restaurant 3: Curry House (4-seaters)
      { restaurant_id: 3, table_number: '6', capacity: 4, location: 'First Floor' },
      { restaurant_id: 3, table_number: '7', capacity: 4, location: 'First Floor' },
      { restaurant_id: 3, table_number: '8', capacity: 4, location: 'First Floor' },
      { restaurant_id: 3, table_number: '9', capacity: 4, location: 'First Floor' },
      { restaurant_id: 3, table_number: '10', capacity: 4, location: 'First Floor' },
      
      // Restaurant 3: Curry House (6-seaters)
      { restaurant_id: 3, table_number: '11', capacity: 6, location: 'Family Section' },
      { restaurant_id: 3, table_number: '12', capacity: 6, location: 'Family Section' },
      
      // Restaurant 3: Curry House (8-seaters)
      { restaurant_id: 3, table_number: '13', capacity: 8, location: 'Banquet Hall' },
      { restaurant_id: 3, table_number: '14', capacity: 8, location: 'Banquet Hall' },
    ];

    let addedCount = 0;
    for (const table of tables) {
      try {
        await pool.query(
          'INSERT INTO restaurant_table (restaurant_id, table_number, capacity, location) VALUES ($1, $2, $3, $4)',
          [table.restaurant_id, table.table_number, table.capacity, table.location]
        );
        addedCount++;
      } catch (err) {
        if (err.code !== '23505') {
          console.log('Note: Error adding table', table.table_number, ':', err.message);
        }
      }
    }
    
    console.log('Added ' + addedCount + ' new tables!\n');
    
    // Show summary for each restaurant
    for (let rid = 1; rid <= 3; rid++) {
      const result = await pool.query(
        'SELECT capacity, COUNT(*) as count FROM restaurant_table WHERE restaurant_id = $1 GROUP BY capacity ORDER BY capacity',
        [rid]
      );
      
      let restaurantName = rid === 1 ? 'Sushi Palace' : rid === 2 ? 'Pasta Paradise' : 'Curry House';
      
      console.log(restaurantName + ' (ID: ' + rid + '):');
      result.rows.forEach(row => {
        console.log('  ' + row.capacity + ' seats: ' + row.count + ' tables');
      });
      console.log('');
    }
    
    // Total count
    const total = await pool.query('SELECT COUNT(*) as total FROM restaurant_table');
    console.log('Total tables in database: ' + total.rows[0].total);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

addMoreTables();
