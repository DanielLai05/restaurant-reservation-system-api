// seed_staff.js - Create/update staff accounts for testing
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function seedStaff() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
    ssl: { require: true },
  });

  try {
    console.log('Updating staff table structure...\n');

    // Add role column if it doesn't exist
    const roleCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'staff' AND column_name = 'role'
      )
    `);

    if (!roleCheck.rows[0].exists) {
      await pool.query(`ALTER TABLE staff ADD COLUMN role VARCHAR(50) DEFAULT 'staff'`);
      console.log('Added role column');
    }

    // Add name column if it doesn't exist (combine first_name and last_name)
    const nameCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'staff' AND column_name = 'name'
      )
    `);

    if (!nameCheck.rows[0].exists) {
      await pool.query(`ALTER TABLE staff ADD COLUMN name VARCHAR(255)`);
      console.log('Added name column');
    }

    console.log('\nCreating/updating staff accounts...\n');

    // Staff members to create
    const staffMembers = [
      { email: 'staff@sushi.com', password: 'staff123', name: 'Staff Lee', role: 'staff', restaurant_id: 1 },
      { email: 'staff@pasta.com', password: 'staff123', name: 'Staff Zhang', role: 'staff', restaurant_id: 2 },
      { email: 'staff@curry.com', password: 'staff123', name: 'Staff Kumar', role: 'staff', restaurant_id: 3 },
      { email: 'admin@restaurant.com', password: 'admin123', name: 'Admin User', role: 'admin', restaurant_id: null },
    ];

    for (const staff of staffMembers) {
      // Hash password
      const hashedPassword = await bcrypt.hash(staff.password, 10);

      // Check if staff already exists
      const existing = await pool.query(
        'SELECT id FROM staff WHERE email = $1',
        [staff.email]
      );

      if (existing.rows.length > 0) {
        // Update existing staff
        await pool.query(`
          UPDATE staff 
          SET password = $1, name = $2, role = $3, restaurant_id = $4
          WHERE email = $5
        `, [hashedPassword, staff.name, staff.role, staff.restaurant_id, staff.email]);
        console.log('Updated: ' + staff.email + ' (' + staff.role + ')');
      } else {
        // Insert new staff
        const nameParts = staff.name.split(' ');
        await pool.query(`
          INSERT INTO staff (email, password, name, role, restaurant_id, first_name, last_name)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [staff.email, hashedPassword, staff.name, staff.role, staff.restaurant_id, nameParts[0] || '', nameParts.slice(1).join(' ') || '']);
        console.log('Created: ' + staff.email + ' (' + staff.role + ')');
      }
    }

    console.log('\nStaff accounts ready!\n');
    console.log('Available accounts:');
    console.log('+-------------------+----------+------+');
    console.log('| Email             | Password | Role |');
    console.log('+-------------------+----------+------+');
    console.log('| staff@sushi.com   | staff123 | Staff |');
    console.log('| staff@pasta.com   | staff123 | Staff |');
    console.log('| staff@curry.com   | staff123 | Staff |');
    console.log('| admin@restaurant.com| admin123 | Admin |');
    console.log('+-------------------+----------+------+');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

seedStaff();
