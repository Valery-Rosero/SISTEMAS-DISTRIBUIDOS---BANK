///Publica cada transferencia como comando en RabbitMQ ( transfer_commands ) para que otro servicio la procese.

const express = require('express');
const amqplib = require('amqplib');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const amqpUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const COMMAND_QUEUE = 'transfer_commands';

let amqpChannel;

async function initRabbit() {
  const conn = await amqplib.connect(amqpUrl);
  const ch = await conn.createChannel();
  await ch.assertQueue(COMMAND_QUEUE, { durable: true });
  amqpChannel = ch;
  console.log('[transaction_api] Conectado a RabbitMQ y cola preparada:', COMMAND_QUEUE);
}

app.use(express.json()); //Middleware para parsear JSON en el cuerpo de las peticiones ( req.body ).

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'transaction_api' }));

app.post('/transfer', async (req, res) => {
  try {
    const { from_user, to_user, amount, email } = req.body || {};
    if (!from_user || !to_user || typeof amount !== 'number') {
      return res.status(400).json({ error: 'Payload inválido' });
    }
    const tx_id = uuidv4();
    const command = { tx_id, from_user, to_user, amount, email, created_at: new Date().toISOString() };
    await amqpChannel.sendToQueue(COMMAND_QUEUE, Buffer.from(JSON.stringify(command)), { persistent: true });
    console.log('[transaction_api] Publicado comando:', command);
    res.json({ accepted: true, tx_id });
  } catch (err) {
    console.error('[transaction_api] Error publicando comando:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

initRabbit().catch(err => {
  console.error('RabbitMQ init error:', err);
  process.exit(1);
});

app.listen(port, () => {
  console.log(`transaction_api escuchando en puerto ${port}`);
});