"""One bounded poll for a configured provider. Schedule externally as appropriate.

Credentials are read only from an environment variable, never copied into an
artifact or output. A failed poll exits nonzero; existing records age naturally.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from backend.app.sensorthings_provider import fetch_page, import_page
from backend.app.realtime_store import load_snapshot
from backend.app.realtime_ingestion import ZHEJIANG_CITY_ORDER


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--snapshot", type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    url = config["url"]
    parsed = urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    secret = os.environ.get(config.get("token_env", "CITYOS_PROVIDER_TOKEN"))
    seen = set()
    for _ in range(10):
        if url in seen:
            raise ValueError("pagination cycle")
        seen.add(url)
        page = fetch_page(url, allowed_origin=origin, bearer_token=secret)
        import_page(page, config, args.store)
        next_url = page.get("@iot.nextLink")
        if not next_url:
            break
        url = urljoin(url, next_url)
    else:
        raise ValueError("pagination exceeds bounded 10-page poll")
    snapshot = {"region_id": "zhejiang", **load_snapshot(args.store, city_order=ZHEJIANG_CITY_ORDER)}
    if args.snapshot:
        args.snapshot.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.snapshot.with_suffix(".tmp")
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False) + "\n")
        temporary.replace(args.snapshot)
    print(json.dumps({"status": snapshot["status"], "stored_record_count": snapshot["stored_record_count"], "forecast_input_ready": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Provider errors can embed URLs or tokens. Do not print raw exceptions.
        raise SystemExit("Provider poll failed. Check local configuration, access, schema and page limits; no credentials logged.")
