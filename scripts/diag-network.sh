#!/usr/bin/env bash
# Diagnoses why github.com is (not) reachable: DNS, TCP to several GitHub
# front-door IPs, plain HTTP vs HTTPS, and the route taken.
set -uo pipefail

echo "=== DNS ==="
for h in github.com api.github.com codeload.github.com raw.githubusercontent.com registry.npmjs.org; do
  printf '%-30s %s\n' "$h" "$(getent hosts "$h" | awk '{print $1}' | tr '\n' ' ')"
done

echo
echo "=== HTTPS handshake ==="
for h in github.com api.github.com codeload.github.com raw.githubusercontent.com registry.npmjs.org; do
  printf '%-30s %s\n' "$h" \
    "$(curl -s -o /dev/null -w 'http=%{http_code} dns=%{time_namelookup}s tcp=%{time_connect}s' --max-time 12 "https://$h" 2>&1)"
done

echo
echo "=== TCP connect to GitHub IPs ==="
for ip in 140.82.121.3 140.82.112.3 140.82.113.3 140.82.114.3 20.201.28.151; do
  if timeout 6 bash -c "exec 3<>/dev/tcp/$ip/443" 2>/dev/null; then
    echo "$ip:443 OPEN"
  else
    echo "$ip:443 unreachable"
  fi
done

echo
echo "=== route to github ==="
ip route get 140.82.121.3 2>&1 || true
echo
echo "=== default gateway reachable ==="
gw=$(ip route | awk '/^default/ {print $3; exit}')
echo "gateway: ${gw:-none}"
if [ -n "${gw:-}" ]; then
  ping -c 2 -W 3 "$gw" 2>&1 | tail -3
fi
