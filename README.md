# Навык → Товар — полноценный deployable MVP

## Что внутри
- Node.js + Express сервер
- SQLite база заказов
- OpenAI Responses API
- Stripe Checkout + webhook
- генерация PDF
- генерация DOCX
- адаптивный сайт
- тарифы FREE / PRO $19 / BUNDLE $39
- health endpoint `/health`

OpenAI рекомендует Responses API для актуальных моделей; для cost-sensitive/high-volume задач в документации указан GPT-5.6 Luna. Stripe рекомендует Checkout Sessions для большинства платежных интеграций и автоматическое fulfillment через webhook `checkout.session.completed`.

## Запуск локально

Требования: Node.js 20+.

1. Распаковать архив.
2. `npm install`
3. Скопировать `.env.example` в `.env`
4. Заполнить `OPENAI_API_KEY`.
5. `npm start`
6. Открыть http://localhost:3000

Если `OPENAI_API_KEY` пустой, сайт работает в fallback-режиме без AI.

## Реальные платежи

1. Создайте Stripe account.
2. Получите Secret Key.
3. В `.env` задайте `STRIPE_SECRET_KEY`.
4. Задайте `APP_URL` публичным HTTPS-адресом.
5. Настройте Stripe webhook на:
   `https://ВАШ-ДОМЕН/webhook/stripe`
6. Событие: `checkout.session.completed`.
7. Скопируйте signing secret в `STRIPE_WEBHOOK_SECRET`.

Stripe Checkout создаёт hosted checkout session, а webhook позволяет автоматически выполнить заказ после успешной оплаты.

## Важно
- Не публикуйте `.env`.
- Не помещайте OPENAI_API_KEY или STRIPE_SECRET_KEY в браузерный JS.
- Перед реальным коммерческим запуском добавьте оферту, политику конфиденциальности, согласие на обработку данных, возвраты и реквизиты.
- Для продакшена желательно использовать PostgreSQL вместо SQLite и добавить rate limiting/authentication.

## Цены
FREE — $0
PRO — $19
BUNDLE — $39

Сейчас BUNDLE использует тот же базовый checkout-механизм; логику выдачи трёх продуктов можно расширить после проверки спроса.
