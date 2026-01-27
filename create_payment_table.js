import dotenv from 'dotenv';
import { Pool } from 'pg';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { require: true },
});

async function createPaymentTable() {
  const client = await pool.connect();
  try {
    console.log('🔄 Checking payment table...');
    
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'payment'"
    );
    
    if (tables.rows.length === 0) {
      await client.query(`
        CREATE TABLE payment (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER NOT NULL,
          order_id INTEGER,
          amount DECIMAL(10,2) NOT NULL,
          payment_method VARCHAR(50) DEFAULT 'online',
          payment_status VARCHAR(50) DEFAULT 'pending',
          transaction_id VARCHAR(100),
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Created payment table');
    } else {
      console.log('✅ Payment table already exists');
    }
    
    console.log('✅ Database setup complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

createPaymentTable();
