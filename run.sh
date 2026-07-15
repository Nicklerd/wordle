#!/usr/bin/env bash
set -e

docker compose up -d --build

echo ""
echo "✅ Word Arena запущена!"
echo ""
echo "   Локально:   http://localhost:3000"

# показать адрес для телефонов в той же сети
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$IP" ] && IP=$(ipconfig getifaddr en0 2>/dev/null)
[ -n "$IP" ] && echo "   Для телефонов в этой же Wi-Fi:  http://$IP:3000  ← открывай админку по этому адресу, тогда QR будет верный"

echo ""
echo "   Логи:       docker compose logs -f"
echo "   Остановить: docker compose down"
