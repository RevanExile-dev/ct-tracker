"""Read-only sample of the deployed public API; never calls sync or Telegram.

python scripts/audit_public_prices.py --output /tmp/price-audit.json
This checks internal consistency, not equivalence with today's CardTrader
marketplace. Match live UI observations separately by language/condition/Zero.
"""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


def get_json(base, path):
    with urlopen(base + path, timeout=45) as response:
        return json.load(response)


def audit_card(base, blueprint_id):
    card = get_json(base, f"/api/cards/{blueprint_id}")
    listings = get_json(base, f"/api/cards/{blueprint_id}/listings")
    history = get_json(base, f"/api/cards/{blueprint_id}/history")
    if not isinstance(card, dict) or not isinstance(listings, list) or not isinstance(history, list):
        raise ValueError("Unexpected public API response shape")
    issues = []
    for key in ("latest_price_cents", "best_price_cents", "it_nm_zero_price_cents"):
        value = card.get(key)
        if value is not None and (not isinstance(value, (int, float))
                                  or not math.isfinite(value) or value < 0):
            issues.append(f"Invalid numeric price: {key}")
    exact = [row for row in listings if row.get("language") == "it"
             and row.get("condition") == "Near Mint" and row.get("can_sell_via_hub")
             and row.get("price_currency") == card.get("it_nm_zero_price_currency")]
    visible_min = min((row["price_cents"] for row in exact), default=None)
    if visible_min is not None and visible_min != card.get("it_nm_zero_price_cents"):
        issues.append("Exact-profile price differs from visible exact-profile listings")
    dates = [row.get("captured_at", "") for row in history]
    if dates != sorted(set(dates)):
        issues.append("History is unsorted or has duplicate dates")
    return {
        "id": blueprint_id, "name": card.get("name"), "version": card.get("version"),
        "cardtrader_url": f"https://www.cardtrader.com/cards/{blueprint_id}",
        "minimum_cents": card.get("latest_price_cents"),
        "best_cents": card.get("best_price_cents"),
        "best_profile": {key: card.get(key) for key in ("best_language", "best_condition", "best_can_sell_via_hub")},
        "exact_it_nm_zero_cents": card.get("it_nm_zero_price_cents"),
        "exact_listings_reported": card.get("it_nm_zero_listings_count"),
        "visible_listings": len(listings),
        "exact_visible_minimum_cents": visible_min,
        "latest_history_date": dates[-1] if dates else None,
        "history_points": len(history),
        "issues": issues,
        "limitation": "Listings endpoint is capped; missing exact offers do not prove absence. No per-card update timestamp in CardRow.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="https://ct-tracker-eight.vercel.app")
    parser.add_argument("--ids", type=int, nargs="+", default=[122678, 351655, 110911, 166453, 234316])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "base_url": base,
              "scope": "Public API sample, not full-market or live-CardTrader certification", "cards": [], "errors": []}
    try:
        report["meta"] = get_json(base, "/api/meta")
    except Exception as exc:
        report["errors"].append({"endpoint": "/api/meta", "error": str(exc)})
    for blueprint_id in dict.fromkeys(args.ids):
        try:
            result = audit_card(base, blueprint_id)
            report["cards"].append(result)
            print(f"{blueprint_id}: checked ({len(result['issues'])} consistency issues)", flush=True)
        except Exception as exc:
            report["errors"].append({"id": blueprint_id, "error": str(exc)})
            print(f"{blueprint_id}: unavailable ({exc})", flush=True)
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 1 if report["errors"] or any(card["issues"] for card in report["cards"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
