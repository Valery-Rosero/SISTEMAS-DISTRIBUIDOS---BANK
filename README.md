📘 Manual de Ejecución – Transacciones y Promociones (Ledger Bank)

Guía práctica para iniciar, monitorear y validar los servicios del sistema.

⭐ 1. Requisitos

Docker Desktop ejecutándose.

PowerShell abierto en:

c:\Users\Valery\SISTEMAS DISTRIBUIDOS\ENTREGAFINAL\ledger-bank

🚀 2. Transacciones
2.1. Arrancar servicios principales
docker compose -f "infra/docker-compose.yml" up -d --build zookeeper kafka rabbitmq transaction_api transaction_processor dashboard_aggregator dashboard_client

2.2. Verificar que la API de transacciones funciona
docker compose -f "infra/docker-compose.yml" logs -n 20 transaction_api

2.3. Abrir el tablero en vivo

Dashboard Web:
http://localhost:8080/

La tabla se actualiza por WebSocket en el puerto 8081.

✉️ 3. Promociones

3.1. Opción con Gmail
Editar archivo:
infra/env/email_worker.env

Con:

SMTP_PROVIDER=gmail
SMTP_USER=tu_usuario@gmail.com
SMTP_PASS=tu_app_password
SMTP_FROM=tu_usuario@gmail.com

Ejecutar:
docker compose -f "infra/docker-compose.yml" up -d --build email_worker ad_generator

📡 4. Monitoreo
Transacciones
docker compose -f "infra/docker-compose.yml" logs -f transaction_api
docker compose -f "infra/docker-compose.yml" logs -f transaction_processor
docker compose -f "infra/docker-compose.yml" logs -f dashboard_aggregator

Promociones
docker compose -f "infra/docker-compose.yml" logs -f ad_generator
docker compose -f "infra/docker-compose.yml" logs -f email_worker

⚙️ 5. Pruebas Rápidas
5.1. Enviar 12 transacciones aleatorias (PowerShell)
$uri = 'http://localhost:3000/transfer'

$users = @(
  @{ from_user='alice'; to_user='bob' },
  @{ from_user='carol'; to_user='dave' },
  @{ from_user='erin';  to_user='frank' }
)

$emails = @('vale.roserom23@gmail.com','nickyrosero159@gmail.com','nickolrosero5@gmail.com')
$rnd = [Random]::new()

for ($i=1; $i -le 12; $i++) {

  $u = $users[ $rnd.Next(0, $users.Count) ]
  $e = $emails[ $rnd.Next(0, $emails.Count) ]

  $amount = [Math]::Round(10 + ($rnd.NextDouble()*490), 2)

  $payload = @{
    from_user=$u.from_user;
    to_user=$u.to_user;
    amount=$amount;
    email=$e
  } | ConvertTo-Json -Compress

  try {
    $resp = Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $payload
    Write-Host ("accepted=$($resp.accepted) tx_id=$($resp.tx_id) amount=$amount from=$($u.from_user) to=$($u.to_user) email=$e")
  } catch {
    Write-Host ("ERROR: $($_.Exception.Message)")
  }

  Start-Sleep -Milliseconds 800
}

🔔 6. Validación de promociones

El ad_generator envía anuncios cada 30 segundos.

El email_worker debe registrar cada correo enviado:

docker compose -f "infra/docker-compose.yml" logs -f email_worker


Revisar bandeja de entrada y Spam de los tres correos configurados.

⛔ 7. Detener servicios
Todo el stack
docker compose -f "infra/docker-compose.yml" down

Solo servicios específicos
docker compose -f "infra/docker-compose.yml" stop <servicio1> <servicio2>

📝 8. Notas útiles

Si hay errores de Kafka, inicia primero:

docker compose -f "infra/docker-compose.yml" up -d zookeeper kafka


Si Gmail bloquea 587/STARTTLS, usar:

SMTP_PORT=465
SMTP_SECURE=true

Para reconstruir cualquier servicio:

docker compose -f "infra/docker-compose.yml" up -d --build <servicio>

🏗️ 9. Arquitectura y Flujo de Datos

Flujo de Transacciones
- Cliente envía `POST http://localhost:3000/transfer` con `{ from_user, to_user, amount, email? }`.
- `transaction_api` publica el comando en RabbitMQ cola `transfer_commands`.
- `transaction_processor` consume `transfer_commands`, simula resultado y publica eventos en Kafka tópico `transactions_log`.
- `fraud_detector` consume `transactions_log` y, si `amount > 10000`, publica alerta en Kafka tópico `fraud_alerts`.
- `dashboard_aggregator` consume `transactions_log` y `fraud_alerts`, mantiene estado en memoria y emite actualizaciones por WebSocket en `ws://localhost:8081`.
- `dashboard_client` se conecta al WebSocket y muestra la tabla en `http://localhost:8080`.

