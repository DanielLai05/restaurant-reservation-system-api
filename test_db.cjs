const { Pool } = require('pg');

async function test() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'restaurant_reservation',
    user: 'postgres',
    password: 'postgres'
  });

  try {
    console.log('Testing connection...');
    const res = await pool.query('SELECT NOW()');
    console.log('Connected:', res.rows[0]);

    // Check if customer_id column exists
    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'notification' AND column_name = 'customer_id'
    `);
    console.log('customer_id column exists:', columns.rows.length > 0);

    // Check notifications
    const notifications = await pool.query(`
      SELECT * FROM notification WHERE type = 'cancellation_approved' OR type = 'cancellation_rejected'
      ORDER BY created_at DESC LIMIT 10
    `);
    console.log('Cancellation notifications found:', notifications.rows.length);

    if (notifications.rows.length > 0) {
      notifications.rows.forEach(n => {
        console.log(`  ID: ${n.id}, Type: ${n.type}, Customer ID: ${n.customer_id}, Title: ${n.title}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

test();
