import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

dotenv.config()
const app = express()
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET

// Note: __dirname is not available in ES modules
// If you need path operations, use fileURLToPath(import.meta.url) workaround

app.use(express.json())
app.use(cors())
// Note: cors() middleware automatically handles OPTIONS preflight requests


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    require: true,
  },
})

async function getPostgresVersion() {
  const client = await pool.connect()
  try {
    const response = await client.query('SELECT version()')
    console.log('✅ Database connected:', response.rows[0].version)
  } finally {
    client.release()
  }
}

getPostgresVersion()

// ============================================
// Middleware: Verify JWT Token
// ============================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' })
    }
    req.user = user
    next()
  })
}

// Middleware: Verify Staff Token
function authenticateStaffToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' })
    }
    if (user.type !== 'staff') {
      return res.status(403).json({ error: 'Staff access required' })
    }
    req.staff = user
    next()
  })
}

// Middleware: Verify Admin Token
function authenticateAdminToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' })
    }
    if (user.type !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    req.admin = user
    next()
  })
}

// ============================================
// AUTH ROUTES
// ============================================

// Register a new customer (from Firebase)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { firebase_uid, first_name, last_name, email, phone } = req.body

    // Check if customer already exists
    const existingUser = await pool.query(
      'SELECT id FROM customer WHERE email = $1',
      [email]
    )

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' })
    }

    // Insert new customer (password handled by Firebase)
    const result = await pool.query(
      `INSERT INTO customer (firebase_uid, first_name, last_name, email, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, phone, created_at`,
      [firebase_uid, first_name, last_name, email, phone || null]
    )

    const customer = result.rows[0]

    // Generate token
    const token = jwt.sign(
      { id: customer.id, email: customer.email, type: 'customer' },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.status(201).json({
      message: 'Registration successful',
      customer: {
        id: customer.id,
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        created_at: customer.created_at
      },
      token
    })
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Sync user from Firebase login
app.post('/api/auth/sync-user', async (req, res) => {
  try {
    const { email, first_name, last_name, phone } = req.body

    // Check if customer exists
    const existingUser = await pool.query(
      'SELECT id FROM customer WHERE email = $1',
      [email]
    )

    if (existingUser.rows.length === 0) {
      // Create new customer if not exists
      await pool.query(
        `INSERT INTO customer (email, first_name, last_name, phone)
         VALUES ($1, $2, $3, $4)`,
        [email, first_name || '', last_name || '', phone || null]
      )
    }

    res.json({ message: 'User synced successfully' })
  } catch (error) {
    console.error('Sync user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Customer login (for JWT-based API calls)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email } = req.body

    // Find customer
    const result = await pool.query(
      'SELECT * FROM customer WHERE email = $1',
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' })
    }

    const customer = result.rows[0]

    // Generate token
    const token = jwt.sign(
      { id: customer.id, email: customer.email, type: 'customer' },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      message: 'Login successful',
      customer: {
        id: customer.id,
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone: customer.phone
      },
      token
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get customer profile
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, first_name, last_name, email, phone, created_at FROM customer WHERE id = $1',
      [req.user.id]
    )

    if (result.rows.length === 0) {
      // Auto-create customer if not exists
      const newCustomer = await pool.query(
        `INSERT INTO customer (id, first_name, last_name, email, phone)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, first_name, last_name, email, phone, created_at`,
        [req.user.id, 'User', '', req.user.email || '', null]
      )
      return res.json(newCustomer.rows[0])
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Profile error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// RESTAURANT ROUTES
// ============================================

// Get all restaurants
app.get('/api/restaurants', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, address, email, phone, 
              opening_time, closing_time, cuisine_type, created_at,
              image_url, max_capacity
       FROM restaurant 
       WHERE is_active = true
       ORDER BY name`
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get restaurants error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get restaurant by ID
app.get('/api/restaurants/:id', async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      `SELECT * FROM restaurant WHERE id = $1 AND is_active = true`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Get restaurant error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get restaurant floor plan (all tables or available for a time slot)
app.get('/api/restaurants/:id/floor-plan', async (req, res) => {
  try {
    const { id } = req.params
    const { date, time } = req.query

    let query = `
      SELECT id, table_number, capacity, is_available, location, created_at
      FROM "table"
      WHERE restaurant_id = $1 AND is_available = true
    `
    const params = [id]

    // If date and time provided, filter out booked tables
    if (date && time) {
      query += `
        AND id NOT IN (
          SELECT table_id FROM reservation 
          WHERE restaurant_id = $1 
            AND reservation_date = $2
            AND status NOT IN ('cancelled', 'no-show')
            AND (
              (reservation_time >= $3 AND reservation_time < $3::time + interval '2 hours')
              OR
              (reservation_time < $3 AND reservation_time + interval '2 hours' > $3)
            )
        )
      `
      params.push(date, time)
    }

    query += ' ORDER BY table_number'

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Get floor plan error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get menu categories for a restaurant (restaurant/:id/categories)
app.get('/api/restaurants/:id/categories', async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      `SELECT mc.*, COUNT(mi.id) as item_count
       FROM menu_category mc
       LEFT JOIN menu_item mi ON mi.category_id = mc.id
       WHERE mc.restaurant_id = $1
       GROUP BY mc.id
       ORDER BY mc.id`,
      [id]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get categories error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get all menu items for a restaurant (restaurant/:id/items)
app.get('/api/restaurants/:id/items', async (req, res) => {
  try {
    const { id } = req.params
    const { category_id } = req.query

    let query = `
      SELECT mi.*, mc.category_name
      FROM menu_item mi
      LEFT JOIN menu_category mc ON mc.id = mi.category_id
      WHERE mi.id IN (
        SELECT id FROM menu_item 
        WHERE category_id IN (
          SELECT id FROM menu_category WHERE restaurant_id = $1
        )
      )
    `
    const params = [id]

    if (category_id) {
      query += ' AND mi.category_id = $2'
      params.push(category_id)
    }

    query += ' ORDER BY mi.category_id, mi.id'

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Get menu items error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// MENU ROUTES
// ============================================

// Get menu categories for a restaurant
app.get('/api/menu/:restaurantId/categories', async (req, res) => {
  try {
    const { restaurantId } = req.params
    const result = await pool.query(
      `SELECT mc.*, COUNT(mi.id) as item_count
       FROM menu_category mc
       LEFT JOIN menu_item mi ON mi.category_id = mc.id
       WHERE mc.restaurant_id = $1
       GROUP BY mc.id
       ORDER BY mc.id`,
      [restaurantId]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get categories error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get all menu items for a restaurant
app.get('/api/menu/:restaurantId/items', async (req, res) => {
  try {
    const { restaurantId } = req.params
    const { category_id } = req.query

    let query = `
      SELECT mi.*, mc.category_name
      FROM menu_item mi
      LEFT JOIN menu_category mc ON mc.id = mi.category_id
      WHERE mi.id IN (
        SELECT id FROM menu_item 
        WHERE category_id IN (
          SELECT id FROM menu_category WHERE restaurant_id = $1
        )
      )
    `
    const params = [restaurantId]

    if (category_id) {
      query += ' AND mi.category_id = $2'
      params.push(category_id)
    }

    query += ' ORDER BY mi.category_id, mi.item_name'

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Get menu items error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// CART ROUTES
// ============================================

// Get customer cart
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const { restaurant_id } = req.query
    const customer_id = req.user.id

    let cartQuery = `
      SELECT c.*, r.name as restaurant_name
      FROM cart c
      LEFT JOIN restaurant r ON r.id = c.restaurant_id
      WHERE c.customer_id = $1
    `
    const params = [customer_id]

    if (restaurant_id) {
      cartQuery += ' AND c.restaurant_id = $2'
      params.push(restaurant_id)
    }

    const cartResult = await pool.query(cartQuery, params)

    if (cartResult.rows.length === 0) {
      return res.json({ cart: null, items: [] })
    }

    const cart = cartResult.rows[0]

    // Get cart items
    const itemsResult = await pool.query(
      `SELECT ci.*, mi.item_name, mi.price, mi.image_url, mi.description
       FROM cart_item ci
       LEFT JOIN menu_item mi ON mi.id = ci.item_id
       WHERE ci.cart_id = $1`,
      [cart.id]
    )

    res.json({
      cart,
      items: itemsResult.rows
    })
  } catch (error) {
    console.error('Get cart error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Add item to cart
app.post('/api/cart/items', authenticateToken, async (req, res) => {
  try {
    const { restaurant_id, item_id, quantity, special_instruction } = req.body
    const customer_id = req.user.id

    // Find or create cart
    let cartResult = await pool.query(
      'SELECT * FROM cart WHERE customer_id = $1 AND restaurant_id = $2',
      [customer_id, restaurant_id]
    )

    let cart
    if (cartResult.rows.length === 0) {
      const newCart = await pool.query(
        'INSERT INTO cart (customer_id, restaurant_id) VALUES ($1, $2) RETURNING *',
        [customer_id, restaurant_id]
      )
      cart = newCart.rows[0]
    } else {
      cart = cartResult.rows[0]
    }

    // Check if item already in cart
    const existingItem = await pool.query(
      'SELECT * FROM cart_item WHERE cart_id = $1 AND item_id = $2',
      [cart.id, item_id]
    )

    if (existingItem.rows.length > 0) {
      // Update quantity
      await pool.query(
        'UPDATE cart_item SET quantity = quantity + $1, special_instruction = $2 WHERE id = $3',
        [quantity, special_instruction, existingItem.rows[0].id]
      )
    } else {
      // Add new item
      await pool.query(
        'INSERT INTO cart_item (cart_id, item_id, quantity, special_instruction) VALUES ($1, $2, $3, $4)',
        [cart.id, item_id, quantity, special_instruction]
      )
    }

    // Update cart timestamp
    await pool.query('UPDATE cart SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [cart.id])

    res.json({ message: 'Item added to cart', cart_id: cart.id })
  } catch (error) {
    console.error('Add to cart error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update cart item quantity
app.put('/api/cart/items/:id', authenticateToken, async (req, res) => {
  try {
    const { quantity } = req.body
    const { id } = req.params

    await pool.query(
      'UPDATE cart_item SET quantity = $1 WHERE id = $2',
      [quantity, id]
    )

    res.json({ message: 'Cart updated' })
  } catch (error) {
    console.error('Update cart error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Remove item from cart
app.delete('/api/cart/items/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM cart_item WHERE id = $1', [req.params.id])
    res.json({ message: 'Item removed from cart' })
  } catch (error) {
    console.error('Remove cart item error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Clear cart
app.delete('/api/cart', authenticateToken, async (req, res) => {
  try {
    const { cart_id } = req.body
    await pool.query('DELETE FROM cart_item WHERE cart_id = $1', [cart_id])
    res.json({ message: 'Cart cleared' })
  } catch (error) {
    console.error('Clear cart error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// NOTIFICATION HELPER FUNCTIONS
// ============================================

// Create a notification for staff
async function createNotification(pool, { restaurant_id, type, title, message, reservation_id = null }) {
  try {
    const result = await pool.query(
      `INSERT INTO notification (restaurant_id, type, title, message, reservation_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [restaurant_id, type, title, message, reservation_id]
    );
    console.log(`📢 Notification created: ${type} - ${title}`);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
}

// Create a notification for customer
async function createCustomerNotification(pool, { customer_id, type, title, message, reservation_id = null }) {
  try {
    const result = await pool.query(
      `INSERT INTO notification (customer_id, type, title, message, reservation_id, is_read)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
      [customer_id, type, title, message, reservation_id]
    );
    console.log(`📢 Customer notification created: ${type} - ${title}`);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating customer notification:', error);
    return null;
  }
}

// ============================================
// RESERVATION ROUTES
// ============================================

// Create a reservation
app.post('/api/reservations', authenticateToken, async (req, res) => {
  try {
    const { 
      restaurant_id, 
      table_id,  // Single table_id instead of table_ids array
      reservation_date, 
      reservation_time, 
      party_size, 
      special_requests,
      customer_name,
      customer_phone,
      customer_email
    } = req.body
    const customer_id = req.user.id

    if (!restaurant_id || !reservation_date || !reservation_time || !party_size) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Check if table is available for the requested time slot (2 hours)
    if (table_id) {
      const checkAvailability = await pool.query(
        `SELECT id FROM reservation 
         WHERE restaurant_id = $1 
           AND table_id = $2 
           AND reservation_date = $3 
           AND status NOT IN ('cancelled', 'no-show')
           AND (
             -- Check if requested time overlaps with existing reservation (2-hour slots)
             (reservation_time >= $4 AND reservation_time < $4::time + interval '2 hours')
             OR
             (reservation_time < $4 AND reservation_time + interval '2 hours' > $4)
           )`,
        [restaurant_id, table_id, reservation_date, reservation_time]
      )

      if (checkAvailability.rows.length > 0) {
        return res.status(400).json({ error: 'This table is not available for the selected time slot. Please choose a different time or table.' })
      }
    }

    // Get customer info for notification
    const customerResult = await pool.query(
      'SELECT first_name, last_name, email FROM customer WHERE id = $1',
      [customer_id]
    )
    const customer = customerResult.rows[0] || { first_name: 'Guest', last_name: '', email: customer_email }
    const customerName = customer_name || `${customer.first_name} ${customer.last_name}`.trim() || 'Guest'

    // Create reservation
    const result = await pool.query(
      `INSERT INTO reservation 
        (customer_id, restaurant_id, table_id, reservation_date, reservation_time, party_size, special_requests, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [customer_id, restaurant_id, table_id || null, reservation_date, reservation_time, party_size, special_requests]
    )

    const reservation = result.rows[0]

    // Create notification for staff
    await createNotification(pool, {
      restaurant_id,
      type: 'reservation_new',
      title: 'New Reservation',
      message: `${customerName} made a reservation for ${party_size} guest(s) on ${reservation_date} at ${reservation_time}`,
      reservation_id: reservation.id
    })

    res.status(201).json({
      message: 'Reservation created successfully',
      reservation
    })
  } catch (error) {
    console.error('Create reservation error:', error)
    res.status(500).json({ error: 'Internal server error: ' + error.message })
  }
})

// Get customer reservations
app.get('/api/reservations', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, rest.name as restaurant_name
       FROM reservation r
       LEFT JOIN restaurant rest ON rest.id = r.restaurant_id
       WHERE r.customer_id = $1
       ORDER BY r.reservation_date DESC, r.reservation_time DESC`,
      [req.user.id]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get reservations error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update reservation
app.put('/api/reservations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { status, special_requests } = req.body

    const result = await pool.query(
      `UPDATE reservation 
       SET status = COALESCE($1, status), 
           special_requests = COALESCE($2, special_requests)
       WHERE id = $3 AND customer_id = $4
       RETURNING *`,
      [status, special_requests, id, req.user.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' })
    }

    res.json({
      message: 'Reservation updated successfully',
      reservation: result.rows[0]
    })
  } catch (error) {
    console.error('Update reservation error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Request cancellation (customer)
app.post('/api/reservations/:id/request-cancellation', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { reason } = req.body

    // Truncate reason to 500 characters to match database column
    const truncatedReason = reason ? reason.slice(0, 500) : null

    // Get reservation details for notification
    const reservationResult = await pool.query(
      'SELECT r.*, c.first_name, c.last_name FROM reservation r LEFT JOIN customer c ON c.id = r.customer_id WHERE r.id = $1',
      [id]
    )
    const reservation = reservationResult.rows[0]

    // Only allow pending or confirmed reservations to request cancellation
    const result = await pool.query(
      `UPDATE reservation 
       SET status = 'cancellation_requested',
           cancellation_reason = $1
       WHERE id = $2 AND customer_id = $3 AND status IN ('pending', 'confirmed')
       RETURNING *`,
      [truncatedReason, id, req.user.id]
    )

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Reservation cannot be cancelled or not found' })
    }

    // Create notification for staff
    const customerName = reservation ? `${reservation.first_name} ${reservation.last_name}`.trim() : 'A customer'
    await createNotification(pool, {
      restaurant_id: reservation.restaurant_id,
      type: 'cancellation_request',
      title: 'Cancellation Request',
      message: `${customerName} requested to cancel their reservation on ${reservation.reservation_date} at ${reservation.reservation_time}. Reason: ${truncatedReason || 'No reason provided'}`,
      reservation_id: id
    })

    res.json({
      message: 'Cancellation request submitted successfully',
      reservation: result.rows[0]
    })
  } catch (error) {
    console.error('Request cancellation error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// ORDER ROUTES
// ============================================

// Create order
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { cart_id, reservation_id, notes, items, total_amount, restaurant_id: req_restaurant_id } = req.body
    const customer_id = req.user.id

    let cartItems = [];
    let restaurant_id = req_restaurant_id;
    let total = total_amount || 0;

    // Case 1: Get items from database cart
    if (cart_id) {
      const cartItemsResult = await pool.query(
        `SELECT ci.*, mi.price, mi.item_name, mi.id as item_id
         FROM cart_item ci
         LEFT JOIN menu_item mi ON mi.id = ci.item_id
         WHERE ci.cart_id = $1`,
        [cart_id]
      )
      cartItems = cartItemsResult.rows;

      if (cartItems.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' })
      }

      // Get cart to find restaurant
      const cart = await pool.query('SELECT * FROM cart WHERE id = $1', [cart_id])
      restaurant_id = cart.rows[0].restaurant_id

      // Calculate total from database items
      total = cartItems.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0)
    } 
    // Case 2: Get items directly from request body (local cart)
    else if (items && items.length > 0) {
      // If item_id is not provided, look it up by name
      const itemsNeedingLookup = items.filter(item => !item.item_id && !item.id);
      const nameToIdMap = {};
      
      if (itemsNeedingLookup.length > 0) {
        const itemNames = itemsNeedingLookup.map(item => item.item_name || item.name);
        const itemLookupResult = await pool.query(
          `SELECT id, item_name FROM menu_item WHERE item_name = ANY($1)`,
          [itemNames]
        );
        
        itemLookupResult.rows.forEach(row => {
          nameToIdMap[row.item_name] = row.id;
        });
      }
      
      cartItems = items.map(item => ({
        ...item,
        item_id: item.item_id || item.id || nameToIdMap[item.item_name || item.name] || null,
        item_name: item.item_name || item.name,
        special_instruction: item.special_instructions || item.special_instruction
      }));
      
      if (!restaurant_id) {
        return res.status(400).json({ error: 'Restaurant ID is required' })
      }
      
      total = total || cartItems.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0)
    } 
    else {
      return res.status(400).json({ error: 'No items to order' })
    }

    // Create order
    const orderResult = await pool.query(
      `INSERT INTO orders (customer_id, reservation_id, restaurant_id, status, notes, total_amount, payment_status, payment_method)
       VALUES ($1, $2, $3, 'pending', $4, $5, 'unpaid', NULL)
       RETURNING *`,
      [customer_id, reservation_id, restaurant_id, notes, total]
    )

    const order = orderResult.rows[0]

    // Create order items
    for (const item of cartItems) {
      if (!item.item_id) {
        console.warn('Missing item_id for item:', item);
        continue; // Skip items without valid item_id
      }
      const itemTotal = (item.price || 0) * (item.quantity || 0)
      await pool.query(
        `INSERT INTO order_item (order_id, item_id, quantity, unit_price, subtotal, special_instructions)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.item_id, item.quantity, item.price, itemTotal, item.special_instruction]
      )
    }

    // Clear database cart if using cart_id
    if (cart_id) {
      await pool.query('DELETE FROM cart_item WHERE cart_id = $1', [cart_id])
      await pool.query('DELETE FROM cart WHERE id = $1', [cart_id])
    }

    res.status(201).json({
      message: 'Order created successfully',
      order
    })
  } catch (error) {
    console.error('Create order error:', error)
    res.status(500).json({ error: 'Internal server error: ' + error.message })
  }
})

// Get customer orders
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const ordersResult = await pool.query(
      `SELECT o.*, r.name as restaurant_name
       FROM orders o
       LEFT JOIN restaurant r ON r.id = o.restaurant_id
       WHERE o.customer_id = $1
       ORDER BY o.order_date DESC`,
      [req.user.id]
    )

    // Fetch order items for each order
    const orders = await Promise.all(ordersResult.rows.map(async (order) => {
      const itemsResult = await pool.query(
        `SELECT oi.*, mi.item_name
         FROM order_item oi
         LEFT JOIN menu_item mi ON mi.id = oi.item_id
         WHERE oi.order_id = $1`,
        [order.id]
      )
      return {
        ...order,
        items: itemsResult.rows
      }
    }))

    res.json(orders)
  } catch (error) {
    console.error('Get orders error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get order details
app.get('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    const orderResult = await pool.query(
      `SELECT o.*, r.name as restaurant_name, r.address as restaurant_address
       FROM orders o
       LEFT JOIN restaurant r ON r.id = o.restaurant_id
       WHERE o.id = $1 AND o.customer_id = $2`,
      [id, req.user.id]
    )

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    const order = orderResult.rows[0]

    const itemsResult = await pool.query(
      `SELECT oi.*, mi.item_name, mi.description
       FROM order_item oi
       LEFT JOIN menu_item mi ON mi.id = oi.item_id
       WHERE oi.order_id = $1`,
      [id]
    )

    res.json({
      order,
      items: itemsResult.rows
    })
  } catch (error) {
    console.error('Get order details error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// HOME
// ============================================
// Root route - API documentation
app.get('/', (req, res) => {
  const htmlDoc = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TempahNow API Documentation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8f9fa;
      color: #333;
      line-height: 1.6;
      padding: 40px 20px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 50px;
    }
    h1 {
      font-size: 2.5rem;
      color: #2c3e50;
      margin-bottom: 10px;
    }
    .subtitle { color: #6c757d; font-size: 1.1rem; }
    .version {
      display: inline-block;
      background: #3498db;
      color: white;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85rem;
      margin-top: 15px;
    }
    .section {
      background: white;
      border-radius: 12px;
      padding: 25px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .section h2 {
      font-size: 1.3rem;
      color: #2c3e50;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #f1f3f4;
    }
    .endpoint {
      display: block;
      padding: 12px 15px;
      background: #f8f9fa;
      border-radius: 8px;
      margin-bottom: 10px;
      text-decoration: none;
      color: #333;
      transition: all 0.2s ease;
    }
    .endpoint:hover {
      background: #e9ecef;
      transform: translateX(5px);
    }
    .method {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-right: 10px;
    }
    .method.GET { background: #d4edda; color: #155724; }
    .method.POST { background: #cce5ff; color: #004085; }
    .method.PUT { background: #fff3cd; color: #856404; }
    .method.DELETE { background: #f8d7da; color: #721c24; }
    .path { font-family: 'Monaco', 'Consolas', monospace; color: #495057; }
    .tag {
      display: inline-block;
      padding: 2px 8px;
      background: #e9ecef;
      border-radius: 4px;
      font-size: 0.8rem;
      color: #6c757d;
      margin-right: 8px;
    }
    footer {
      text-align: center;
      margin-top: 40px;
      color: #6c757d;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🍽️ TempahNow API</h1>
      <p class="subtitle">Restaurant Reservation System API Documentation</p>
      <span class="version">v1.0.0</span>
    </header>

    <div class="section">
      <h2>🔐 Authentication</h2>
      <a href="#auth" class="endpoint"><span class="method POST">POST</span><span class="path">/api/auth/register</span></a>
      <a href="#auth" class="endpoint"><span class="method POST">POST</span><span class="path">/api/auth/login</span></a>
      <a href="#auth" class="endpoint"><span class="method POST">POST</span><span class="path">/api/auth/sync-user</span></a>
    </div>

    <div class="section">
      <h2>🏪 Restaurants</h2>
      <a href="#restaurants" class="endpoint"><span class="method GET">GET</span><span class="path">/api/restaurants</span></a>
      <a href="#restaurants" class="endpoint"><span class="method GET">GET</span><span class="path">/api/restaurants/:id</span></a>
      <a href="#restaurants" class="endpoint"><span class="method GET">GET</span><span class="path">/api/restaurants/:id/menu</span></a>
      <a href="#restaurants" class="endpoint"><span class="method GET">GET</span><span class="path">/api/restaurants/:id/tables</span></a>
    </div>

    <div class="section">
      <h2>📅 Reservations</h2>
      <a href="#reservations" class="endpoint"><span class="method GET">GET</span><span class="path">/api/reservations</span></a>
      <a href="#reservations" class="endpoint"><span class="method POST">POST</span><span class="path">/api/reservations</span></a>
      <a href="#reservations" class="endpoint"><span class="method GET">GET</span><span class="path">/api/reservations/:id</span></a>
      <a href="#reservations" class="endpoint"><span class="method PUT">PUT</span><span class="path">/api/reservations/:id</span></a>
      <a href="#reservations" class="endpoint"><span class="method DELETE">DELETE</span><span class="path">/api/reservations/:id</span></a>
    </div>

    <div class="section">
      <h2>📋 Menu</h2>
      <a href="#menu" class="endpoint"><span class="method GET">GET</span><span class="path">/api/menu/categories/:restaurantId</span></a>
      <a href="#menu" class="endpoint"><span class="method GET">GET</span><span class="path">/api/menu/items/:restaurantId</span></a>
    </div>

    <div class="section">
      <h2>🛒 Orders</h2>
      <a href="#orders" class="endpoint"><span class="method GET">GET</span><span class="path">/api/orders/:reservationId</span></a>
      <a href="#orders" class="endpoint"><span class="method POST">POST</span><span class="path">/api/orders</span></a>
      <a href="#orders" class="endpoint"><span class="method PUT">PUT</span><span class="path">/api/orders/:id</span></a>
    </div>

    <div class="section">
      <h2>🪑 Tables</h2>
      <a href="#tables" class="endpoint"><span class="method GET">GET</span><span class="path">/api/tables/availability</span></a>
    </div>

    <div class="section">
      <h2>🔔 Notifications</h2>
      <a href="#notifications" class="endpoint"><span class="method GET">GET</span><span class="path">/api/notifications</span></a>
    </div>

    <div class="section">
      <h2>👨‍💼 Admin</h2>
      <a href="#admin" class="endpoint"><span class="method POST">POST</span><span class="path">/api/admin/login</span></a>
      <a href="#admin" class="endpoint"><span class="method GET">GET</span><span class="path">/api/admin/stats</span></a>
      <a href="#admin" class="endpoint"><span class="method GET">GET</span><span class="path">/api/admin/restaurants</span></a>
      <a href="#admin" class="endpoint"><span class="method POST">POST</span><span class="path">/api/admin/restaurants</span></a>
      <a href="#admin" class="endpoint"><span class="method GET">GET</span><span class="path">/api/admin/reservations</span></a>
      <a href="#admin" class="endpoint"><span class="method GET">GET</span><span class="path">/api/admin/orders</span></a>
      <a href="#admin" class="endpoint"><span class="method GET">GET</span><span class="path">/api/admin/staff</span></a>
      <a href="#admin" class="endpoint"><span class="method POST">POST</span><span class="path">/api/admin/staff</span></a>
    </div>

    <div class="section">
      <h2>👨‍🍳 Staff</h2>
      <a href="#staff" class="endpoint"><span class="method POST">POST</span><span class="path">/api/staff/login</span></a>
      <a href="#staff" class="endpoint"><span class="method GET">GET</span><span class="path">/api/staff/dashboard</span></a>
      <a href="#staff" class="endpoint"><span class="method GET">GET</span><span class="path">/api/staff/reservations</span></a>
      <a href="#staff" class="endpoint"><span class="method PUT">PUT</span><span class="path">/api/staff/reservations/:id</span></a>
      <a href="#staff" class="endpoint"><span class="method GET">GET</span><span class="path">/api/staff/orders</span></a>
      <a href="#staff" class="endpoint"><span class="method PUT">PUT</span><span class="path">/api/staff/orders/:id</span></a>
      <a href="#staff" class="endpoint"><span class="method GET">GET</span><span class="path">/api/staff/tables</span></a>
      <a href="#staff" class="endpoint"><span class="method POST">POST</span><span class="path">/api/staff/tables</span></a>
      <a href="#staff" class="endpoint"><span class="method GET">GET</span><span class="path">/api/staff/menu/categories</span></a>
      <a href="#staff" class="endpoint"><span class="method POST">POST</span><span class="path">/api/staff/menu/categories</span></a>
      <a href="#staff" class="endpoint"><span class="method POST">POST</span><span class="path">/api/staff/menu/items</span></a>
    </div>
    <footer>
      <p>TempahNow Restaurant Reservation System API v1.0.0</p>
      <p>Built with Express.js & PostgreSQL</p>
    </footer>
  </div>
</body>
</html>
`
  res.type('html').send(htmlDoc)
})

// ============================================
// PAYMENT ROUTES
// ============================================

// Create payment record
app.post('/api/payments', authenticateToken, async (req, res) => {
  try {
    const { order_id, amount, payment_method, payment_status, transaction_id, notes } = req.body
    const customer_id = req.user.id

    const result = await pool.query(
      `INSERT INTO payment (customer_id, order_id, amount, payment_method, payment_status, transaction_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [customer_id, order_id, amount, payment_method || 'online', payment_status || 'pending', transaction_id, notes]
    )

    res.status(201).json({
      message: 'Payment recorded successfully',
      payment: result.rows[0]
    })
  } catch (error) {
    console.error('Create payment error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get customer payments
app.get('/api/payments', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, o.restaurant_id, r.name as restaurant_name
       FROM payment p
       LEFT JOIN orders o ON o.id = p.order_id
       LEFT JOIN restaurant r ON r.id = o.restaurant_id
       WHERE p.customer_id = $1
       ORDER BY p.created_at DESC`,
      [req.user.id]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get payments error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// STAFF ROUTES
// ============================================

// Staff login
app.post('/api/staff/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    // Find staff member
    const result = await pool.query(
      'SELECT * FROM staff WHERE email = $1',
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const staff = result.rows[0]

    // Verify password
    const isValidPassword = await bcrypt.compare(password, staff.password)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    // Generate token
    const token = jwt.sign(
      { id: staff.id, email: staff.email, type: 'staff', restaurant_id: staff.restaurant_id, role: staff.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      message: 'Login successful',
      token,
      staff: {
        id: staff.id,
        email: staff.email,
        first_name: staff.first_name,
        last_name: staff.last_name,
        name: staff.name,
        role: staff.role,
        restaurant_id: staff.restaurant_id
      }
    })
  } catch (error) {
    console.error('Staff login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get staff orders
app.get('/api/staff/orders', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const result = await pool.query(
      `SELECT o.*, r.name as restaurant_name, c.first_name || ' ' || c.last_name as customer_name
       FROM orders o
       LEFT JOIN restaurant r ON r.id = o.restaurant_id
       LEFT JOIN customer c ON c.id = o.customer_id
       WHERE o.restaurant_id = $1
       ORDER BY o.order_date DESC`,
      [restaurant_id]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get staff orders error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get staff reservations
app.get('/api/staff/reservations', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff

    // Get reservations
    const result = await pool.query(
      `SELECT r.*, rest.name as restaurant_name,
              c.first_name || ' ' || c.last_name as customer_name,
              c.email as customer_email,
              c.phone as customer_phone,
              -- Get payment info from the first order (if exists)
              (SELECT o.payment_status FROM orders o WHERE o.reservation_id = r.id ORDER BY o.id LIMIT 1) as payment_status,
              (SELECT o.payment_method FROM orders o WHERE o.reservation_id = r.id ORDER BY o.id LIMIT 1) as payment_method
       FROM reservation r
       LEFT JOIN restaurant rest ON rest.id = r.restaurant_id
       LEFT JOIN customer c ON c.id = r.customer_id
       WHERE r.restaurant_id = $1
       ORDER BY r.reservation_date DESC, r.reservation_time DESC`,
      [restaurant_id]
    )

    const reservations = result.rows

    // Get all orders for these reservations
    const reservationIds = reservations.map(r => r.id)
    let ordersWithItems = {}

    if (reservationIds.length > 0) {
      const ordersResult = await pool.query(
        `SELECT o.*,
                json_agg(
                  json_build_object(
                    'item_name', mi.item_name,
                    'quantity', oi.quantity,
                    'unit_price', oi.unit_price,
                    'subtotal', oi.subtotal,
                    'special_instructions', oi.special_instructions
                  )
                ) FILTER (WHERE oi.id IS NOT NULL) as items
         FROM orders o
         LEFT JOIN order_item oi ON oi.order_id = o.id
         LEFT JOIN menu_item mi ON mi.id = oi.item_id
         WHERE o.reservation_id = ANY($1)
         GROUP BY o.id`,
        [reservationIds]
      )

      // Group orders by reservation_id
      ordersResult.rows.forEach(order => {
        const resId = order.reservation_id
        if (!ordersWithItems[resId]) {
          ordersWithItems[resId] = []
        }
        ordersWithItems[resId].push(order)
      })
    }

    // Attach orders to each reservation
    const reservationsWithOrders = reservations.map(res => ({
      ...res,
      orders: ordersWithItems[res.id] || []
    }))

    res.json(reservationsWithOrders)
  } catch (error) {
    console.error('Get staff reservations error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update order status
app.put('/api/staff/orders/:id/status', authenticateStaffToken, async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body
    const { restaurant_id } = req.staff

    const result = await pool.query(
      `UPDATE orders 
       SET status = $1 
       WHERE id = $2 AND restaurant_id = $3
       RETURNING *`,
      [status, id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' })
    }

    res.json({
      message: 'Order status updated',
      order: result.rows[0]
    })
  } catch (error) {
    console.error('Update order status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update reservation status
app.put('/api/staff/reservations/:id/status', authenticateStaffToken, async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body
    const { restaurant_id } = req.staff

    console.log(`📋 Staff updating reservation ${id} to status: ${status}`);

    // Get reservation details first
    const reservationResult = await pool.query(
      'SELECT r.*, rest.name as restaurant_name FROM reservation r LEFT JOIN restaurant rest ON r.restaurant_id = rest.id WHERE r.id = $1 AND r.restaurant_id = $2',
      [id, restaurant_id]
    )

    if (reservationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' })
    }

    const reservation = reservationResult.rows[0]
    console.log(`📋 Reservation data:`, reservation);

    if (!reservation.customer_id) {
      console.error('❌ ERROR: Reservation has no customer_id!');
    }

    const result = await pool.query(
      `UPDATE reservation 
       SET status = $1 
       WHERE id = $2 AND restaurant_id = $3
       RETURNING *`,
      [status, id, restaurant_id]
    )

    // Send notification to customer when reservation is confirmed
    if (status === 'confirmed' && reservation.customer_id) {
      try {
        const notifResult = await pool.query(
          `INSERT INTO notification (restaurant_id, customer_id, type, title, message, reservation_id, is_read)
           VALUES (NULL, $1, $2, $3, $4, $5, FALSE)
           RETURNING *`,
          [
            reservation.customer_id,
            'reservation_confirmed',
            'Reservation Confirmed',
            `Your reservation at ${reservation.restaurant_name || 'the restaurant'} on ${reservation.reservation_date} at ${reservation.reservation_time} has been confirmed!`,
            id
          ]
        );
        console.log(`✅ Notification created: ID ${notifResult.rows[0].id}`);
      } catch (notifError) {
        console.error(`❌ Failed to create notification:`, notifError.message);
      }
    }

    res.json({
      message: 'Reservation status updated',
      reservation: result.rows[0]
    })
  } catch (error) {
    console.error('Update reservation status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Approve cancellation request (staff)
app.post('/api/staff/reservations/:id/approve-cancellation', authenticateStaffToken, async (req, res) => {
  try {
    const { id } = req.params
    const { restaurant_id } = req.staff

    // Get reservation details first for notification
    const reservationResult = await pool.query(
      `SELECT r.*, rest.name as restaurant_name, c.email as customer_email
       FROM reservation r
       LEFT JOIN restaurant rest ON r.restaurant_id = rest.id
       LEFT JOIN customer c ON c.id = r.customer_id
       WHERE r.id = $1 AND r.restaurant_id = $2`,
      [id, restaurant_id]
    )

    if (reservationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' })
    }

    const reservation = reservationResult.rows[0]

    const result = await pool.query(
      `UPDATE reservation 
       SET status = 'cancelled',
           cancellation_reason = NULL
       WHERE id = $1 AND restaurant_id = $2 AND status = 'cancellation_requested'
       RETURNING *`,
      [id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cancellation request not found or already processed' })
    }

    // Send notification to customer about approved cancellation
    if (reservation.customer_id) {
      await createCustomerNotification(pool, {
        customer_id: reservation.customer_id,
        type: 'cancellation_approved',
        title: 'Cancellation Approved',
        message: `Your reservation at ${reservation.restaurant_name || 'the restaurant'} on ${reservation.reservation_date} at ${reservation.reservation_time} has been cancelled as requested.`,
        reservation_id: id
      })
    }

    res.json({
      message: 'Cancellation approved',
      reservation: result.rows[0]
    })
  } catch (error) {
    console.error('Approve cancellation error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Reject cancellation request (staff)
app.post('/api/staff/reservations/:id/reject-cancellation', authenticateStaffToken, async (req, res) => {
  try {
    const { id } = req.params
    const { restaurant_id } = req.staff

    // Get reservation details first for notification
    const reservationResult = await pool.query(
      `SELECT r.*, rest.name as restaurant_name, c.email as customer_email
       FROM reservation r
       LEFT JOIN restaurant rest ON r.restaurant_id = rest.id
       LEFT JOIN customer c ON c.id = r.customer_id
       WHERE r.id = $1 AND r.restaurant_id = $2`,
      [id, restaurant_id]
    )

    if (reservationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' })
    }

    const reservation = reservationResult.rows[0]

    const result = await pool.query(
      `UPDATE reservation 
       SET status = 'confirmed',
           cancellation_reason = NULL
       WHERE id = $1 AND restaurant_id = $2 AND status = 'cancellation_requested'
       RETURNING *`,
      [id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cancellation request not found or already processed' })
    }

    // Send notification to customer about rejected cancellation
    if (reservation.customer_id) {
      await createCustomerNotification(pool, {
        customer_id: reservation.customer_id,
        type: 'cancellation_rejected',
        title: 'Cancellation Request Rejected',
        message: `Your cancellation request for your reservation at ${reservation.restaurant_name || 'the restaurant'} on ${reservation.reservation_date} at ${reservation.reservation_time} has been rejected. Your reservation remains confirmed.`,
        reservation_id: id
      })
    }

    res.json({
      message: 'Cancellation rejected, reservation confirmed',
      reservation: result.rows[0]
    })
  } catch (error) {
    console.error('Reject cancellation error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get staff stats
app.get('/api/staff/stats', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff

    const [ordersResult, reservationsResult, revenueResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) as total, 
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'completed') as completed
         FROM orders 
         WHERE restaurant_id = $1`,
        [restaurant_id]
      ),
      pool.query(
        `SELECT COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed
         FROM reservation 
         WHERE restaurant_id = $1`,
        [restaurant_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_amount), 0) as total_revenue
         FROM orders 
         WHERE restaurant_id = $1 AND status = 'completed'`,
        [restaurant_id]
      )
    ])

    res.json({
      orders: ordersResult.rows[0],
      reservations: reservationsResult.rows[0],
      revenue: revenueResult.rows[0].total_revenue
    })
  } catch (error) {
    console.error('Get staff stats error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// NOTIFICATION ROUTES (Staff)
// ============================================

// Get notifications for staff
app.get('/api/staff/notifications', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { unread_only } = req.query

    let query = `
      SELECT n.*, r.reservation_date, r.reservation_time, r.party_size,
             c.first_name || ' ' || c.last_name as customer_name
      FROM notification n
      LEFT JOIN reservation r ON r.id = n.reservation_id
      LEFT JOIN customer c ON c.id = r.customer_id
      WHERE n.restaurant_id = $1
    `
    const params = [restaurant_id]

    if (unread_only === 'true') {
      query += ' AND n.is_read = false'
    }

    query += ' ORDER BY n.created_at DESC LIMIT 50'

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Get notifications error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get unread notification count
app.get('/api/staff/notifications/count', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff

    const result = await pool.query(
      'SELECT COUNT(*) as count FROM notification WHERE restaurant_id = $1 AND is_read = false',
      [restaurant_id]
    )

    res.json({ count: parseInt(result.rows[0].count) })
  } catch (error) {
    console.error('Get notification count error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Mark notification as read
app.put('/api/staff/notifications/:id/read', authenticateStaffToken, async (req, res) => {
  try {
    const { id } = req.params
    const { restaurant_id } = req.staff

    const result = await pool.query(
      `UPDATE notification SET is_read = true WHERE id = $1 AND restaurant_id = $2 RETURNING *`,
      [id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' })
    }

    res.json({ message: 'Notification marked as read', notification: result.rows[0] })
  } catch (error) {
    console.error('Mark notification read error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Mark all notifications as read
app.put('/api/staff/notifications/read-all', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff

    await pool.query(
      'UPDATE notification SET is_read = true WHERE restaurant_id = $1',
      [restaurant_id]
    )

    res.json({ message: 'All notifications marked as read' })
  } catch (error) {
    console.error('Mark all notifications read error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete a notification
app.delete('/api/staff/notifications/:id', authenticateStaffToken, async (req, res) => {
  try {
    const { id } = req.params
    const { restaurant_id } = req.staff

    const result = await pool.query(
      'DELETE FROM notification WHERE id = $1 AND restaurant_id = $2 RETURNING *',
      [id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' })
    }

    res.json({ message: 'Notification deleted' })
  } catch (error) {
    console.error('Delete notification error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// STAFF MENU MANAGEMENT ROUTES
// ============================================

// Add menu category
app.post('/api/staff/menu/categories', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { name, description, display_order } = req.body

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' })
    }

    const result = await pool.query(
      `INSERT INTO menu_category (restaurant_id, category_name, description, display_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [restaurant_id, name.trim(), description || null, display_order || 0]
    )

    res.status(201).json({
      message: 'Menu category created successfully',
      category: result.rows[0]
    })
  } catch (error) {
    console.error('Add menu category error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get menu categories for staff's restaurant
app.get('/api/staff/menu/categories', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff

    const result = await pool.query(
      `SELECT mc.*, COUNT(mi.id) as item_count
       FROM menu_category mc
       LEFT JOIN menu_item mi ON mi.category_id = mc.id
       WHERE mc.restaurant_id = $1
       GROUP BY mc.id
       ORDER BY mc.display_order, mc.category_name`,
      [restaurant_id]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get menu categories error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Add menu item
app.post('/api/staff/menu/items', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { category_id, name, description, price, image_url, is_available, preparation_time } = req.body

    if (!category_id) {
      return res.status(400).json({ error: 'Please select a category' })
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Item name is required' })
    }

    if (price === undefined || price === null || price < 0) {
      return res.status(400).json({ error: 'Valid price is required' })
    }

    // Verify category belongs to this restaurant
    const categoryCheck = await pool.query(
      'SELECT id FROM menu_category WHERE id = $1 AND restaurant_id = $2',
      [category_id, restaurant_id]
    )

    if (categoryCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid category' })
    }

    const result = await pool.query(
      `INSERT INTO menu_item (category_id, item_name, description, price, image_url, is_available)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        category_id,
        name.trim(),
        description || null,
        price,
        image_url || null,
        is_available !== false
      ]
    )

    res.status(201).json({
      message: 'Menu item created successfully',
      item: result.rows[0]
    })
  } catch (error) {
    console.error('Add menu item error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get menu items for staff's restaurant
app.get('/api/staff/menu/items', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff

    const result = await pool.query(
      `SELECT mi.*, mc.category_name as category_name
       FROM menu_item mi
       LEFT JOIN menu_category mc ON mc.id = mi.category_id
       WHERE mc.restaurant_id = $1
       ORDER BY mc.category_name, mi.item_name`,
      [restaurant_id]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get menu items error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update menu item
app.put('/api/staff/menu/items/:id', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { id } = req.params
    const { category_id, name, description, price, image_url, is_available, preparation_time } = req.body

    // Verify menu item belongs to this restaurant
    const itemCheck = await pool.query(
      `SELECT id FROM menu_item 
       WHERE id = $1 AND category_id IN (SELECT id FROM menu_category WHERE restaurant_id = $2)`,
      [id, restaurant_id]
    )

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Menu item not found' })
    }

    const result = await pool.query(
      `UPDATE menu_item
       SET category_id = COALESCE($1, category_id),
           item_name = COALESCE($2, item_name),
           description = COALESCE($3, description),
           price = COALESCE($4, price),
           image_url = COALESCE($5, image_url),
           is_available = COALESCE($6, is_available),
           preparation_time = COALESCE($7, preparation_time),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND category_id IN (SELECT id FROM menu_category WHERE restaurant_id = $9)
       RETURNING *`,
      [category_id, name, description, price, image_url, is_available, preparation_time, id, restaurant_id]
    )

    res.json({
      message: 'Menu item updated successfully',
      item: result.rows[0]
    })
  } catch (error) {
    console.error('Update menu item error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete menu item
app.delete('/api/staff/menu/items/:id', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { id } = req.params

    // Delete menu item through category to verify restaurant ownership
    const result = await pool.query(
      `DELETE FROM menu_item 
       WHERE id = $1 AND category_id IN (SELECT id FROM menu_category WHERE restaurant_id = $2)
       RETURNING *`,
      [id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Menu item not found' })
    }

    res.json({ message: 'Menu item deleted successfully' })
  } catch (error) {
    console.error('Delete menu item error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// STAFF TABLE MANAGEMENT ROUTES
// ============================================

// Get all tables for staff's restaurant
app.get('/api/staff/tables', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff

    const result = await pool.query(
      `SELECT * FROM "table" 
       WHERE restaurant_id = $1 
       ORDER BY table_number`,
      [restaurant_id]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get tables error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Add a new table
app.post('/api/staff/tables', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { table_number, capacity, location } = req.body

    if (!table_number || !table_number.trim()) {
      return res.status(400).json({ error: 'Table number is required' })
    }

    if (!capacity || capacity < 1 || capacity > 8) {
      return res.status(400).json({ error: 'Capacity must be between 1 and 8' })
    }

    // Check if table number already exists for this restaurant
    const existingTable = await pool.query(
      'SELECT id FROM "table" WHERE restaurant_id = $1 AND table_number = $2',
      [restaurant_id, table_number.trim()]
    )

    if (existingTable.rows.length > 0) {
      return res.status(400).json({ error: 'Table number already exists' })
    }

    const result = await pool.query(
      `INSERT INTO "table" (restaurant_id, table_number, capacity, location, is_available)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [restaurant_id, table_number.trim(), capacity, location || null]
    )

    res.status(201).json({
      message: 'Table added successfully',
      table: result.rows[0]
    })
  } catch (error) {
    console.error('Add table error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update a table
app.put('/api/staff/tables/:id', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { id } = req.params
    const { table_number, capacity, location, is_available } = req.body

    if (!table_number || !table_number.trim()) {
      return res.status(400).json({ error: 'Table number is required' })
    }

    if (!capacity || capacity < 1 || capacity > 8) {
      return res.status(400).json({ error: 'Capacity must be between 1 and 8' })
    }

    // Check if table exists and belongs to this restaurant
    const tableCheck = await pool.query(
      'SELECT id FROM "table" WHERE id = $1 AND restaurant_id = $2',
      [id, restaurant_id]
    )

    if (tableCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' })
    }

    // Check if table number already exists for another table
    const existingTable = await pool.query(
      'SELECT id FROM "table" WHERE restaurant_id = $1 AND table_number = $2 AND id != $3',
      [restaurant_id, table_number.trim(), id]
    )

    if (existingTable.rows.length > 0) {
      return res.status(400).json({ error: 'Table number already exists' })
    }

    const result = await pool.query(
      `UPDATE "table"
       SET table_number = $1, capacity = $2, location = $3, is_available = $4
       WHERE id = $5 AND restaurant_id = $6
       RETURNING *`,
      [table_number.trim(), capacity, location, is_available !== false, id, restaurant_id]
    )

    res.json({
      message: 'Table updated successfully',
      table: result.rows[0]
    })
  } catch (error) {
    console.error('Update table error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete a table
app.delete('/api/staff/tables/:id', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { id } = req.params

    const result = await pool.query(
      'DELETE FROM "table" WHERE id = $1 AND restaurant_id = $2 RETURNING *',
      [id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' })
    }

    res.json({ message: 'Table deleted successfully' })
  } catch (error) {
    console.error('Delete table error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// CUSTOMER NOTIFICATION ROUTES
// ============================================

// Get customer notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const customer_id = req.user.id

    const result = await pool.query(
      `SELECT * FROM notification
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [customer_id]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get notifications error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get customer notification count (unread)
app.get('/api/notifications/count', authenticateToken, async (req, res) => {
  try {
    const customer_id = req.user.id

    const result = await pool.query(
      'SELECT COUNT(*) as count FROM notification WHERE customer_id = $1 AND is_read = false',
      [customer_id]
    )

    res.json({ count: parseInt(result.rows[0].count) })
  } catch (error) {
    console.error('Get notification count error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Mark notification as read
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const customer_id = req.user.id

    const result = await pool.query(
      'UPDATE notification SET is_read = true WHERE id = $1 AND customer_id = $2 RETURNING *',
      [id, customer_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Mark notification read error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Mark all notifications as read
app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    const customer_id = req.user.id

    await pool.query(
      'UPDATE notification SET is_read = true WHERE customer_id = $1',
      [customer_id]
    )

    res.json({ message: 'All notifications marked as read' })
  } catch (error) {
    console.error('Mark all notifications read error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete notification
app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const customer_id = req.user.id

    const result = await pool.query(
      'DELETE FROM notification WHERE id = $1 AND customer_id = $2 RETURNING *',
      [id, customer_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' })
    }

    res.json({ message: 'Notification deleted' })
  } catch (error) {
    console.error('Delete notification error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// ADMIN ROUTES
// ============================================

// Test route to verify admin routes are loaded
app.get('/api/admin/test', (req, res) => {
  res.json({ message: 'Admin routes are working' })
})

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    // First check if admin table exists and has the user
    let adminResult = { rows: [] }
    let tableExists = false
    
    try {
      // Check if admin table exists
      const tableCheck = await pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'admin'
        )`
      )
      tableExists = tableCheck.rows[0].exists
      
      if (tableExists) {
        adminResult = await pool.query(
          'SELECT * FROM admin WHERE email = $1',
          [email]
        )
      }
    } catch (e) {
      console.log('Admin table check failed, trying staff table:', e.message)
    }

    // If not found in admin table, check staff table for admin role
    if (adminResult.rows.length === 0) {
      adminResult = await pool.query(
        'SELECT * FROM staff WHERE email = $1 AND role = $2',
        [email, 'admin']
      )
    }

    if (adminResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const admin = adminResult.rows[0]

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    // Generate token
    const token = jwt.sign(
      { id: admin.id, email: admin.email, type: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      message: 'Login successful',
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        first_name: admin.first_name,
        last_name: admin.last_name,
        name: admin.name
      }
    })
  } catch (error) {
    console.error('Admin login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get admin stats
app.get('/api/admin/stats', authenticateAdminToken, async (req, res) => {
  try {
    const [restaurantsResult, ordersResult, reservationsResult, staffResult, revenueResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM restaurant'),
      pool.query('SELECT COUNT(*) as total FROM orders'),
      pool.query('SELECT COUNT(*) as total FROM reservation'),
      pool.query('SELECT COUNT(*) as total FROM staff'),
      pool.query(`SELECT COALESCE(SUM(total_amount), 0) as total_revenue FROM orders WHERE status = 'completed'`)
    ])

    res.json({
      restaurants: parseInt(restaurantsResult.rows[0].total),
      orders: parseInt(ordersResult.rows[0].total),
      reservations: parseInt(reservationsResult.rows[0].total),
      staff: parseInt(staffResult.rows[0].total),
      revenue: parseFloat(revenueResult.rows[0].total_revenue)
    })
  } catch (error) {
    console.error('Get admin stats error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get all orders (admin)
app.get('/api/admin/orders', authenticateAdminToken, async (req, res) => {
  try {
    const { status } = req.query
    let query = `
      SELECT o.*, r.name as restaurant_name, c.first_name || ' ' || c.last_name as customer_name
      FROM orders o
      LEFT JOIN restaurant r ON r.id = o.restaurant_id
      LEFT JOIN customer c ON c.id = o.customer_id
    `
    const params = []

    if (status) {
      query += ' WHERE o.status = $1'
      params.push(status)
    }

    query += ' ORDER BY o.order_date DESC'

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Get admin orders error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get all reservations (admin)
app.get('/api/admin/reservations', authenticateAdminToken, async (req, res) => {
  try {
    const { status } = req.query
    let query = `
      SELECT r.*, rest.name as restaurant_name, c.first_name || ' ' || c.last_name as customer_name
      FROM reservation r
      LEFT JOIN restaurant rest ON rest.id = r.restaurant_id
      LEFT JOIN customer c ON c.id = r.customer_id
    `
    const params = []

    if (status) {
      query += ' WHERE r.status = $1'
      params.push(status)
    }

    query += ' ORDER BY r.reservation_date DESC, r.reservation_time DESC'

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Get admin reservations error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get all restaurants (admin)
app.get('/api/admin/restaurants', authenticateAdminToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id, r.name, r.description,
        r.address as location,
        r.email, r.phone,
        r.opening_time, r.closing_time,
        r.cuisine_type as cuisine,
        r.created_at,
        r.image_url,
        r.max_capacity as capacity,
        r.is_active,
        COALESCE(reservation_count.reservation_count, 0) as total_reservations,
        COALESCE(order_count.order_count, 0) as total_orders,
        COALESCE(staff_count.staff_count, 0) as total_staff
      FROM restaurant r
      LEFT JOIN (
        SELECT restaurant_id, COUNT(*) as reservation_count 
        FROM reservation 
        GROUP BY restaurant_id
      ) reservation_count ON r.id = reservation_count.restaurant_id
      LEFT JOIN (
        SELECT restaurant_id, COUNT(*) as order_count 
        FROM orders
        WHERE restaurant_id IS NOT NULL
        GROUP BY restaurant_id
      ) order_count ON r.id = order_count.restaurant_id
      LEFT JOIN (
        SELECT restaurant_id, COUNT(*) as staff_count 
        FROM staff 
        WHERE restaurant_id IS NOT NULL
        GROUP BY restaurant_id
      ) staff_count ON r.id = staff_count.restaurant_id
      ORDER BY r.name
    `)
    res.json(result.rows)
  } catch (error) {
    console.error('Get admin restaurants error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create restaurant (admin)
app.post('/api/admin/restaurants', authenticateAdminToken, async (req, res) => {
  try {
    const {
      name,
      description,
      location,        // frontend: location -> database: address
      cuisine,         // frontend: cuisine -> database: cuisine_type
      opening_time,    // frontend: opening_time -> database: opening_time (TIME format)
      closing_time,    // frontend: closing_time -> database: closing_time (TIME format)
      capacity,        // frontend: capacity -> database: max_capacity
      image_url,
      email,
      phone
    } = req.body

    const result = await pool.query(
      `INSERT INTO restaurant (name, description, address, cuisine_type, email, phone, opening_time, closing_time, max_capacity, image_url, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING *`,
      [name, description, location, cuisine, email, phone, opening_time, closing_time, capacity, image_url]
    )

    res.status(201).json({
      message: 'Restaurant created successfully',
      restaurant: result.rows[0]
    })
  } catch (error) {
    console.error('Create restaurant error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update restaurant (admin)
app.put('/api/admin/restaurants/:id', authenticateAdminToken, async (req, res) => {
  try {
    const { id } = req.params

    // Map frontend field names to database field names
    const {
      name,
      description,
      location,        // frontend: location -> database: address
      cuisine,         // frontend: cuisine -> database: cuisine_type
      opening_time,    // frontend: opening_time -> database: opening_time (TIME format)
      closing_time,    // frontend: closing_time -> database: closing_time (TIME format)
      capacity,        // frontend: capacity -> database: max_capacity
      image_url,
      email,
      phone,
      is_active
    } = req.body

    // Handle is_active separately since it's a boolean toggle
    let updateQuery = `
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           address = COALESCE($3, address),
           cuisine_type = COALESCE($4, cuisine_type),
           email = COALESCE($5, email),
           phone = COALESCE($6, phone),
           opening_time = COALESCE($7, opening_time),
           closing_time = COALESCE($8, closing_time),
           max_capacity = COALESCE($9, max_capacity),
           image_url = COALESCE($10, image_url)
    `

    let queryParams = [name, description, location, cuisine, email, phone, opening_time, closing_time, capacity, image_url]

    if (typeof is_active === 'boolean') {
      updateQuery += `, is_active = $${queryParams.length + 1}`
      queryParams.push(is_active)
    }

    updateQuery += ` WHERE id = $${queryParams.length + 1} RETURNING *`
    queryParams.push(id)

    const result = await pool.query(
      `UPDATE restaurant ${updateQuery}`,
      queryParams
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' })
    }

    res.json({
      message: 'Restaurant updated successfully',
      restaurant: result.rows[0]
    })
  } catch (error) {
    console.error('Update restaurant error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete restaurant (admin)
app.delete('/api/admin/restaurants/:id', authenticateAdminToken, async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query('DELETE FROM restaurant WHERE id = $1 RETURNING *', [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' })
    }

    res.json({ message: 'Restaurant deleted successfully' })
  } catch (error) {
    console.error('Delete restaurant error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get all staff (admin)
app.get('/api/admin/staff', authenticateAdminToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, r.name as restaurant_name
       FROM staff s
       LEFT JOIN restaurant r ON r.id = s.restaurant_id
       ORDER BY s.email`
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get admin staff error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create staff (admin)
app.post('/api/admin/staff', authenticateAdminToken, async (req, res) => {
  try {
    const { email, password, first_name, last_name, role, restaurant_id } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    const result = await pool.query(
      `INSERT INTO staff (email, password, first_name, last_name, role, restaurant_id, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, first_name, last_name, role, restaurant_id, name`,
      [email, hashedPassword, first_name, last_name, role || 'staff', restaurant_id, `${first_name} ${last_name}`]
    )

    res.status(201).json({
      message: 'Staff created successfully',
      staff: result.rows[0]
    })
  } catch (error) {
    console.error('Create staff error:', error)
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update staff (admin)
app.put('/api/admin/staff/:id', authenticateAdminToken, async (req, res) => {
  try {
    const { id } = req.params
    const { email, password, first_name, last_name, role, restaurant_id } = req.body

    let updateFields = []
    let params = []
    let paramIndex = 1

    if (email) {
      updateFields.push(`email = $${paramIndex++}`)
      params.push(email)
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10)
      updateFields.push(`password = $${paramIndex++}`)
      params.push(hashedPassword)
    }
    if (first_name) {
      updateFields.push(`first_name = $${paramIndex++}`)
      params.push(first_name)
    }
    if (last_name) {
      updateFields.push(`last_name = $${paramIndex++}`)
      params.push(last_name)
    }
    if (role) {
      updateFields.push(`role = $${paramIndex++}`)
      params.push(role)
    }
    if (restaurant_id !== undefined) {
      updateFields.push(`restaurant_id = $${paramIndex++}`)
      params.push(restaurant_id)
    }
    if (first_name || last_name) {
      updateFields.push(`name = $${paramIndex++}`)
      params.push(`${first_name || ''} ${last_name || ''}`.trim())
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    params.push(id)

    const result = await pool.query(
      `UPDATE staff 
       SET ${updateFields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, email, first_name, last_name, role, restaurant_id, name`,
      params
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Staff not found' })
    }

    res.json({
      message: 'Staff updated successfully',
      staff: result.rows[0]
    })
  } catch (error) {
    console.error('Update staff error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete staff (admin)
app.delete('/api/admin/staff/:id', authenticateAdminToken, async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query('DELETE FROM staff WHERE id = $1 RETURNING *', [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Staff not found' })
    }

    res.json({ message: 'Staff deleted successfully' })
  } catch (error) {
    console.error('Delete staff error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get analytics overview (admin)
app.get('/api/admin/analytics/overview', authenticateAdminToken, async (req, res) => {
  try {
    const { period = 'month' } = req.query
    let dateFilter = ''
    
    if (period === 'week') {
      dateFilter = "AND order_date >= CURRENT_DATE - INTERVAL '7 days'"
    } else if (period === 'month') {
      dateFilter = "AND order_date >= CURRENT_DATE - INTERVAL '30 days'"
    } else if (period === 'year') {
      dateFilter = "AND order_date >= CURRENT_DATE - INTERVAL '365 days'"
    }

    const [revenueResult, ordersResult, avgOrderResult, reservationsResult] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders`),
      pool.query(`SELECT COUNT(*) as count FROM orders WHERE 1=1 ${dateFilter}`),
      pool.query(`SELECT COALESCE(AVG(total_amount), 0) as avg_order FROM orders WHERE 1=1 ${dateFilter}`),
      pool.query(`SELECT COUNT(*) as count FROM reservation`)
    ])

    res.json({
      totalReservations: parseInt(reservationsResult.rows[0].count),
      totalOrders: parseInt(ordersResult.rows[0].count),
      totalRevenue: parseFloat(revenueResult.rows[0].revenue),
      averageOrderValue: parseFloat(avgOrderResult.rows[0].avg_order)
    })
  } catch (error) {
    console.error('Get analytics overview error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get top restaurants (admin)
app.get('/api/admin/analytics/top-restaurants', authenticateAdminToken, async (req, res) => {
  try {
    const { period = 'month', limit = 10 } = req.query
    let dateFilter = ''
    
    if (period === 'week') {
      dateFilter = "AND reservation_date >= CURRENT_DATE - INTERVAL '7 days'"
    } else if (period === 'month') {
      dateFilter = "AND reservation_date >= CURRENT_DATE - INTERVAL '30 days'"
    } else if (period === 'year') {
      dateFilter = "AND reservation_date >= CURRENT_DATE - INTERVAL '365 days'"
    }

    const result = await pool.query(
      `SELECT r.id, r.name, 
              COUNT(DISTINCT o.id) as order_count,
              COALESCE(SUM(o.total_amount), 0) as revenue,
              COUNT(DISTINCT res.id) as reservation_count
       FROM restaurant r
       LEFT JOIN orders o ON o.restaurant_id = r.id  -- Removed: AND o.status = 'completed'
       LEFT JOIN reservation res ON res.restaurant_id = r.id ${dateFilter}
       GROUP BY r.id, r.name
       ORDER BY order_count DESC, revenue DESC
       LIMIT $1`,
      [limit]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get top restaurants error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get peak hours (admin)
app.get('/api/admin/analytics/peak-hours', authenticateAdminToken, async (req, res) => {
  try {
    const { period = 'month' } = req.query
    let dateFilter = ''
    
    if (period === 'week') {
      dateFilter = "AND reservation_date >= CURRENT_DATE - INTERVAL '7 days'"
    } else if (period === 'month') {
      dateFilter = "AND reservation_date >= CURRENT_DATE - INTERVAL '30 days'"
    } else if (period === 'year') {
      dateFilter = "AND reservation_date >= CURRENT_DATE - INTERVAL '365 days'"
    }

    const result = await pool.query(
      `SELECT EXTRACT(HOUR FROM reservation_time) as hour, COUNT(*) as reservation_count
       FROM reservation
       WHERE 1=1 ${dateFilter}
       GROUP BY EXTRACT(HOUR FROM reservation_time)
       ORDER BY reservation_count DESC`
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get peak hours error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get recent reservations (admin)
app.get('/api/admin/analytics/recent-reservations', authenticateAdminToken, async (req, res) => {
  try {
    const { limit = 20 } = req.query

    const result = await pool.query(
      `SELECT r.*, rest.name as restaurant_name, c.first_name || ' ' || c.last_name as customer_name
       FROM reservation r
       LEFT JOIN restaurant rest ON rest.id = r.restaurant_id
       LEFT JOIN customer c ON c.id = r.customer_id
       ORDER BY r.reservation_date DESC, r.reservation_time DESC
       LIMIT $1`,
      [limit]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get recent reservations error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get revenue by day (admin)
app.get('/api/admin/analytics/revenue-by-day', authenticateAdminToken, async (req, res) => {
  try {
    const { days = 30 } = req.query

    const result = await pool.query(
      `SELECT DATE(order_date) as date, COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as order_count
       FROM orders
       WHERE status = 'completed' AND order_date >= CURRENT_DATE - INTERVAL '${days} days'
       GROUP BY DATE(order_date)
       ORDER BY date DESC`
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get revenue by day error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============================================
// STAFF MENU MANAGEMENT ROUTES
// ============================================

// Get menu categories for staff's restaurant
app.get('/api/staff/menu/categories', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff

    const result = await pool.query(
      `SELECT mc.*, COUNT(mi.id) as item_count
       FROM menu_category mc
       LEFT JOIN menu_item mi ON mi.category_id = mc.id
       WHERE mc.restaurant_id = $1
       GROUP BY mc.id
       ORDER BY mc.display_order, mc.id`,
      [restaurant_id]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get menu categories error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get menu items for staff's restaurant
app.get('/api/staff/menu/items', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { category_id } = req.query

    let query = `
      SELECT mi.*, mc.category_name as category_name
      FROM menu_item mi
      LEFT JOIN menu_category mc ON mc.id = mi.category_id
      WHERE mc.restaurant_id = $1
    `
    const params = [restaurant_id]

    if (category_id) {
      query += ' AND mi.category_id = $2'
      params.push(category_id)
    }

    query += ' ORDER BY mi.category_id, mi.item_name'

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Get menu items error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create menu category
app.post('/api/staff/menu/categories', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { name, description, display_order } = req.body

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' })
    }

    const result = await pool.query(
      `INSERT INTO menu_category (restaurant_id, name, description, display_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [restaurant_id, name, description || null, display_order || 0]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Create menu category error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create menu item
app.post('/api/staff/menu/items', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { category_id, name, description, price, image_url, is_available, preparation_time } = req.body

    if (!category_id) {
      return res.status(400).json({ error: 'Category is required' })
    }
    if (!name) {
      return res.status(400).json({ error: 'Item name is required' })
    }
    if (price === undefined || price === null) {
      return res.status(400).json({ error: 'Price is required' })
    }

    const result = await pool.query(
      `INSERT INTO menu_item (category_id, item_name, description, price, image_url, is_available)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        category_id,
        name,
        description || null,
        price,
        image_url || null,
        is_available !== false
      ]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Create menu item error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update menu item
app.put('/api/staff/menu/items/:id', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { id } = req.params
    const { category_id, name, description, price, image_url, is_available, preparation_time } = req.body

    const result = await pool.query(
      `UPDATE menu_item
       SET category_id = COALESCE($1, category_id),
           item_name = COALESCE($2, item_name),
           description = COALESCE($3, description),
           price = COALESCE($4, price),
           image_url = COALESCE($5, image_url),
           is_available = COALESCE($6, is_available),
           preparation_time = COALESCE($7, preparation_time),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND restaurant_id = $9
       RETURNING *`,
      [category_id, name, description, price, image_url, is_available, preparation_time, id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Menu item not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Update menu item error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete menu item
app.delete('/api/staff/menu/items/:id', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { id } = req.params

    // Delete menu item through category to verify restaurant ownership
    const result = await pool.query(
      `DELETE FROM menu_item 
       WHERE id = $1 AND category_id IN (SELECT id FROM menu_category WHERE restaurant_id = $2)
       RETURNING *`,
      [id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Menu item not found' })
    }

    res.json({ message: 'Menu item deleted successfully' })
  } catch (error) {
    console.error('Delete menu item error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete menu category
app.delete('/api/staff/menu/categories/:id', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id } = req.staff
    const { id } = req.params

    // Check if category has items
    const itemsCheck = await pool.query(
      'SELECT COUNT(*) as count FROM menu_item WHERE category_id = $1',
      [id]
    )

    if (parseInt(itemsCheck.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete category with existing items. Please delete items first.' })
    }

    const result = await pool.query(
      'DELETE FROM menu_category WHERE id = $1 AND restaurant_id = $2 RETURNING *',
      [id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' })
    }

    res.json({ message: 'Category deleted successfully' })
  } catch (error) {
    console.error('Delete menu category error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ============ HITPAY PAYMENT INTEGRATION ============
// HitPay API credentials from environment variables
const HITPAY_API_KEY = process.env.HITPAY_API_KEY || 'test_7606027ec751e86efb6ced4661d12ccb88b1146879315ab36e1df43248b87b62'
const HITPAY_SALT = process.env.HITPAY_SALT || 'Ch9fZjjOD80nCgU2rIH9eE923KIIl7odmUybRf8EU13BnXBfwurFV32ak1YDbuU3'
const HITPAY_MODE = process.env.HITPAY_MODE || 'sandbox' // 'sandbox' or 'live'
const HITPAY_BASE_URL = HITPAY_MODE === 'sandbox' 
  ? 'https://api.sandbox.hit-pay.com/v1/payment-requests'
  : 'https://api.hit-pay.com/v1/payment-requests'

// Create HitPay payment request
app.post('/api/payments/hitpay/create', authenticateToken, async (req, res) => {
  try {
    const { order_id, amount, customer_name, customer_email, description, reference_number } = req.body

    console.log('Received payment request:', { order_id, amount, customer_email, description, reference_number });

    if (!order_id || !amount || !customer_email) {
      return res.status(400).json({ error: 'Missing required fields: order_id, amount, customer_email' })
    }

    // Generate HMAC SHA-256 signature for the request body
    const timestamp = Date.now().toString()
    
    // Ensure description is not empty
    const finalDescription = (description && description.trim() !== '') ? description.trim() : `Order #${order_id}`;
    
    // Prepare payment request payload
    const paymentData = {
      email: customer_email,
      name: customer_name || 'Customer',
      amount: parseFloat(amount).toFixed(2),
      currency: 'MYR',
      reference_number: reference_number || `ORD-${order_id}-${Date.now()}`,
      description: finalDescription,
      callback_url: `${process.env.API_URL}/api/payments/hitpay/callback`,
      redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-success?order_id=${order_id}`,
      payment_methods: ['card', 'fpx'], // Cards and FPX (TNG may not be available in sandbox)
    }

    // Generate signature from request body
    const signature = crypto
      .createHmac('sha256', HITPAY_SALT)
      .update(JSON.stringify(paymentData))
      .digest('hex')

    console.log('Creating HitPay payment:', paymentData)

    // Make request to HitPay API
    const response = await fetch(HITPAY_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BUSINESS-API-KEY': HITPAY_API_KEY,
        'X-REQUEST-SIGNATURE': signature,
        'X-REQUEST-TIMESTAMP': timestamp,
      },
      body: JSON.stringify(paymentData),
    })

    const responseData = await response.json()

    console.log('HitPay API response:', responseData)
    console.log('Response status:', response.status)

    if (!response.ok) {
      console.error('HitPay API error:', responseData)
      return res.status(response.status).json({ 
        error: responseData.message || 'Failed to create payment',
        details: responseData 
      })
    }

    // Store payment reference in database
    console.log(`Creating payment_transactions record for order_id: ${order_id}, payment_id: ${responseData.id}`)
    await pool.query(
      `INSERT INTO payment_transactions (order_id, payment_id, payment_url, amount, currency, status, payment_method, created_at)
       VALUES ($1, $2, $3, $4, 'MYR', 'pending', 'hitpay', NOW())`,
      [order_id, responseData.id, responseData.url, amount]
    )
    console.log(`payment_transactions record created successfully for order_id: ${order_id}`)

    res.json({
      payment_id: responseData.id,
      payment_url: responseData.url,
      expires_at: responseData.expires_at,
    })
  } catch (error) {
    console.error('HitPay payment creation error:', error)
    res.status(500).json({ error: 'Failed to create payment' })
  }
})

// HitPay payment callback (webhook)
app.post('/api/payments/hitpay/callback', async (req, res) => {
  try {
    // Log raw body to debug
    console.log('HitPay callback RAW BODY:', JSON.stringify(req.body))

    // HitPay sends different webhook formats:
    // 1. Payment request webhook: has "id" field
    // 2. Payment webhook: has "payment_request_id" field
    const body = req.body
    const payment_id = body.id || body.payment_request_id
    const status = body.status
    const transaction_id = body.payments?.[0]?.id || body.id

    console.log('HitPay callback received:', { payment_id, status, transaction_id })
    console.log('Webhook type:', body.id ? 'payment_request' : 'payment')

    if (!payment_id) {
      return res.status(400).json({ error: 'Missing payment_id' })
    }

    // Map HitPay status to our status
    const statusMap = {
      'completed': 'completed',
      'success': 'completed',
      'succeeded': 'completed',
      'pending': 'pending',
      'failed': 'failed',
      'expired': 'expired',
    }

    const mappedStatus = statusMap[status?.toLowerCase()] || 'pending'

    // Log unknown status
    if (!statusMap[status?.toLowerCase()]) {
      console.log(`Unknown HitPay status received: "${status}" - mapped to "pending"`)
    }

    console.log(`Processing payment ${payment_id}: HitPay status="${status}" → mapped to "${mappedStatus}"`)

    // Update payment transaction
    await pool.query(
      `UPDATE payment_transactions 
       SET status = $1, transaction_id = $2, updated_at = NOW()
       WHERE payment_id = $3`,
      [mappedStatus, transaction_id || null, payment_id]
    )

    // If payment completed, update order payment_status and payment_method
    if (mappedStatus === 'completed') {
      console.log(`Payment ${payment_id} is completed, looking up order...`)

      // First get the order_id from payment_transactions
      const orderResult = await pool.query(
        'SELECT order_id FROM payment_transactions WHERE payment_id = $1',
        [payment_id]
      )

      if (orderResult.rows.length > 0) {
        const order_id = orderResult.rows[0].order_id
        console.log(`Found order_id: ${order_id}, updating payment status...`)

        // Update order with payment_status and payment_method
        const updateResult = await pool.query(
          `UPDATE orders
           SET payment_status = 'paid',
               payment_method = 'hitpay',
               updated_at = NOW()
           WHERE id = $1`,
          [order_id]
        )
        console.log(`Order ${order_id} payment status updated to paid. Rows affected: ${updateResult.rowCount}`)
      } else {
        console.error('Order not found for payment_id:', payment_id)
        console.error('This means payment_transactions record does not exist for this payment_id!')
      }
    } else {
      console.log(`Payment ${payment_id} status is "${mappedStatus}" - NOT updating order payment status`)
    }

    res.json({ received: true, status: mappedStatus })
  } catch (error) {
    console.error('HitPay callback error:', error)
    res.status(500).json({ error: 'Callback processing failed' })
  }
})

// Verify HitPay payment status
app.get('/api/payments/hitpay/status/:payment_id', authenticateToken, async (req, res) => {
  try {
    const { payment_id } = req.params

    // Get payment from database
    const result = await pool.query(
      'SELECT * FROM payment_transactions WHERE payment_id = $1',
      [payment_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' })
    }

    const dbPayment = result.rows[0]

    // If payment is pending in database, verify with HitPay API
    if (dbPayment.status === 'pending') {
      try {
        const timestamp = Date.now().toString()
        const signature = crypto
          .createHmac('sha256', HITPAY_SALT)
          .update(payment_id)
          .digest('hex')

        const verifyResponse = await fetch(`${HITPAY_BASE_URL}/${payment_id}`, {
          method: 'GET',
          headers: {
            'X-BUSINESS-API-KEY': HITPAY_API_KEY,
            'X-REQUEST-SIGNATURE': signature,
            'X-REQUEST-TIMESTAMP': timestamp,
          },
        })

        if (verifyResponse.ok) {
          const hitpayData = await verifyResponse.json()
          const newStatus = hitpayData.status?.toLowerCase()

          // Map HitPay status
          const statusMap = {
            'completed': 'completed',
            'success': 'completed',
            'pending': 'pending',
            'failed': 'failed',
            'expired': 'expired',
          }
          const mappedStatus = statusMap[newStatus] || 'pending'

          // Update database if status changed
          if (mappedStatus !== dbPayment.status) {
            await pool.query(
              `UPDATE payment_transactions SET status = $1, updated_at = NOW() WHERE payment_id = $2`,
              [mappedStatus, payment_id]
            )

            // If payment completed, update order payment status
            if (mappedStatus === 'completed') {
              await pool.query(
                `UPDATE orders SET payment_status = 'paid', payment_method = 'hitpay', updated_at = NOW() WHERE id = $1`,
                [dbPayment.order_id]
              )
              console.log(`✅ Order ${dbPayment.order_id} payment status updated to paid (verified with HitPay)`)
            }
          }

          res.json({
            payment_id: payment_id,
            status: mappedStatus,
            amount: hitpayData.amount || dbPayment.amount,
            transaction_id: hitpayData.transaction_id || dbPayment.transaction_id,
            verified: true,
          })
        } else {
          // HitPay API error, return database status
          res.json({
            payment_id: payment_id,
            status: dbPayment.status,
            amount: dbPayment.amount,
            transaction_id: dbPayment.transaction_id,
            verified: false,
          })
        }
      } catch (verifyErr) {
        console.error('Error verifying with HitPay:', verifyErr)
        // Return database status on error
        res.json({
          payment_id: payment_id,
          status: dbPayment.status,
          amount: dbPayment.amount,
          transaction_id: dbPayment.transaction_id,
          verified: false,
        })
      }
    } else {
      // Payment already completed or failed
      res.json({
        payment_id: payment_id,
        status: dbPayment.status,
        amount: dbPayment.amount,
        transaction_id: dbPayment.transaction_id,
        verified: false,
      })
    }
  } catch (error) {
    console.error('HitPay status check error:', error)
    res.status(500).json({ error: 'Failed to check payment status' })
  }
})

// Create payment transaction record
app.post('/api/payments', authenticateToken, async (req, res) => {
  try {
    const { order_id, amount, payment_method, transaction_id, notes } = req.body

    const result = await pool.query(
      `INSERT INTO payment_transactions (order_id, amount, payment_method, transaction_id, status, notes, created_at)
       VALUES ($1, $2, $3, $4, 'completed', $5, NOW())
       RETURNING *`,
      [order_id, amount, payment_method || 'online', transaction_id, notes]
    )

    res.json({ message: 'Payment recorded successfully', payment: result.rows[0] })
  } catch (error) {
    console.error('Payment creation error:', error)
    res.status(500).json({ error: 'Failed to record payment' })
  }
})

// Get user payments
app.get('/api/payments', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pt.*, o.reference_number, o.status as order_status
       FROM payment_transactions pt
       JOIN orders o ON pt.order_id = o.id
       WHERE o.customer_id = $1
       ORDER BY pt.created_at DESC`,
      [req.user.id]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get payments error:', error)
    res.status(500).json({ error: 'Failed to fetch payments' })
  }
})

// ============ END HITPAY INTEGRATION ============
// In Vercel, this file is exported as a handlers
// Only start server if running locally (not in Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`)
    console.log(`📍 API base URL: http://localhost:${PORT}/api`)
    console.log(`✅ Admin routes: /api/admin/login, /api/admin/stats, etc.`)
    console.log(`✅ Staff routes: /api/staff/login, /api/staff/orders, etc.`)
  })
}

// Export for Vercel
export default app