Flujo de Notificaciones y Promociones
- `notification_router` escucha `transactions_log` y encola correos en RabbitMQ `email_queue` cuando la transacción termina (`COMPLETED`/`FAILED`).
- `ad_generator` publica correos promocionales periódicos (cada ~30s) en `email_queue`.
- `email_worker` consume `email_queue` y envía correos vía SMTP:
  - MailHog: `SMTP_HOST=smtp`, `SMTP_PORT=1025`, UI en `http://localhost:8025`.
  - Gmail: `SMTP_PROVIDER=gmail`, `SMTP_USER`, `SMTP_PASS` (App Password), `SMTP_PORT=465/587`.

Servicios y Puertos
- `transaction_api`: `3000` (HTTP)
- `dashboard_client`: `8080` (HTTP)
- `dashboard_aggregator`: `4000` (HTTP), `8081` (WebSocket)
- `rabbitmq`: `5672` (AMQP), `15672` (Management UI)
- `kafka`: `9092` (Broker), `zookeeper`: `2181`
- `smtp` (MailHog): `1025` (SMTP), `8025` (UI)

📥 10. Endpoints de Salud y Métricas
- `GET http://localhost:3000/health` → `{ status: 'ok', service: 'transaction_api' }`
- `GET http://localhost:4000/health` → `{ status: 'ok', service: 'dashboard_aggregator' }`
- `GET http://localhost:4000/metrics` → Totales y timestamp
- `GET http://localhost:8080/health` → `{ status: 'ok', service: 'dashboard_client' }`
- `GET http://localhost:5000/health` → `{ status: 'ok', service: 'notification_router' }`

🧪 11. Ejemplos de Transacciones (rápidos)
- PowerShell (una sola transferencia):
  `Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/transfer' -ContentType 'application/json' -Body '{"from_user":"alice","to_user":"bob","amount":123.45,"email":"vale.roserom23@gmail.com"}'`
- curl.exe (Windows):
  `curl.exe -X POST http://localhost:3000/transfer -H "Content-Type: application/json" -d "{\"from_user\":\"alice\",\"to_user\":\"bob\",\"amount\":123.45,\"email\":\"vale.roserom23@gmail.com\"}"`

📦 12. Variables de Entorno (infra/env/*.env)
- `transaction_api.env`: `RABBITMQ_URL`
- `transaction_processor.env`: `RABBITMQ_URL`, `KAFKA_BROKER`
- `dashboard_aggregator.env`: `PORT`, `WS_PORT`, `KAFKA_BROKER`
- `dashboard_client.env`: `PORT`
- `fraud_detector.env`: `KAFKA_BROKER`, `THRESHOLD?`
- `notification_router.env`: `RABBITMQ_URL`, `KAFKA_BROKER`, `PORT`
- `email_worker.env`: `RABBITMQ_URL`, `SMTP_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `ad_generator.env`: `RABBITMQ_URL`, `PERIOD_MS?`

🩺 13. Troubleshooting
- Kafka no conecta: inicia primero Zookeeper y Kafka
  `docker compose -f "infra/docker-compose.yml" up -d zookeeper kafka`
- WebSocket no actualiza: revisa `dashboard_aggregator`
  `docker compose -f "infra/docker-compose.yml" logs -f dashboard_aggregator`
- RabbitMQ rechazo/conexión: verifica contenedor y Management UI
  `docker compose -f "infra/docker-compose.yml" ps` y `http://localhost:15672/`
- Gmail bloqueado: usa App Password y puerto `465` con `SMTP_SECURE=true`.
- Cambios de código no se reflejan: reconstruir servicio
  `docker compose -f "infra/docker-compose.yml" up -d --build <servicio>`

🧭 14. Formatos de Mensaje (referencia rápida)
- Comando de transferencia (RabbitMQ `transfer_commands`):
  `{ tx_id, from_user, to_user, amount, email?, created_at }`
- Evento de transacción (Kafka `transactions_log`):
  `{ tx_id, from_user, to_user, amount, status: 'COMPLETED'|'FAILED', email?, processed_at }`
- Alerta de fraude (Kafka `fraud_alerts`):
  `{ tx_id, reason: 'HIGH_VALUE_TRANSACTION', amount, at }`
- Email (RabbitMQ `email_queue`):
  `{ to, subject?, body?, tx_id? }`

✅ 15. Validación de Extremo a Extremo
- Transacciones: enviar 2–3 transferencias y verificar:
  - `transaction_processor` procesa y publica en Kafka.
  - `dashboard_aggregator` y `dashboard_client` muestran en tiempo real.
- Promociones/Notificaciones: levantar `smtp`, `email_worker`, `ad_generator` y confirmar correos en `http://localhost:8025`.
