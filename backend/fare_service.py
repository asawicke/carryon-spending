"""Provider-independent fare caching, durable request budget and selection checks."""
import hashlib
import json
import time
from urllib.parse import urlsplit

from flask import current_app
from .ignav import IgnavProvider, normalize_itinerary
from .providers import ProviderError, cached, put_cache


def provider():
    # Another adapter only needs name, search(query) and booking(offer_id).
    adapters = {"ignav": IgnavProvider}
    selected = adapters.get(current_app.config.get("FLIGHT_PROVIDER", "ignav"))
    if not selected:
        raise ProviderError("The selected flight provider is unavailable. Enter a fare manually.")
    if not current_app.config.get("IGNAV_API_KEY"):
        raise ProviderError("Flight search is not configured. You can enter a fare manually.", 503, "not_configured")
    return selected()


def reserve_request(db):
    day = "ignav:" + time.strftime("%Y-%m-%d", time.gmtime())
    limit = int(current_app.config.get("IGNAV_DAILY_LIMIT", 20))
    db.execute("INSERT OR IGNORE INTO flight_api_usage VALUES (?, 0)", (day,))
    allowed = db.execute("UPDATE flight_api_usage SET count=count+1 WHERE period=? AND count<?",
                         (day, limit)).rowcount
    db.commit()
    if not allowed:
        raise ProviderError("Today's local flight-search allowance is used. Enter a fare manually or try tomorrow UTC.",
                            429, "local_flight_limit")


def with_cache(db, key, fetch, ttl):
    row = cached(db, key)
    if row and row["expires_at"] > time.time():
        data = json.loads(row["data"])
        if data.get("error"):
            raise ProviderError(data["error"], data["status"], data["code"])
        return {**data, "cached": True}
    reserve_request(db)
    try:
        data = fetch()
        data.update(checkedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        put_cache(db, key, data, ttl)
        return {**data, "cached": False}
    except ProviderError as exc:
        put_cache(db, key, {"error": exc.message, "status": exc.status, "code": exc.code}, 60)
        raise


def search_fares(db, query):
    adapter = provider()
    # Include the account fingerprint so rotating keys cannot reuse another account's handoff IDs.
    account = hashlib.sha256(current_app.config["IGNAV_API_KEY"].encode()).hexdigest()[:16]
    identity = json.dumps([adapter.name, account, query], sort_keys=True)
    key = "fares:" + hashlib.sha256(identity.encode()).hexdigest()
    result = with_cache(db, key, lambda: {**adapter.search(query), "query": query,
                                        "source": adapter.name, "searchId": key}, 15 * 60)
    return result


def select_offer(db, search_id, offer_id):
    if not isinstance(search_id, str) or not search_id.startswith("fares:") or not isinstance(offer_id, str):
        raise ProviderError("Choose a fare from a current search.", 400, "invalid_selection")
    row = cached(db, search_id)
    if not row or row["expires_at"] <= time.time():
        raise ProviderError("That fare search expired. Search again for a current estimate.", 400, "expired_search")
    result = json.loads(row["data"])
    offer = next((item for item in result.get("offers", []) if item["offerId"] == offer_id), None)
    if not offer:
        raise ProviderError("That fare is not in this search. Search again.", 400, "invalid_selection")
    return {**offer, "query": result["query"], "source": result["source"],
            "observedAt": result["observedAt"], "checkedAt": result["checkedAt"]}


def booking_options(db, search_id, offer_id):
    select_offer(db, search_id, offer_id)
    adapter = provider()
    key = "booking:" + hashlib.sha256((search_id + offer_id).encode()).hexdigest()

    def fetch():
        raw = adapter.booking(offer_id)
        if not isinstance(raw.get("booking_options"), list):
            raise ProviderError("Booking options could not be read. Check the airline directly.")
        options = []
        for option in raw["booking_options"]:
            if not isinstance(option, dict):
                continue
            links = []
            for link in option.get("links", []) if isinstance(option.get("links"), list) else []:
                if not isinstance(link, dict) or not isinstance(link.get("url"), str):
                    continue
                url = link["url"]
                try:
                    parsed = urlsplit(url)
                    safe = parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password
                except ValueError:
                    safe = False
                if safe:
                    links.append({"url": url, "provider": str(link.get("provider_name", "Seller"))[:100],
                                  "specificity": link.get("specificity") if link.get("specificity") in
                                  ("exact_flight", "search_results") else "unspecified"})
            raw_legs = option.get("legs", [])
            legs = [item for item in raw_legs if item in ("outbound", "inbound")] if isinstance(raw_legs, list) else []
            if links:
                options.append({"legs": legs, "links": links})
        return {"options": options, "updatedQuote": normalize_itinerary(raw.get("itinerary"))}

    return with_cache(db, key, fetch, 5 * 60)
