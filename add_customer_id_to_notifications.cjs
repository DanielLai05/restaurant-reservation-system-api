/**
 * Migration: Add customer_id column to notifications table
 * Run this to update the existing notifications table to support customer notifications
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
    console.log('🔄 Running migration: Add customer_id to notifications table...');

    // Add customer_id column
    await client.query(`
      ALTER TABLE notification
      ADD COLUMN IF NOT EXISTS customer_id VARCHAR(50) REFERENCES customer(id) ON DELETE CASCADE
    `);

    console.log('✅ customer_id column added successfully!');

    // Add new notification types
    await client.query(`
      ALTER TABLE notification
      DROP CONSTRAINT IF EXISTS notification_type_check
    `);

    await client.query(`
      ALTER TABLE notification
      ADD CONSTRAINT notification_type_check
      CHECK (type IN ('reservation_new', 'reservation_cancelled', 'cancellation_request', 'cancellation_approved', 'cancellation_rejected', 'order_new', 'reservation_confirmed'))
    `);

    console.log('✅ Notification types updated successfully!');
    console.log('📋 New notification types supported:');
    console.log('   - reservation_new: New reservation made');
    console.log('   - reservation_cancelled: Reservation cancelled');
    console.log('   - cancellation_request: Customer requested cancellation');
    console.log('   - cancellation_approved: Cancellation request approved by staff');
    console.log('   - cancellation_rejected: Cancellation request rejected by staff');
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
