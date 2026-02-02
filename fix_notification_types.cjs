// fix_notification_types.cjs - Fix notification type check constraint to include cancellation_approved and cancellation_rejected
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
    console.log('🔧 Fixing notification type check constraint...');

    // First, check what types are currently allowed
    const constraintResult = await pool.query(`
      SELECT cons.consrc as constraint_definition
      FROM pg_constraint cons
      JOIN pg_class rel ON rel.oid = cons.conrelid
      JOIN pg_namespace nsp ON nsp.oid = connamespace
      WHERE rel.relname = 'notification' 
        AND cons.conname = 'notification_type_check'
    `);

    if (constraintResult.rows.length > 0) {
      console.log('Current constraint:', constraintResult.rows[0].constraint_definition);

      // Drop the old constraint
      await pool.query(`
        ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_type_check
      `);
      console.log('✅ Dropped old constraint');

      // Add new constraint with all notification types
      await pool.query(`
        ALTER TABLE notification ADD CONSTRAINT notification_type_check
        CHECK (type IN (
          'reservation_new', 
          'reservation_cancelled', 
          'cancellation_request', 
          'cancellation_approved', 
          'cancellation_rejected', 
          'order_new', 
          'reservation_confirmed'
        ))
      `);
      console.log('✅ Added new constraint with cancellation_approved and cancellation_rejected');
    } else {
      console.log('Constraint not found, creating it...');
      await pool.query(`
        ALTER TABLE notification ADD CONSTRAINT notification_type_check
        CHECK (type IN (
          'reservation_new', 
          'reservation_cancelled', 
          'cancellation_request', 
          'cancellation_approved', 
          'cancellation_rejected', 
          'order_new', 
          'reservation_confirmed'
        ))
      `);
      console.log('✅ Created constraint');
    }

    // Verify the fix
    const verifyResult = await pool.query(`
      SELECT cons.consrc as constraint_definition
      FROM pg_constraint cons
      JOIN pg_class rel ON rel.oid = cons.conrelid
      WHERE rel.relname = 'notification' 
        AND cons.conname = 'notification_type_check'
    `);
    console.log('New constraint:', verifyResult.rows[0].constraint_definition);

    console.log('\n✅ Fix completed successfully!');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();
