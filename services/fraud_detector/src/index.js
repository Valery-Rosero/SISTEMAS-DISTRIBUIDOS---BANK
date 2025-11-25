//Detecta transacciones de alto valor en Kafka y publica alertas en otro tópico

const { Kafka } = require('kafkajs');

const kafkaBroker = process.env.KAFKA_BROKER || 'localhost:9092';
const TOPIC_TRANSACTIONS = 'transactions_log';
const TOPIC_ALERTS = 'fraud_alerts';
const HIGH_VALUE_THRESHOLD = 10000;

async function ensureTopic(admin, topic) {
  const topics = await admin.listTopics();
  if (!topics.includes(topic)) {
    await admin.createTopics({ topics: [{ topic, numPartitions: 1, replicationFactor: 1 }] });
    console.log('[fraud_detector] Topic creado:', topic);
  }
}

async function main() {
  console.log('[fraud_detector] iniciando...');
  const kafka = new Kafka({ brokers: [kafkaBroker] });
  const admin = kafka.admin();
  await admin.connect();
  await ensureTopic(admin, TOPIC_ALERTS);
  await admin.disconnect();

  const consumer = kafka.consumer({ groupId: 'fraud_detector' });
  const producer = kafka.producer();
  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: TOPIC_TRANSACTIONS, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        if (event.amount > HIGH_VALUE_THRESHOLD) {
          const alert = { tx_id: event.tx_id, reason: 'HIGH_VALUE_TRANSACTION', amount: event.amount, at: new Date().toISOString() };
          await producer.send({ topic: TOPIC_ALERTS, messages: [{ key: String(alert.tx_id), value: JSON.stringify(alert) }] });
          console.log('[fraud_detector] Alerta publicada:', alert);
        }
      } catch (err) {
        console.error('[fraud_detector] Error analizando evento:', err);
      }
    }
  });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});