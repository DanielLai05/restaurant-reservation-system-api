/**
 * Migration: Add notifications table
 * Run this to create the notifications table in the database
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    require: true,
  },
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migration: Add notifications table...');

    // Create notification table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification (
        id SERIAL PRIMARY KEY,
        restaurant_id INTEGER REFERENCES restaurant(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL CHECK (type IN ('reservation_new', 'reservation_cancelled', 'cancellation_request', 'order_new', 'reservation_confirmed')),
        title VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        reservation_id INTEGER REFERENCES reservation(id) ON DELETE CASCADE,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Notification table created successfully!');
    console.log('📋 Notification types supported:');
    console.log('   - reservation_new: New reservation made');
    console.log('   - reservation_cancelled: Reservation cancelled');
    console.log('   - cancellation_request: Customer requested cancellation');
    console.log('   - order_new: New food order');
    console.log('   - reservation_confirmed: Reservation confirmed');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => {
    console.log('🎉 Migration completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration error:', error);
    process.exit(1);
  });
