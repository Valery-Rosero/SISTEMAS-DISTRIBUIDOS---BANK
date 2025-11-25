// Protocolo estándar abierto y de mensajería para la comunicación entre diferentes sistemas y aplicaciones
const amqplib = require('amqplib');

// Lista de anuncios con destinatarios y asunto explícito
const ads = [
  {
    to: 'vale.roserom23@gmail.com',
    subject: 'Promoción: Nueva Tarjeta de Crédito',
    body: 'Aprovecha nuestra tarjeta con tasa preferencial y recompensas.'
  },
  {
    to: 'nickyrosero159@gmail.com',
    subject: 'Promoción: Bonos por referidos',
    body: 'Bonos por referir amigos. ¡Aprovecha!'
  },
  {
    to: 'nickolrosero5@gmail.com',
    subject: 'Promoción: Cuenta premium',
    body: 'Descubre beneficios exclusivos con la cuenta premium.'
  }
];

const amqpUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EMAIL_QUEUE = 'email_queue';
const PERIOD_MS = 30000;

//Crea conexión y canal AMQP y asegura la cola email_queue como durable
async function main() {
  console.log('[ad_generator] iniciando...');
  const conn = await amqplib.connect(amqpUrl);
  const ch = await conn.createChannel();
  await ch.assertQueue(EMAIL_QUEUE, { durable: true });

  let idx = 0;
  // Enviar un anuncio inmediato al iniciar, para validar rápidamente
  {
    const ad = { ...ads[idx % ads.length], tx_id: `ad-${Date.now()}` };
    ch.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(ad)), { persistent: true });
    console.log('[ad_generator] Enviado anuncio (inicio):', ad);
    idx++;
  }
  setInterval(() => {
    const ad = { ...ads[idx % ads.length], tx_id: `ad-${Date.now()}` };
    ch.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(ad)), { persistent: true });
    console.log('[ad_generator] Enviado anuncio:', ad);
    idx++;
  }, PERIOD_MS);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });