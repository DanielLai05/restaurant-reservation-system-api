// clear_reservations.js - Delete all data from reservation table
const { Pool } = require('pg');
require('dotenv').config();

async function clearReservations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL
  });

  try {
    console.log('🗑️ 正在清空数据库中的所有数据...\n');
    
    // Delete in correct order to handle foreign key constraints
    // 1. order_item (references orders)
    const orderItemResult = await pool.query('DELETE FROM order_item');
    console.log(`✅ 已删除 ${orderItemResult.rowCount} 条 order_item 记录`);
    
    // 2. payment (references orders)
    const paymentResult = await pool.query('DELETE FROM payment');
    console.log(`✅ 已删除 ${paymentResult.rowCount} 条 payment 记录`);
    
    // 3. orders (references reservation)
    const orderResult = await pool.query('DELETE FROM orders');
    console.log(`✅ 已删除 ${orderResult.rowCount} 条 orders 记录`);
    
    // 4. reservation
    const reservationResult = await pool.query('DELETE FROM reservation');
    console.log(`✅ 已删除 ${reservationResult.rowCount} 条 reservation 记录`);
    
    // 5. cart_item (references cart)
    const cartItemResult = await pool.query('DELETE FROM cart_item');
    console.log(`✅ 已删除 ${cartItemResult.rowCount} 条 cart_item 记录`);
    
    // 6. cart
    const cartResult = await pool.query('DELETE FROM cart');
    console.log(`✅ 已删除 ${cartResult.rowCount} 条 cart 记录`);
    
    console.log('\n🎉 数据库已清空！所有预订、订单和购物车数据已删除。');
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    await pool.end();
  }
}

clearReservations();
