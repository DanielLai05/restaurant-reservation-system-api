import express from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const app = express()
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(express.json())
app.use(cors())
dotenv.config()

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

// ============================================
// AUTH ROUTES
// ============================================

// Register a new customer (from Firebase)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { firebase_uid, first_name, last_name, email, phone } = req.body

    console.log('Register request:', { firebase_uid, first_name, last_name, email, phone })

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    // Check if customer already exists
    const existingUser = await pool.query(
      'SELECT id FROM customer WHERE email = $1',
      [email]
    )

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' })
    }

    // Insert new customer (password handled by Firebase, so set to NULL)
    const result = await pool.query(
      `INSERT INTO customer (firebase_uid, first_name, last_name, email, phone, password)
       VALUES ($1, $2, $3, $4, $5, NULL)
       RETURNING id, first_name, last_name, email, phone, created_at`,
      [firebase_uid || null, first_name || '', last_name || '', email, phone || null]
    )

    const customer = result.rows[0]
    console.log('Customer created:', customer.id)

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
    res.status(500).json({ error: 'Internal server error: ' + error.message })
  }
})

// Sync user from Firebase login
app.post('/api/auth/sync-user', async (req, res) => {
  try {
    const { email, first_name, last_name, phone } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    // Check if customer exists
    const existingUser = await pool.query(
      'SELECT id FROM customer WHERE email = $1',
      [email]
    )

    if (existingUser.rows.length > 0) {
      // User already exists, update their info
      await pool.query(
        `UPDATE customer 
         SET first_name = COALESCE($1, first_name),
             last_name = COALESCE($2, last_name),
             phone = COALESCE($3, phone)
         WHERE email = $4`,
        [first_name || '', last_name || '', phone || null, email]
      )
      return res.json({ message: 'User updated successfully', existing: true })
    }

    // Create new customer
    const result = await pool.query(
      `INSERT INTO customer (firebase_uid, email, first_name, last_name, phone)
       VALUES (NULL, $1, $2, $3, $4)
       RETURNING id`,
      [email, first_name || '', last_name || '', phone || null]
    )

    res.json({ message: 'User synced successfully', new: true, id: result.rows[0].id })
  } catch (error) {
    console.error('Sync user error:', error)
    res.status(500).json({ error: 'Internal server error: ' + error.message })
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
      return res.status(404).json({ error: 'Customer not found' })
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
              opening_time, closing_time, cuisine_type, created_at
       FROM restaurant 
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
      `SELECT * FROM restaurant WHERE id = $1`,
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

    // Check if table is already booked for this date and time
    const existingReservation = await pool.query(
      `SELECT id FROM reservation
       WHERE restaurant_id = $1
       AND table_id = $2
       AND reservation_date = $3
       AND reservation_time = $4
       AND status != 'cancelled'`,
      [restaurant_id, table_id, reservation_date, reservation_time]
    )

    if (existingReservation.rows.length > 0) {
      return res.status(400).json({
        error: 'This table is already booked for the selected date and time. Please choose a different time or table.'
      })
    }

    // Create reservation
    const result = await pool.query(
      `INSERT INTO reservation
        (customer_id, restaurant_id, table_id, reservation_date, reservation_time, party_size, special_requests, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [customer_id, restaurant_id, table_id || null, reservation_date, reservation_time, party_size, special_requests]
    )

    const reservation = result.rows[0]

    res.status(201).json({
      message: 'Reservation created successfully',
      reservation
    })
  } catch (error) {
    console.error('Create reservation error:', error)
    res.status(500).json({ error: 'Internal server error: ' + error.message })
  }
})

// Check available tables for a specific date and time
app.get('/api/reservations/check', authenticateToken, async (req, res) => {
  try {
    const { restaurant_id, date, time } = req.query;

    if (!restaurant_id || !date || !time) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Get all reservations for the same restaurant, date, and time that are not cancelled
    const result = await pool.query(
      `SELECT table_id FROM reservation
       WHERE restaurant_id = $1
       AND reservation_date = $2
       AND reservation_time = $3
       AND status != 'cancelled'`,
      [restaurant_id, date, time]
    );

    // Return array of booked table IDs
    const booked_table_ids = result.rows
      .map(row => row.table_id)
      .filter(id => id !== null);

    res.json({ booked_table_ids });
  } catch (error) {
    console.error('Check reservations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
      cartItems = items.map(item => ({
        ...item,
        item_id: item.item_id || item.id,
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
      `INSERT INTO orders (customer_id, reservation_id, restaurant_id, status, notes, total_amount)
       VALUES ($1, $2, $3, 'pending', $4, $5)
       RETURNING *`,
      [customer_id, reservation_id, restaurant_id, notes, total]
    )

    const order = orderResult.rows[0]

    // Create order items
    for (const item of cartItems) {
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
    const result = await pool.query(
      `SELECT o.*, r.name as restaurant_name
       FROM orders o
       LEFT JOIN restaurant r ON r.id = o.restaurant_id
       WHERE o.customer_id = $1
       ORDER BY o.order_date DESC`,
      [req.user.id]
    )
    res.json(result.rows)
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
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find staff member by email
    const result = await pool.query(
      `SELECT s.*, r.name as restaurant_name 
       FROM staff s 
       LEFT JOIN restaurant r ON s.restaurant_id = r.id 
       WHERE s.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const staff = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, staff.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token
    const token = jwt.sign(
      { 
        id: staff.id, 
        email: staff.email, 
        role: staff.role, 
        restaurant_id: staff.restaurant_id,
        type: 'staff'
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      staff: {
        id: staff.id,
        email: staff.email,
        name: staff.name,
        role: staff.role,
        restaurant_id: staff.restaurant_id,
        restaurant_name: staff.restaurant_name
      }
    });
  } catch (error) {
    console.error('Staff login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Middleware for staff authentication
const authenticateStaffToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    if (user.type !== 'staff') {
      return res.status(403).json({ error: 'Staff access required' });
    }
    
    req.user = user;
    next();
  });
};

// Get staff orders (for specific restaurant)
app.get('/api/staff/orders', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id, status } = req.query;
    const staffRestaurantId = req.user.restaurant_id;

    // Staff can only view orders from their restaurant (managers can view all)
    const targetRestaurantId = (req.user.role === 'manager' && restaurant_id) 
      ? restaurant_id 
      : staffRestaurantId;

    if (!targetRestaurantId) {
      return res.json([]);
    }

    let query = `
      SELECT o.*, c.email as customer_email, r.name as restaurant_name
      FROM orders o
      LEFT JOIN customer c ON o.customer_id = c.id
      LEFT JOIN restaurant r ON o.restaurant_id = r.id
      WHERE o.restaurant_id = $1
    `;
    
    const params = [targetRestaurantId];

    if (status) {
      query += ` AND o.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY o.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get staff orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get staff reservations (for specific restaurant)
app.get('/api/staff/reservations', authenticateStaffToken, async (req, res) => {
  try {
    const { restaurant_id, status, date } = req.query;
    const staffRestaurantId = req.user.restaurant_id;

    // Staff can only view reservations from their restaurant (managers can view all)
    const targetRestaurantId = (req.user.role === 'manager' && restaurant_id) 
      ? restaurant_id 
      : staffRestaurantId;

    if (!targetRestaurantId) {
      return res.json([]);
    }

    let query = `
      SELECT r.*, c.email as customer_email, c.phone as customer_phone, 
             c.first_name || ' ' || c.last_name as customer_name,
             rest.name as restaurant_name,
             t.name as table_name
      FROM reservation r
      LEFT JOIN customer c ON r.customer_id = c.id
      LEFT JOIN restaurant rest ON r.restaurant_id = rest.id
      LEFT JOIN restaurant_table t ON r.table_id = t.id
      WHERE r.restaurant_id = $1
    `;
    
    const params = [targetRestaurantId];

    if (status) {
      query += ` AND r.status = $2`;
      params.push(status);
    }

    if (date) {
      query += ` AND r.reservation_date = $2`;
      params.push(date);
    }

    query += ` ORDER BY r.reservation_date ASC, r.reservation_time ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get staff reservations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status (confirm/complete)
app.put('/api/staff/orders/:orderId/status', authenticateStaffToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Check if order exists and belongs to staff's restaurant
    const orderCheck = await pool.query(
      `SELECT o.* FROM orders o 
       WHERE o.id = $1 AND o.restaurant_id = $2`,
      [orderId, req.user.restaurant_id]
    );

    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const result = await pool.query(
      `UPDATE orders SET status = $1, updated_at = NOW() 
       WHERE id = $2 AND restaurant_id = $3
       RETURNING *`,
      [status, orderId, req.user.restaurant_id]
    );

    res.json({
      message: 'Order status updated successfully',
      order: result.rows[0]
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update reservation status (confirm/cancel)
app.put('/api/staff/reservations/:reservationId/status', authenticateStaffToken, async (req, res) => {
  try {
    const { reservationId } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Check if reservation exists and belongs to staff's restaurant
    const resCheck = await pool.query(
      `SELECT * FROM reservation 
       WHERE id = $1 AND restaurant_id = $2`,
      [reservationId, req.user.restaurant_id]
    );

    if (resCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    const result = await pool.query(
      `UPDATE reservation SET status = $1, updated_at = NOW() 
       WHERE id = $2 AND restaurant_id = $3
       RETURNING *`,
      [status, reservationId, req.user.restaurant_id]
    );

    res.json({
      message: 'Reservation status updated successfully',
      reservation: result.rows[0]
    });
  } catch (error) {
    console.error('Update reservation status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get staff dashboard stats
app.get('/api/staff/stats', authenticateStaffToken, async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id;

    if (!restaurantId) {
      return res.json({
        todayReservations: 0,
        pendingOrders: 0,
        completedOrders: 0,
        totalRevenue: 0
      });
    }

    // Get today's date
    const today = new Date().toISOString().split('T')[0];

    // Count today's reservations
    const todayReservations = await pool.query(
      `SELECT COUNT(*) as count FROM reservation 
       WHERE restaurant_id = $1 AND reservation_date = $2 AND status != 'cancelled'`,
      [restaurantId, today]
    );

    // Count pending orders
    const pendingOrders = await pool.query(
      `SELECT COUNT(*) as count FROM orders 
       WHERE restaurant_id = $1 AND status IN ('pending', 'confirmed', 'preparing')`,
      [restaurantId]
    );

    // Count completed orders today
    const completedOrders = await pool.query(
      `SELECT COUNT(*) as count FROM orders 
       WHERE restaurant_id = $1 AND status = 'completed' AND DATE(created_at) = $2`,
      [restaurantId, today]
    );

    // Calculate today's revenue
    const revenue = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM orders 
       WHERE restaurant_id = $1 AND status = 'completed' AND DATE(created_at) = $2`,
      [restaurantId, today]
    );

    res.json({
      todayReservations: parseInt(todayReservations.rows[0].count),
      pendingOrders: parseInt(pendingOrders.rows[0].count),
      completedOrders: parseInt(completedOrders.rows[0].count),
      totalRevenue: parseFloat(revenue.rows[0].total)
    });
  } catch (error) {
    console.error('Get staff stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📍 API base URL: http://localhost:${PORT}/api`)
})
