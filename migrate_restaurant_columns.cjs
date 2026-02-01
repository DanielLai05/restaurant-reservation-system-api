// Migration script to add missing columns to restaurant table
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_reservation',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password'
});

async function migrateRestaurantTable() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if is_active column exists
    const isActiveCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'restaurant'
        AND column_name = 'is_active'
      )
    `);

    if (!isActiveCheck.rows[0].exists) {
      console.log('Adding is_active column to restaurant table...');
      await client.query(`
        ALTER TABLE restaurant
        ADD COLUMN is_active BOOLEAN DEFAULT TRUE
      `);
      console.log('✓ Added is_active column');
    } else {
      console.log('✓ is_active column already exists');
    }

    // Check if image_url column exists
    const imageUrlCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'restaurant'
        AND column_name = 'image_url'
      )
    `);

    if (!imageUrlCheck.rows[0].exists) {
      console.log('Adding image_url column to restaurant table...');
      await client.query(`
        ALTER TABLE restaurant
        ADD COLUMN image_url VARCHAR(500)
      `);
      console.log('✓ Added image_url column');
    } else {
      console.log('✓ image_url column already exists');
    }

    // Check if max_capacity column exists
    const maxCapacityCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'restaurant'
        AND column_name = 'max_capacity'
      )
    `);

    if (!maxCapacityCheck.rows[0].exists) {
      console.log('Adding max_capacity column to restaurant table...');
      await client.query(`
        ALTER TABLE restaurant
        ADD COLUMN max_capacity INTEGER
      `);
      console.log('✓ Added max_capacity column');
    } else {
      console.log('✓ max_capacity column already exists');
    }

    await client.query('COMMIT');
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateRestaurantTable();
