# Supabase

## 1. Применить схему

Откройте SQL Editor проекта и выполните `schema.sql`. Скрипт создаёт:

- `plans` — справочник тарифов 5–200 ₽;
- `profiles` — ник, тариф, срок, монеты;
- `coin_purchases` — история покупок монет;
- `player_stats` — статистика из игрового мира;
- RLS-политики и RPC `purchase_plan`, `buy_coins`.

## 2. Вход по нику

Supabase Auth работает с email. Для входа по нику используйте синтетический адрес:

```
<nick в нижнем регистре>@players.nastroenie.local
```

и передавайте ник в метаданных:

```js
await supabase.auth.signUp({
  email: `${nick.toLowerCase()}@players.nastroenie.local`,
  password,
  options: { data: { nick } }
});
```

Чтобы такой вход работал сразу, в Auth → Providers → Email отключите **Confirm email**. Если оставить подтверждение, пользователю понадобится реальная почта.

## 3. Ключ

В Project Settings → API возьмите **publishable key** (`sb_publishable_...`) и положите только его в клиент. `service_role` в браузере не использовать.

## 4. Проверка после подключения

Выполните проверки из `../SECURITY.md`. Основное:

- чужой профиль не читается;
- `update profiles set coins = ...` напрямую запрещён;
- `insert into coin_purchases` напрямую запрещён;
- RPC работают только для авторизованного пользователя.

## 5. Ограничение

Покупки в схеме — демо: `buy_coins` начисляет монеты без проверки платежа. В продакшене вызывать RPC только после подтверждения оплаты на сервере.
