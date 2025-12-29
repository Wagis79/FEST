#!/bin/bash
echo "🧪 Stress test: 20 randomiserade requests"
echo "================================================"
success=0
failed=0

for i in $(seq 1 20); do
  N=$((100 + RANDOM % 150))
  P=$((15 + RANDOM % 30))
  K=$((30 + RANDOM % 50))
  S=$((10 + RANDOM % 20))
  MAX=$((1 + RANDOM % 4))
  
  result=$(curl -s --max-time 60 -X POST "http://localhost:3010/api/recommend" \
    -H "Content-Type: application/json" \
    -d "{\"need\": {\"N\": $N, \"P\": $P, \"K\": $K, \"S\": $S}, \"requiredNutrients\": [\"N\", \"P\", \"K\", \"S\"], \"maxProducts\": $MAX}" 2>&1)
  
  count=$(echo "$result" | jq -r '.solutions | length' 2>/dev/null)
  
  if [ "$count" != "null" ] && [ -n "$count" ] && [ "$count" -ge 0 ] 2>/dev/null; then
    echo "✅ $i: N=$N max=$MAX -> $count solutions"
    success=$((success + 1))
  else
    echo "❌ $i: N=$N max=$MAX -> FAILED"
    failed=$((failed + 1))
  fi
done

echo ""
echo "================================================"
echo "📊 Resultat: $success lyckade, $failed misslyckade av 20"

# Kolla om servern fortfarande lever
health=$(curl -s --max-time 5 "http://localhost:3010/health" 2>/dev/null)
if echo "$health" | grep -q "OK"; then
  echo "✅ Servern lever fortfarande!"
else
  echo "❌ Servern har dött!"
fi
