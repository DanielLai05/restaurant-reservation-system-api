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
    const result = await pool.query(
      `SELECT r.*, rest.name as restaurant_name, c.first_name || ' ' || c.last_name as customer_name
       FROM reservation r
       LEFT JOIN restaurant rest ON rest.id = r.restaurant_id
       LEFT JOIN customer c ON c.id = r.customer_id
       WHERE r.restaurant_id = $1
       ORDER BY r.reservation_date DESC, r.reservation_time DESC`,
      [restaurant_id]
    )
    res.json(result.rows)
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

    const result = await pool.query(
      `UPDATE reservation 
       SET status = $1 
       WHERE id = $2 AND restaurant_id = $3
       RETURNING *`,
      [status, id, restaurant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' })
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
    const result = await pool.query(
      `SELECT id, name, description, address, email, phone, 
              opening_time, closing_time, cuisine_type, created_at
       FROM restaurant 
       ORDER BY name`
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get admin restaurants error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create restaurant (admin)
app.post('/api/admin/restaurants', authenticateAdminToken, async (req, res) => {
  try {
    const { name, description, address, email, phone, opening_time, closing_time, cuisine_type } = req.body

    const result = await pool.query(
      `INSERT INTO restaurant (name, description, address, email, phone, opening_time, closing_time, cuisine_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, description, address, email, phone, opening_time, closing_time, cuisine_type]
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
    const { name, description, address, email, phone, opening_time, closing_time, cuisine_type } = req.body

    const result = await pool.query(
      `UPDATE restaurant 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           address = COALESCE($3, address),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone),
           opening_time = COALESCE($6, opening_time),
           closing_time = COALESCE($7, closing_time),
           cuisine_type = COALESCE($8, cuisine_type)
       WHERE id = $9
       RETURNING *`,
      [name, description, address, email, phone, opening_time, closing_time, cuisine_type, id]
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

    const [revenueResult, ordersResult, avgOrderResult] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status = 'completed' ${dateFilter}`),
      pool.query(`SELECT COUNT(*) as count FROM orders WHERE 1=1 ${dateFilter}`),
      pool.query(`SELECT COALESCE(AVG(total_amount), 0) as avg_order FROM orders WHERE status = 'completed' ${dateFilter}`)
    ])

    res.json({
      revenue: parseFloat(revenueResult.rows[0].revenue),
      orders: parseInt(ordersResult.rows[0].count),
      avgOrderValue: parseFloat(avgOrderResult.rows[0].avg_order)
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
      dateFilter = "AND o.order_date >= CURRENT_DATE - INTERVAL '7 days'"
    } else if (period === 'month') {
      dateFilter = "AND o.order_date >= CURRENT_DATE - INTERVAL '30 days'"
    } else if (period === 'year') {
      dateFilter = "AND o.order_date >= CURRENT_DATE - INTERVAL '365 days'"
    }

    const result = await pool.query(
      `SELECT r.id, r.name, COUNT(o.id) as order_count, COALESCE(SUM(o.total_amount), 0) as revenue
       FROM restaurant r
       LEFT JOIN orders o ON o.restaurant_id = r.id AND o.status = 'completed' ${dateFilter}
       GROUP BY r.id, r.name
       ORDER BY revenue DESC
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
      dateFilter = "AND order_date >= CURRENT_DATE - INTERVAL '7 days'"
    } else if (period === 'month') {
      dateFilter = "AND order_date >= CURRENT_DATE - INTERVAL '30 days'"
    } else if (period === 'year') {
      dateFilter = "AND order_date >= CURRENT_DATE - INTERVAL '365 days'"
    }

    const result = await pool.query(
      `SELECT EXTRACT(HOUR FROM order_date) as hour, COUNT(*) as order_count
       FROM orders
       WHERE 1=1 ${dateFilter}
       GROUP BY EXTRACT(HOUR FROM order_date)
       ORDER BY hour`
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📍 API base URL: http://localhost:${PORT}/api`)
  console.log(`✅ Admin routes: /api/admin/login, /api/admin/stats, etc.`)
  console.log(`✅ Staff routes: /api/staff/login, /api/staff/orders, etc.`)
})
