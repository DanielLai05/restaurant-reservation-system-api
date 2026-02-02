// check_notification_customer_id.cjs - Check if customer_id column exists in notification table
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'restaurant_reservation',
    user: 'postgres',
    password: 'postgres'
  });

  try {
    console.log('🔍 Checking notification table structure...');

    // Check if customer_id column exists
    const columnResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'notification' AND column_name = 'customer_id'
    `);

    if (columnResult.rows.length > 0) {
      console.log('✅ customer_id column exists in notification table');

      // Check if there are any notifications with customer_id
      const countResult = await pool.query(`
        SELECT COUNT(*) as count FROM notification WHERE customer_id IS NOT NULL
      `);
      console.log(`📊 Notifications with customer_id: ${countResult.rows[0].count}`);

      // Check recent cancellation_approved notifications
      const recentResult = await pool.query(`
        SELECT * FROM notification 
        WHERE type = 'cancellation_approved' OR type = 'cancellation_rejected'
        ORDER BY created_at DESC
        LIMIT 10
      `);

      if (recentResult.rows.length > 0) {
        console.log('📋 Recent cancellation notifications:');
        recentResult.rows.forEach(n => {
          console.log(`  - ID: ${n.id}, Type: ${n.type}, Customer ID: ${n.customer_id}, Title: ${n.title}`);
        });
      } else {
        console.log('📋 No cancellation notifications found in database');
      }
    } else {
      console.log('❌ customer_id column does NOT exist in notification table');
      console.log('Adding customer_id column...');

      await pool.query(`
        ALTER TABLE notification 
        ADD COLUMN IF NOT EXISTS customer_id VARCHAR(50) REFERENCES customer(id) ON DELETE CASCADE
      `);
      console.log('✅ customer_id column added successfully');
    }

    // List all notifications to see what's in the database
    const allNotifications = await pool.query(`
      SELECT * FROM notification ORDER BY created_at DESC LIMIT 20
    `);
    console.log('\n📋 All recent notifications:');
    allNotifications.rows.forEach(n => {
      console.log(`  - ID: ${n.id}, Type: ${n.type}, Customer ID: ${n.customer_id}, Title: ${n.title}`);
    });
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();
