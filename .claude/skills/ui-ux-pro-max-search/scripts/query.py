"""Bounded, read-only CLI for the upstream BM25 core; candidate, not yet approved."""
import argparse
import json
from core import search

FIELDS = {
    "style": ("Style ID", "Style Category", "Best For", "Primary Colors", "Effects & Animation", "Preferred Mode", "Complexity"),
    "color": ("Product Type", "Primary", "On Primary", "Secondary", "Accent", "Background", "Foreground", "Card", "Border"),
    "typography": ("Font Pairing Name", "Heading Font", "Body Font", "Best For", "Mood/Style Keywords"),
    "landing": ("Pattern Name", "Section Order", "Primary CTA Placement", "Color Strategy"),
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("domain", choices=FIELDS)
    parser.add_argument("query")
    args = parser.parse_args()
    if not 1 <= len(args.query) <= 200:
        parser.error("Query must have 1 to 200 characters")
    result = search(args.query, domain=args.domain, max_results=2)
    rows = [{key: str(row.get(key, ""))[:250] for key in FIELDS[args.domain]} for row in result.get("results", [])]
    print(json.dumps({"domain": args.domain, "results": rows}, ensure_ascii=False, indent=2))
    return 1 if result.get("error") else 0

if __name__ == "__main__":
    raise SystemExit(main())
