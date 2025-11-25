/*
 * Servicio: email_worker
 * Rol: Consumidor de la cola de RabbitMQ `email_queue` que toma mensajes
 *      (promociones/notificaciones) y envía correos vía SMTP usando Nodemailer.
 *
 * Flujo de alto nivel:
 * 1) Se conecta a RabbitMQ y asegura la cola `email_queue`.
 * 2) Resuelve configuración SMTP (MailHog por defecto; Gmail si hay credenciales).
 * 3) Crea el transporter de Nodemailer y empieza a consumir mensajes.
 * 4) Por cada mensaje: construye el correo y lo envía; ACK si éxito, NACK si error.
 *
 * Formato esperado del mensaje (JSON):
 * {
 *   to: "destinatario@dominio.com",          // requerido
 *   subject: "Asunto opcional",              // opcional
 *   body: "Texto del mensaje opcional",      // opcional
 *   tx_id: "id-relacionado-con-el-evento"    // opcional (para trazabilidad)
 * }
 */

const amqplib = require('amqplib');
const nodemailer = require('nodemailer');

const amqpUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EMAIL_QUEUE = 'email_queue';

// Parámetros SMTP (MailHog por defecto, Gmail si hay credenciales)
// Nota: estos valores pueden venir del .env de Docker Compose (infra/env/email_worker.env)
const env = {
  host: process.env.SMTP_HOST || 'smtp',
  port: parseInt(process.env.SMTP_PORT || '1025', 10),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  secureExplicit: typeof process.env.SMTP_SECURE !== 'undefined',
  provider: String(process.env.SMTP_PROVIDER || '').toLowerCase(),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || '',
};

function resolveSmtp() {
  // Punto único para decidir a qué servidor SMTP conectarse.
  // Por defecto usa MailHog (host `smtp`, puerto 1025). Si se detecta Gmail
  // y hay credenciales, configura automáticamente `smtp.gmail.com`.
  let { host, port, secure } = env;
  let from = env.from || env.user || 'no-reply@ledger.local';

  const hasCreds = env.user && env.pass;
  const wantsGmail = env.provider === 'gmail' || (env.user && env.user.endsWith('@gmail.com'));

  if (wantsGmail && hasCreds) {
    // Configuración robusta para Gmail (ignora combinaciones inválidas)
    host = 'smtp.gmail.com';
    const userPort = Number(process.env.SMTP_PORT);
    if (userPort === 465 || userPort === 587) {
      port = userPort;
    } else {
      port = 465; // default seguro
    }
    secure = port === 465; // 465 = SSL, 587 = STARTTLS
    from = env.from || env.user;
  } else if (wantsGmail && !hasCreds) {
    // Fallback seguro a MailHog cuando no hay credenciales
    host = 'smtp';
    port = 1025;
    secure = false;
  }

  const options = { host, port, secure };
  if (host.includes('smtp.gmail.com') && port === 587) {
    options.requireTLS = true; // Gmail en 587 requiere STARTTLS
  }
  if (hasCreds) options.auth = { user: env.user, pass: env.pass };

  return { options, from };
}

async function main() {
  // 1) Conexión a RabbitMQ y preparación de la cola
  console.log('[email_worker] iniciando...');
  const conn = await amqplib.connect(amqpUrl);
  const ch = await conn.createChannel();
  await ch.assertQueue(EMAIL_QUEUE, { durable: true });

  // 2) Resolver SMTP y crear transporter de Nodemailer
  const { options, from: defaultFrom } = resolveSmtp();
  const transport = nodemailer.createTransport(options);
  console.log('[email_worker] SMTP conectado a', options.host, 'puerto', options.port, 'secure=', options.secure);

  // Limitar concurrencia: como máximo 5 mensajes pendientes sin ACK
  await ch.prefetch(5);
  console.log('[email_worker] Esperando mensajes en', EMAIL_QUEUE);

  ch.consume(EMAIL_QUEUE, async (msg) => {
    if (!msg) return;
    try {
      // 3) Parsear el contenido del mensaje (Buffer → JSON)
      const payload = JSON.parse(msg.content.toString());

      // 4) Construir el correo a enviar. Si faltan `subject` o `body`,
      //    se usan valores razonables por defecto para que el envío no falle.
      const mail = {
        from: defaultFrom,
        to: payload.to,
        subject: payload.subject || `Notificación de transacción ${payload.tx_id}`,
        text: payload.body || JSON.stringify(payload, null, 2)
      };

      // 5) Enviar correo vía SMTP
      await transport.sendMail(mail);
      console.log(`[email_worker] Enviado correo a ${mail.to} (tx_id=${payload.tx_id})`);
      // 6) Confirmar el procesamiento del mensaje (ACK) para retirarlo de la cola
      ch.ack(msg);
    } catch (err) {
      console.error('[email_worker] Error procesando email:', err);
      // Reencolar el mensaje para reintento (NACK, requeue=true)
      ch.nack(msg, false, true);
    }
  }, { noAck: false });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
