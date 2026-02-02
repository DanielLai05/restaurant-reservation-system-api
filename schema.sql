/**
 * Restaurant Reservation System - Database Schema
 * Generated: January 2026
 */

-- ============================================
-- TABLE: restaurant
-- Stores restaurant information
-- ============================================
CREATE TABLE restaurant (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    address VARCHAR(255),
    phone VARCHAR(20),
    opening_time TIME NOT NULL,
    closing_time TIME NOT NULL,
    max_capacity INTEGER,
    image_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: table_location
-- Restaurant tables with seating capacity
-- ============================================
CREATE TABLE table_location (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER REFERENCES restaurant(id) ON DELETE CASCADE,
    table_name VARCHAR(20),
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    location_x INTEGER,
    location_y INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: customer
-- Customer accounts (Firebase Auth)
-- ============================================
CREATE TABLE customer (
    id VARCHAR(50) PRIMARY KEY,  -- Firebase UID
    email VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100),
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: reservation
-- Customer reservations
-- ============================================
CREATE TABLE reservation (
    id SERIAL PRIMARY KEY,
    customer_id VARCHAR(50) REFERENCES customer(id) ON DELETE CASCADE,
    restaurant_id INTEGER REFERENCES restaurant(id) ON DELETE CASCADE,
    table_id INTEGER REFERENCES table_location(id),
    reservation_date DATE NOT NULL,
    reservation_time TIME NOT NULL,
    party_size INTEGER NOT NULL CHECK (party_size > 0),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
        'pending', 'confirmed', 'cancelled', 'completed', 'cancellation_requested', 'no-show'
    )),
    cancellation_reason VARCHAR(500),
    special_requests TEXT,
    total_amount DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: menu_category
-- Menu categories (e.g., Appetizers, Main Course)
-- ============================================
CREATE TABLE menu_category (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER REFERENCES restaurant(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0
);

-- ============================================
-- TABLE: menu_item
-- Menu items available at restaurants
-- ============================================
CREATE TABLE menu_item (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER REFERENCES restaurant(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES menu_category(id),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    image_url VARCHAR(500),
    is_available BOOLEAN DEFAULT TRUE,
    preparation_time INTEGER,  -- in minutes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: orders
-- Customer food orders
-- ============================================
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER REFERENCES reservation(id) ON DELETE CASCADE,
    customer_id VARCHAR(50) REFERENCES customer(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'preparing', 'served', 'completed', 'cancelled')),
    total_amount DECIMAL(10,2) DEFAULT 0,
    payment_status VARCHAR(20) DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
    payment_method VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: order_item
-- Individual items in an order
-- ============================================
CREATE TABLE order_item (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER REFERENCES menu_item(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: staff
-- Restaurant staff accounts
-- ============================================
CREATE TABLE staff (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER REFERENCES restaurant(id) ON DELETE CASCADE,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) DEFAULT 'staff' CHECK (role IN ('manager', 'staff')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: admin
-- System administrators
-- ============================================
CREATE TABLE admin (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: notification
-- Customer and staff notifications for reservation events
-- ============================================
CREATE TABLE notification (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER REFERENCES restaurant(id) ON DELETE CASCADE,
    customer_id VARCHAR(50) REFERENCES customer(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('reservation_new', 'reservation_cancelled', 'cancellation_request', 'cancellation_approved', 'cancellation_rejected', 'order_new', 'reservation_confirmed')),
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    reservation_id INTEGER REFERENCES reservation(id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: cancellation_request
-- Tracks reservation cancellation requests
-- ============================================
CREATE TABLE cancellation_request (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER REFERENCES reservation(id) ON DELETE CASCADE,
    customer_id VARCHAR(50) REFERENCES customer(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    processed_by VARCHAR(50),
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DATABASE RELATIONSHIPS
-- ============================================
/*
Restaurant Reservation System ER Diagram:

┌─────────────────┐       ┌─────────────────────┐       ┌─────────────────┐
│   restaurant    │──────▶│   table_location    │       │    customer     │
│                 │       │                     │       │                 │
│ - id (PK)       │       │ - id (PK)           │       │ - id (PK)       │
│ - name          │       │ - restaurant_id (FK)│       │ - email         │
│ - description   │       │ - table_name        │       │ - name          │
│ - address       │       │ - capacity          │       │ - phone         │
│ - phone         │       └─────────────────────┘       └────────┬────────┘
│ - opening_time  │                                               │
│ - closing_time  │                                               │
│ - max_capacity  │                                               │
└─────────────────┘                                               │
       │                                                         │
       │                                                         ▼
       ▼                                                 ┌─────────────────┐
┌─────────────────────┐                                       │   reservation   │
│   menu_category     │                                       │                 │
│                     │       ┌─────────────────┐             │ - id (PK)      │
│ - id (PK)           │       │   menu_item     │             │ - customer_id  │
│ - restaurant_id (FK)│◀──────│                 │◀────────────│ - restaurant_id│
│ - name              │       │ - id (PK)       │             │ - table_id (FK)│
│ - description       │       │ - restaurant_id │             │ - date         │
└─────────────────────┘       │ - category_id   │             │ - time         │
                              │ - name          │             │ - party_size   │
                              │ - price         │             │ - status       │
                              │ - description   │             │ - total_amount │
                              └─────────────────┘             └────────┬────────┘
                                                                   │
                    ┌──────────────────────────────────────────────┘
                    │
                    ▼
           ┌─────────────────┐         ┌─────────────────┐
           │     orders      │         │ order_item      │
           │                 │         │                 │
           │ - id (PK)       │────────▶│ - id (PK)       │
           │ - reservation_id│         │ - order_id (FK) │
           │ - customer_id   │         │ - menu_item_id  │
           │ - status        │         │ - quantity      │
           │ - total_amount  │         │ - unit_price    │
           │ - payment_status│         │ - subtotal      │
           └─────────────────┘         └─────────────────┘

┌─────────────────┐
│      staff      │
│                 │
│ - id (PK)       │
│ - restaurant_id │
│ - email         │
│ - name          │
│ - role          │
└─────────────────┘

┌─────────────────┐
│      admin      │
│                 │
│ - id (PK)       │
│ - email         │
│ - name          │
└─────────────────┘
*/

-- ============================================
-- COMMON QUERIES
-- ============================================

-- Get all restaurants
-- SELECT * FROM restaurant;

-- Get tables for a restaurant
-- SELECT * FROM table_location WHERE restaurant_id = ?;

-- Get reservation with customer and table details
-- SELECT r.*, c.name as customer_name, c.email, t.table_name
-- FROM reservation r
-- LEFT JOIN customer c ON r.customer_id = c.id
-- LEFT JOIN table_location t ON r.table_id = t.id
-- WHERE r.restaurant_id = ?;

-- Get orders with items for a reservation
-- SELECT o.*, oi.*
-- FROM orders o
-- LEFT JOIN order_item oi ON o.id = oi.order_id
-- WHERE o.reservation_id = ?;

-- Get revenue by restaurant (completed reservations)
-- SELECT r.name, COUNT(*) as total_orders, SUM(res.total_amount) as revenue
-- FROM reservation res
-- JOIN restaurant r ON res.restaurant_id = r.id
-- WHERE res.status = 'completed'
-- GROUP BY r.id, r.name;

-- Get peak hours (most reservations by hour)
-- SELECT EXTRACT(HOUR FROM reservation_time) as hour, COUNT(*) as count
-- FROM reservation
-- GROUP BY EXTRACT(HOUR FROM reservation_time)
-- ORDER BY count DESC;
