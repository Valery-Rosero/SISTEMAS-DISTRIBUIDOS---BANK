//Escucha transacciones en Kafka y, cuando finalizan ( COMPLETED o FAILED ), encola un mensaje de email en RabbitMQ para que email_worker lo envíe.

const express = require('express');
const amqplib = require('amqplib');
const { Kafka } = require('kafkajs');

const app = express();
const port = process.env.PORT || 5000;
const kafkaBroker = process.env.KAFKA_BROKER || 'localhost:9092';
const amqpUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

const TOPIC_TRANSACTIONS = 'transactions_log';
const EMAIL_QUEUE = 'email_queue';

app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notification_router' }));

async function start() {
  const kafka = new Kafka({ brokers: [kafkaBroker] });
  const consumer = kafka.consumer({ groupId: 'notification_router' });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC_TRANSACTIONS, fromBeginning: false });

  const conn = await amqplib.connect(amqpUrl);
  const ch = await conn.createChannel();
  await ch.assertQueue(EMAIL_QUEUE, { durable: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        if (['COMPLETED', 'FAILED'].includes(event.status)) {
          const email = {
            to: event.email || `${event.from_user}@mail.local`,
            subject: `Transacción ${event.tx_id} ${event.status}`,
            body: `Detalles:\nDe: ${event.from_user}\nPara: ${event.to_user}\nMonto: $${event.amount}\nEstado: ${event.status}\nID: ${event.tx_id}`,
            tx_id: event.tx_id
          };
          ch.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(email)), { persistent: true });
          console.log('[notification_router] Encolado email:', email);
        }
      } catch (err) {
        console.error('[notification_router] Error procesando evento:', err);
      }
    }
  });
}

start().catch(err => { console.error('Fatal:', err); process.exit(1); });

app.listen(port, () => console.log(`notification_router escuchando en ${port}`));