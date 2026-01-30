// seed_all.cjs - Seed all data for the restaurant reservation system
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config({ override: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  ssl: { require: true },
});

async function seedAll() {
  try {
    console.log('=== Starting Database Seeding ===\n');

    // ==================== RESTAURANTS ====================
    console.log('1. Creating restaurants...');
    
    const restaurants = [
      { name: 'Sushi Palace', location: '123 Main Street', cuisine: 'Japanese', description: 'Authentic Japanese sushi restaurant' },
      { name: 'Pasta Paradise', location: '456 Oak Avenue', cuisine: 'Italian', description: 'Fresh pasta and Italian cuisine' },
      { name: 'Curry House', location: '789 Spice Lane', cuisine: 'Indian', description: 'Traditional Indian curries' },
      { name: 'Spice Garden', location: '321 Garden Road', cuisine: 'Chinese', description: 'Cantonese and Szechuan dishes' },
      { name: 'Sakura Japanese Restaurant', location: '555 Cherry Blossom Way', cuisine: 'Japanese', description: 'Premium Japanese dining experience' }
    ];

    const createdRestaurants = [];
    for (const r of restaurants) {
      // Check if exists first
      const existing = await pool.query('SELECT id, name FROM restaurant WHERE name = $1', [r.name]);
      if (existing.rows.length > 0) {
        console.log('  - Already exists: ' + r.name + ' (ID: ' + existing.rows[0].id + ')');
        createdRestaurants.push(existing.rows[0]);
      } else {
        const result = await pool.query(`
          INSERT INTO restaurant (name, description, address, email, phone, opening_time, closing_time, cuisine_type, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
          RETURNING id, name
        `, [r.name, r.description, r.location, r.name.toLowerCase().replace(/ /g, '') + '@test.com', '555-0000', '11:00', '22:00', r.cuisine]);
        createdRestaurants.push(result.rows[0]);
        console.log('  - Created: ' + r.name + ' (ID: ' + result.rows[0].id + ')');
      }
    }

    // Create a map of restaurant name to ID
    const restaurantMap = {};
    createdRestaurants.forEach(function(r) { restaurantMap[r.name] = r.id; });

    // ==================== RESTAURANT TABLES ====================
    console.log('\n2. Creating restaurant tables...');
    
    let tableCount = 0;
    for (const r of createdRestaurants) {
      // Delete existing tables for this restaurant
      await pool.query('DELETE FROM restaurant_table WHERE restaurant_id = $1', [r.id]);
      await pool.query('DELETE FROM "table" WHERE restaurant_id = $1', [r.id]);
      
      const tables = [
        { table_number: 1, capacity: 2, location: 'Window' },
        { table_number: 2, capacity: 2, location: 'Window' },
        { table_number: 3, capacity: 2, location: 'Window' },
        { table_number: 4, capacity: 4, location: 'Main Hall' },
        { table_number: 5, capacity: 4, location: 'Main Hall' },
        { table_number: 6, capacity: 4, location: 'Main Hall' },
        { table_number: 7, capacity: 6, location: 'Private Room' },
        { table_number: 8, capacity: 6, location: 'Private Room' },
        { table_number: 9, capacity: 8, location: 'VIP Room' },
        { table_number: 10, capacity: 8, location: 'VIP Room' }
      ];
      
      for (const t of tables) {
        await pool.query(`
          INSERT INTO restaurant_table (restaurant_id, table_number, capacity, location, is_available)
          VALUES ($1, $2, $3, $4, true)
        `, [r.id, t.table_number, t.capacity, t.location]);
        tableCount++;
      }
      console.log('  - ' + r.name + ': 10 tables created');
    }

    // Also add to the "table" table for foreign key
    const rtResult = await pool.query('SELECT id, restaurant_id, table_number, capacity, location, is_available FROM restaurant_table');
    for (const t of rtResult.rows) {
      await pool.query(`
        INSERT INTO "table" (id, restaurant_id, table_number, capacity, location, is_available)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          restaurant_id = EXCLUDED.restaurant_id,
          table_number = EXCLUDED.table_number,
          capacity = EXCLUDED.capacity,
          location = EXCLUDED.location,
          is_available = EXCLUDED.is_available
      `, [t.id, t.restaurant_id, String(t.table_number), t.capacity, t.location, t.is_available !== false]);
    }
    console.log('  - Synced ' + rtResult.rows.length + ' tables to "table" table');

    // ==================== STAFF ====================
    console.log('\n3. Creating staff accounts...');
    
    const staffMembers = [
      { email: 'staff@sushi.com', password: 'staff123', name: 'Staff Lee', role: 'staff', restaurant_id: restaurantMap['Sushi Palace'] },
      { email: 'staff@pasta.com', password: 'staff123', name: 'Staff Zhang', role: 'staff', restaurant_id: restaurantMap['Pasta Paradise'] },
      { email: 'staff@curry.com', password: 'staff123', name: 'Staff Kumar', role: 'staff', restaurant_id: restaurantMap['Curry House'] },
      { email: 'staff@spice.com', password: 'staff123', name: 'Staff Wang', role: 'staff', restaurant_id: restaurantMap['Spice Garden'] },
      { email: 'staff@sakura.com', password: 'staff123', name: 'Staff Tanaka', role: 'staff', restaurant_id: restaurantMap['Sakura Japanese Restaurant'] },
      { email: 'admin@restaurant.com', password: 'admin123', name: 'Admin User', role: 'admin', restaurant_id: null },
    ];

    for (const s of staffMembers) {
      const hashedPassword = await bcrypt.hash(s.password, 10);
      const nameParts = s.name.split(' ');
      await pool.query(`
        INSERT INTO staff (email, password, name, role, restaurant_id, first_name, last_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (email) DO UPDATE SET
          password = EXCLUDED.password,
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          restaurant_id = EXCLUDED.restaurant_id
      `, [s.email, hashedPassword, s.name, s.role, s.restaurant_id, nameParts[0], nameParts.slice(1).join(' ')]);
      console.log('  - Created: ' + s.email + ' (' + s.role + ')');
    }

    // ==================== MENU CATEGORIES & ITEMS ====================
    console.log('\n4. Creating menu categories and items...');
    
    const menuData = [
      { restaurant_id: restaurantMap['Sushi Palace'], categories: [
        { name: 'Appetizers', items: [
          { name: 'Edamame', description: 'Steamed soybeans with salt', price: 5.99 },
          { name: 'Gyoza', description: 'Japanese dumplings', price: 8.99 },
          { name: 'Tempura', description: 'Light battered fried vegetables', price: 10.99 }
        ]},
        { name: 'Sushi Rolls', items: [
          { name: 'California Roll', description: 'Crab, avocado, cucumber', price: 12.99 },
          { name: 'Spicy Tuna Roll', description: 'Fresh tuna with spicy mayo', price: 14.99 },
          { name: 'Dragon Roll', description: 'Eel, avocado, cucumber', price: 16.99 }
        ]},
        { name: 'Sashimi', items: [
          { name: 'Salmon Sashimi', description: '8 pieces of fresh salmon', price: 18.99 },
          { name: 'Tuna Sashimi', description: '8 pieces of fresh tuna', price: 20.99 },
          { name: 'Mixed Sashimi', description: '12 pieces assorted', price: 28.99 }
        ]}
      ]},
      { restaurant_id: restaurantMap['Pasta Paradise'], categories: [
        { name: 'Appetizers', items: [
          { name: 'Bruschetta', description: 'Tomato basil on toast', price: 7.99 },
          { name: 'Calamari', description: 'Crispy fried squid', price: 11.99 },
          { name: 'Caprese', description: 'Fresh mozzarella, tomato, basil', price: 10.99 }
        ]},
        { name: 'Pasta', items: [
          { name: 'Spaghetti Carbonara', description: 'Creamy egg and bacon sauce', price: 15.99 },
          { name: 'Fettuccine Alfredo', description: 'Creamy parmesan sauce', price: 14.99 },
          { name: 'Penne Arrabbiata', description: 'Spicy tomato garlic sauce', price: 13.99 },
          { name: 'Lobster Ravioli', description: 'Homemade ravioli with lobster', price: 24.99 }
        ]},
        { name: 'Pizza', items: [
          { name: 'Margherita', description: 'Tomato, mozzarella, basil', price: 14.99 },
          { name: 'Pepperoni Pizza', description: 'Classic pepperoni and cheese', price: 16.99 },
          { name: 'Quattro Formaggi', description: 'Four cheese pizza', price: 18.99 }
        ]}
      ]},
      { restaurant_id: restaurantMap['Curry House'], categories: [
        { name: 'Appetizers', items: [
          { name: 'Samosa', description: 'Crispy pastry with spiced potatoes', price: 5.99 },
          { name: 'Pakora', description: 'Mixed vegetable fritters', price: 6.99 },
          { name: 'Pani Puri', description: 'Crispy shells with tangy water', price: 7.99 }
        ]},
        { name: 'Curries', items: [
          { name: 'Butter Chicken', description: 'Creamy tomato curry', price: 14.99 },
          { name: 'Palak Paneer', description: 'Spinach with cottage cheese', price: 13.99 },
          { name: 'Chicken Tikka Masala', description: 'Spicy grilled chicken curry', price: 15.99 },
          { name: 'Lamb Rogan Josh', description: 'Aromatic lamb curry', price: 17.99 }
        ]},
        { name: 'Biryani', items: [
          { name: 'Chicken Biryani', description: 'Fragrant rice with chicken', price: 16.99 },
          { name: 'Vegetable Biryani', description: 'Mixed vegetable rice dish', price: 13.99 }
        ]}
      ]},
      { restaurant_id: restaurantMap['Spice Garden'], categories: [
        { name: 'Appetizers', items: [
          { name: 'Spring Rolls', description: 'Crispy vegetable rolls', price: 5.99 },
          { name: 'Wonton Soup', description: 'Shrimp dumplings in broth', price: 6.99 },
          { name: 'Hot and Sour Soup', description: 'Spicy and tangy soup', price: 6.99 }
        ]},
        { name: 'Main Course', items: [
          { name: 'Kung Pao Chicken', description: 'Peanuts and chicken stir fry', price: 14.99 },
          { name: 'Beef Broccoli', description: 'Tender beef with broccoli', price: 16.99 },
          { name: 'Mapo Tofu', description: 'Spicy tofu with minced pork', price: 12.99 },
          { name: 'Peking Duck', description: 'Crispy duck with pancakes', price: 28.99 }
        ]},
        { name: 'Noodles', items: [
          { name: 'Chow Mein', description: 'Stir fried noodles', price: 11.99 },
          { name: 'Dan Dan Noodles', description: 'Spicy sesame noodles', price: 10.99 }
        ]}
      ]},
      { restaurant_id: restaurantMap['Sakura Japanese Restaurant'], categories: [
        { name: 'Sashimi', items: [
          { name: 'Salmon Sashimi', description: '8 pieces of fresh salmon', price: 18.99 },
          { name: 'Tuna Sashimi', description: '8 pieces of fresh tuna', price: 20.99 },
          { name: 'Premium Sashimi', description: '15 pieces assorted', price: 38.99 }
        ]},
        { name: 'Nigiri', items: [
          { name: 'Salmon Nigiri', description: '2 pieces salmon on rice', price: 6.99 },
          { name: 'Tuna Nigiri', description: '2 pieces tuna on rice', price: 7.99 },
          { name: 'Ebi Nigiri', description: '2 pieces shrimp on rice', price: 6.99 }
        ]},
        { name: 'Tempura', items: [
          { name: 'Shrimp Tempura', description: '4 pieces battered shrimp', price: 14.99 },
          { name: 'Mixed Tempura', description: 'Shrimp and vegetables', price: 13.99 }
        ]}
      ]}
    ];

    for (const r of menuData) {
      for (const cat of r.categories) {
        // Delete existing menu items and categories first
        await pool.query('DELETE FROM menu_item WHERE category_id IN (SELECT id FROM menu_category WHERE restaurant_id = $1 AND category_name = $2)', [r.restaurant_id, cat.name]);
        await pool.query('DELETE FROM menu_category WHERE restaurant_id = $1 AND category_name = $2', [r.restaurant_id, cat.name]);
        
        // Insert category
        const catResult = await pool.query(`
          INSERT INTO menu_category (restaurant_id, category_name, description)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [r.restaurant_id, cat.name, cat.name + ' - ' + r.restaurant_id]);
        const categoryId = catResult.rows[0].id;
        
        // Insert items
        for (const item of cat.items) {
          await pool.query(`
            INSERT INTO menu_item (category_id, item_name, description, price)
            VALUES ($1, $2, $3, $4)
          `, [categoryId, item.name, item.description, item.price]);
        }
      }
      console.log('  - Restaurant ID ' + r.restaurant_id + ': Menu created');
    }

    // ==================== SUMMARY ====================
    console.log('\n=== Database Seeded Successfully ===\n');
    console.log('Summary:');
    console.log('- Restaurants: ' + createdRestaurants.length);
    console.log('- Tables: ' + tableCount);
    console.log('- Staff accounts: ' + staffMembers.length);
    console.log('- Menu categories and items created for all restaurants');
    
    console.log('\nDemo Accounts:');
    console.log('Staff: staff@sushi.com / staff123 (Sushi Palace)');
    console.log('Staff: staff@pasta.com / staff123 (Pasta Paradise)');
    console.log('Staff: staff@curry.com / staff123 (Curry House)');
    console.log('Staff: staff@spice.com / staff123 (Spice Garden)');
    console.log('Staff: staff@sakura.com / staff123 (Sakura Japanese)');
    console.log('Admin: admin@restaurant.com / admin123');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

seedAll();
