const express = require('express');
const { Kafka } = require('kafkajs');
const { Server: WebSocketServer } = require('ws');

const app = express();
const httpPort = process.env.PORT || 4000;
const wsPort = process.env.WS_PORT || 8081;
const kafkaBroker = process.env.KAFKA_BROKER || 'localhost:9092';

const TOPIC_TRANSACTIONS = 'transactions_log';
const TOPIC_ALERTS = 'fraud_alerts';

//Estructuras en memoria
const state = {
  transactions: new Map(), 
  alerts: new Set() 
};

function toList() {
  return Array.from(state.transactions.values()).map(tx => ({
    ...tx,
    suspicious: state.alerts.has(tx.tx_id)
  }));
}

// Endpoint de salud que responde estado básico y nombre del servicio.
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'dashboard_aggregator' }));
// Endpoint de métricas que devuelve el total de transacciones y alertas fraude, y la última actualización.
app.get('/metrics', (_req, res) => {
  res.json({
    totals: { transactions: state.transactions.size, fraudAlerts: state.alerts.size },
    updatedAt: new Date().toISOString()
  });
});

const wss = new WebSocketServer({ port: wsPort });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'snapshot', data: toList() }));
});

// Configura consumidores Kafka para transacciones y alertas fraude.
async function startKafka() {
  // Inicializa cliente Kafka con broker configurado.
  const kafka = new Kafka({ brokers: [kafkaBroker] });
  // Crea consumidores Kafka para topics transacciones y alertas fraude.
  const consumerTx = kafka.consumer({ groupId: 'dashboard_aggregator_tx' });
  const consumerAlerts = kafka.consumer({ groupId: 'dashboard_aggregator_alerts' });
  // Conecta consumidores a Kafka y suscribe a topics desde el principio.
  await consumerTx.connect();
  await consumerAlerts.connect();
  await consumerTx.subscribe({ topic: TOPIC_TRANSACTIONS, fromBeginning: false });
  await consumerAlerts.subscribe({ topic: TOPIC_ALERTS, fromBeginning: false });

  // Inicia consumidor Kafka para topic transacciones.
  await consumerTx.run({
    // Procesa cada mensaje de transacciones.
    eachMessage: async ({ message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        // Actualiza estado transacciones con el evento reciente.
        state.transactions.set(event.tx_id, event);
        // Envía evento transacción a todos los clientes WebSocket conectados.
        const payload = JSON.stringify({ type: 'transaction', data: event });
        wss.clients.forEach(client => { try { client.send(payload); } catch (_) {} });
      } catch (err) { console.error('[dashboard_aggregator] Error evento tx:', err); }
    }
  });

  // Inicia consumidor Kafka para topic alertas fraude.
  await consumerAlerts.run({
    // Procesa cada mensaje de alertas fraude.
    eachMessage: async ({ message }) => {
      try {
        const alert = JSON.parse(message.value.toString());
        // Actualiza estado alertas fraude con el evento reciente.
        state.alerts.add(alert.tx_id);
        // Envía evento alerta a todos los clientes WebSocket conectados.
        const payload = JSON.stringify({ type: 'alert', data: alert });
        wss.clients.forEach(client => { try { client.send(payload); } catch (_) {} });
      } catch (err) { console.error('[dashboard_aggregator] Error evento alerta:', err); }
    }
  });
  console.log('[dashboard_aggregator] Kafka consumidores iniciados');
}

startKafka().catch(err => { console.error('Kafka error:', err); process.exit(1); });

app.listen(httpPort, () => console.log(`dashboard_aggregator HTTP en ${httpPort}, WS en ${wsPort}`));