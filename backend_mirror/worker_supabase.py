import asyncio
import json
import time
import traceback
import os
import sys
import re
import argparse
import random
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from urllib.parse import quote

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
except Exception:  # pragma: no cover
    FastAPI = None  # type: ignore
    HTTPException = None  # type: ignore
    BaseModel = object  # type: ignore

# Ensure imports used by backend/main.py (e.g. `import audit_engine`) work even when
# this worker is launched from the repo root.
_BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_BACKEND_DIR, ".."))
for _p in (_REPO_ROOT, _BACKEND_DIR):
    if _p and _p not in sys.path:
        sys.path.insert(0, _p)


_CORE_NORMALIZE_PHONE = None


app = FastAPI() if FastAPI is not None else None

# Mount CKB-specific endpoints
try:
    from ckb_endpoints import router as ckb_router
    if app is not None:
        app.include_router(ckb_router)
except Exception:
    pass


def normalize_phone_italy(value: Optional[str]) -> Optional[str]:
    global _CORE_NORMALIZE_PHONE
    if not value:
        return None

    # Prefer the authoritative implementation from backend.main (lazy import + cache).
    if _CORE_NORMALIZE_PHONE is None:
        try:
            from backend import main as core  # type: ignore

            _CORE_NORMALIZE_PHONE = getattr(core, "normalize_phone_italy", None)
        except Exception:
            _CORE_NORMALIZE_PHONE = False

    if callable(_CORE_NORMALIZE_PHONE):
        try:
            return _CORE_NORMALIZE_PHONE(value)
        except Exception:
            pass

    # Fallback: keep only digits and leading '+' (best-effort, non-throwing)
    try:
        s = str(value).strip()
        if not s:
            return None
        keep_plus = s.startswith("+")
        digits = re.sub(r"\D+", "", s)
        if not digits:
            return None
        return ("+" if keep_plus else "") + digits
    except Exception:
        return None


def _digits_only_phone(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # Keep only digits and leading '+'
    keep_plus = s.startswith("+")
    digits = re.sub(r"\D+", "", s)
    if not digits:
        return None
    return ("+" if keep_plus else "") + digits

def _normalize_phone_compound(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None

    # Preserve explicit separators (avoid concatenating into a single huge number)
    if "/" in raw:
        parts = [p.strip() for p in raw.split("/")]
        normalized_parts: List[str] = []
        for p in parts:
            if not p:
                continue
            np = normalize_phone_italy(p)
            if np:
                normalized_parts.append(np)
        if normalized_parts:
            normalized_parts = list(dict.fromkeys(normalized_parts))
            return " / ".join(normalized_parts)
        return None

    return normalize_phone_italy(raw)


def _extract_first_social_link(html: Optional[str], kind: str) -> Optional[str]:
    if not html:
        return None
    h = str(html)
    if kind == "instagram":
        pat = re.compile(r"https?://(?:www\.)?instagram\.com/[^\s'\"<>]+", re.IGNORECASE)
    elif kind == "facebook":
        pat = re.compile(r"https?://(?:www\.)?(?:facebook\.com|fb\.me)/[^\s'\"<>]+", re.IGNORECASE)
    else:
        return None

    m = pat.search(h)
    if not m:
        return None
    url = (m.group(0) or "").strip().rstrip(").,;\"")
    return url or None


async def process_single_url(url: str) -> Dict[str, Any]:
    import re
    from backend.main import (
        audit_from_html,
        deep_scrape_email_from_website,
        deep_scrape_mobile_from_website,
        detect_tech_stack,
        extract_email_from_html,
        normalize_phone_italy,
    )
    from backend.audit_engine import run_technical_audit
    
    result = {
        "nome": None, "sito": url, "telefono": None, "email": None,
        "indirizzo": None, "citta": None, "categoria": None,
        "has_pixel": False, "has_gtm": False, "has_google_ads": False,
        "has_ssl": url.startswith("https"),
        "seo_errors": [], "load_speed_seconds": None, "tech_stack": None
    }
    
    try:
        # Use Playwright exactly like the worker loop does
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            
            pixel_found = False
            gtm_found = False
            requests_log = []
            page_title = None
            
            page.on("request", lambda req: requests_log.append(req.url))
            
            await page.goto(url, timeout=20000, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass
            await page.wait_for_timeout(1500)
            try:
                page_title = await page.title()
            except Exception:
                page_title = None
            html = await page.content()
            await browser.close()
            
            # Check pixel in HTML and network requests
            raw_lower = html.lower()
            pixel_found = (
                "fbevents.js" in raw_lower
                or "connect.facebook.net" in raw_lower
                or "fbq('init'" in raw_lower
                or 'fbq("init"' in raw_lower
                or "facebook.com/tr?id=" in raw_lower
                or any("fbevents.js" in r or "connect.facebook.net" in r or "facebook.com/tr" in r for r in requests_log)
            )
            gtm_found = (
                "gtm.js" in raw_lower
                or bool(re.search(r"\bGTM-[A-Z0-9]+\b", html))
                or any("gtm.js" in r or "GTM-" in r for r in requests_log)
            )
            ads_strings = ["googleads.g.doubleclick.net", "google_conversion", "gtag('config', 'AW-"]

            ads_found = any(
                any(s in r for r in requests_log) or s in html
                for s in ads_strings
            )
            
            result["has_pixel"] = pixel_found
            result["has_gtm"] = gtm_found
            result["has_google_ads"] = ads_found
            
            # Extract email
            email = None
            try:
                email = extract_email_from_html(html)
            except Exception:
                email = None
            if not email:
                email_match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', html)
                if email_match:
                    email = email_match.group(0)
            if not email:
                email = await asyncio.wait_for(
                    deep_scrape_email_from_website(url, html_home=html),
                    timeout=12,
                )
            result["email"] = email
            
            # Extract phone
            telefono = None
            try:
                telefono = await asyncio.wait_for(
                    deep_scrape_mobile_from_website(url, html),
                    timeout=8.0,
                )
            except Exception:
                telefono = None
            if not telefono:
                phone_match = re.search(
                    r'(\+39[\s.]?)?(0\d{1,3}[\s.\-\/]\d{3,8}|3\d{2}[\s.\-]\d{6,7}|\+39\s*3\d{9})',
                    html,
                )
                if phone_match:
                    try:
                        telefono = normalize_phone_italy(phone_match.group(0).strip())
                    except Exception:
                        telefono = phone_match.group(0).strip()
            # Guardrail: drop too-short numbers (common false positives)
            if telefono:
                digits = re.sub(r"\D+", "", str(telefono))
                if len(digits) < 8:
                    telefono = None
            result["telefono"] = telefono
            
            # Extract nome from title
            nome = None
            if isinstance(page_title, str) and page_title.strip():
                nome = page_title.strip()
            else:
                title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
                if title_match:
                    nome = title_match.group(1).strip()
            if isinstance(nome, str) and nome.strip():
                for suffix in [' - Home', ' | Home', ' – Home', ' - Benvenuto', ' | Benvenuto']:
                    nome = nome.replace(suffix, '')
                result["nome"] = nome.strip()
            
            # Tech stack
            try:
                result["tech_stack"] = detect_tech_stack(html)
            except Exception:
                pass
            
            # SSL
            result["has_ssl"] = url.startswith("https")
            
    except Exception as e:
        print(f"[process_single_url] error: {e}")
    
    # Run technical audit for SEO and speed
    try:
        tech = await asyncio.to_thread(run_technical_audit, url)
        result["seo_errors"] = tech.get("seo_issues", [])
        result["load_speed_seconds"] = tech.get("load_speed_seconds")
        if not result["has_google_ads"]:
            result["has_google_ads"] = tech.get("has_google_ads", False)
    except Exception as e:
        print(f"[process_single_url] tech audit error: {e}")

    # Compatibility payload for frontend/business result shape
    try:
        result["meta_pixel"] = bool(result.get("has_pixel"))
        result["google_tag_manager"] = bool(result.get("has_gtm"))
        result["pixel_missing"] = not bool(result.get("has_pixel"))
        result["tiktok_missing"] = True
        result["audit"] = {
            "has_ssl": bool(result.get("has_ssl")),
            "is_mobile_responsive": False,
            "has_facebook_pixel": bool(result.get("has_pixel")),
            "has_tiktok_pixel": False,
            "has_gtm": bool(result.get("has_gtm")),
            "missing_instagram": False,
        }
    except Exception:
        pass
    
    return result


if app is not None:
    class _AuditUrlRequest(BaseModel):
        url: str


    @app.post("/audit-url")
    async def audit_url(payload: _AuditUrlRequest) -> Dict[str, Any]:
        try:
            return await process_single_url(payload.url)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


async def _scrape_single_place_fallback(category: str, location: str, zone: Optional[str]) -> List[Dict[str, Any]]:
    """Fallback scraper for the 'single place card' scenario.

    When Google Maps opens directly a single business detail view (no list/feed),
    the core scraper may return 0 results. This function extracts the visible
    business fields from the detail panel and returns a single-row list.
    """

    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception as e:
        raise RuntimeError("Playwright not installed") from e

    def _compose_query() -> str:
        z = (zone or "").strip()
        if not z or z.lower() == "tutta la città":
            return f"{category} {location}"
        return f"{category} {location} {z}"

    q = _compose_query()
    url = f"https://www.google.com/maps/search/{quote(q)}?hl=it&gl=it&entry=ttu"

    def _normalize_phone_text(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        v = " ".join(str(value).split())
        v = re.sub(r"^telefono\s*:??\s*", "", v, flags=re.IGNORECASE)
        v = v.strip()
        return v or None

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=False,
            args=[
                "--lang=it-IT",
                "--disable-blink-features=AutomationControlled",
                "--no-default-browser-check",
            ],
        )
        context = browser.new_context(
            locale="it-IT",
            timezone_id="Europe/Rome",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1400, "height": 900},
        )
        page = context.new_page()
        page.set_default_timeout(20000)

        page.goto(url, wait_until="domcontentloaded", timeout=55000)
        page.wait_for_timeout(1400)

        # If a feed/list exists, this is not the single-card case.
        cards = page.locator('div[role="article"]')
        alt_cards = page.locator("div.Nv2PK")
        feed = page.locator('div[role="feed"]')
        if cards.count() > 0 or alt_cards.count() > 0 or feed.count() > 0:
            context.close()
            browser.close()
            return []

        # Best-effort extraction from detail view
        name = None
        for css in ("h1.DUwDvf", "h1", "div.DUwDvf"):
            try:
                t = page.locator(css).first.text_content(timeout=2500)
                t = (t or "").strip()
                if t:
                    name = t
                    break
            except Exception:
                continue

        address = None
        try:
            address = page.locator('button[data-item-id="address"]').first.text_content(timeout=2000)
        except Exception:
            address = None

        phone = None
        try:
            v = page.locator('button[data-item-id^="phone"]').first.text_content(timeout=2000)
            phone = _normalize_phone_text(v)
        except Exception:
            phone = None

        website = None
        try:
            website = page.locator('a[data-item-id="authority"]').first.get_attribute("href", timeout=2000)
        except Exception:
            website = None

        context.close()
        browser.close()

        if not name:
            return []
        return [
            {
                "business_name": name,
                "address": address.strip() if address else None,
                "phone": phone.strip() if phone else None,
                "website": website,
            }
        ]


async def _scrape_reviews_and_competitors(
    business_name: str,
    category: str,
    location: str,
) -> Dict[str, Any]:
    """Scrapa recensioni e competitor da Google Maps. Non-blocking: 
    in caso di errore ritorna dict vuoto senza crashare il worker."""
    result = {"google_reviews": [], "local_competitors": []}
    try:
        import random
        import re
        from playwright.async_api import async_playwright
        from urllib.parse import quote

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled"
                ]
            )
            context = await browser.new_context(
                locale="it-IT",
                timezone_id="Europe/Rome",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1400, "height": 900},
            )

            # --- RECENSIONI ---
            try:
                page = await context.new_page()
                query = quote(f"{business_name} {location}")
                url = f"https://www.google.com/maps/search/{query}?hl=it&gl=it"
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(random.uniform(1500, 2500))

                # Accetta cookie Google
                try:
                    await page.click(
                        'button:has-text("Accetta tutto")',
                        timeout=5000
                    )
                    await page.wait_for_timeout(2000)
                except:
                    try:
                        await page.click(
                            'button:has-text("Accept all")',
                            timeout=3000
                        )
                        await page.wait_for_timeout(2000)
                    except:
                        pass

                # Clicca sul primo risultato se siamo in lista
                first_result = page.locator('div.Nv2PK').first
                if await first_result.count() > 0:
                    await first_result.click()
                    await page.wait_for_timeout(random.uniform(1500, 2000))

                # Clicca sul tab Recensioni
                reviews_tab = page.locator('button[aria-label*="ecensioni"], button[data-tab-index="1"]').first
                if await reviews_tab.count() > 0:
                    await reviews_tab.click()
                    await page.wait_for_timeout(random.uniform(1000, 1500))

                # Scrapa le recensioni visibili (max 5)
                review_blocks = page.locator('div[data-review-id]')
                count = min(await review_blocks.count(), 5)
                reviews = []
                for idx in range(count):
                    try:
                        block = review_blocks.nth(idx)
                        # Espandi testo se presente
                        more_btn = block.locator('button.w8nwRe')
                        if await more_btn.count() > 0:
                            await more_btn.click()
                            await page.wait_for_timeout(300)
                        text = await block.locator('span.wiI7pd').first.text_content(timeout=2000)
                        stars_attr = await block.locator('span[aria-label*="stell"]').first.get_attribute('aria-label', timeout=2000)
                        stars = 5
                        if stars_attr:
                            m = re.search(r'(\d)', stars_attr)
                            if m:
                                stars = int(m.group(1))
                        if text and text.strip():
                            reviews.append({"text": text.strip()[:500], "stars": stars})
                    except Exception:
                        continue
                result["google_reviews"] = reviews
                await page.close()
            except Exception as e:
                print(f"[reviews_scraper] Errore recensioni: {e}")

            # --- COMPETITOR ---
            try:
                page2 = await context.new_page()
                comp_query = quote(f"{category} {location}")
                comp_url = f"https://www.google.com/maps/search/{comp_query}?hl=it&gl=it"
                await page2.goto(comp_url, wait_until="domcontentloaded", timeout=30000)
                await page2.wait_for_timeout(random.uniform(1500, 2500))

                # Accetta cookie Google
                try:
                    await page2.click(
                        'button:has-text("Accetta tutto")',
                        timeout=5000
                    )
                    await page2.wait_for_timeout(2000)
                except:
                    try:
                        await page2.click(
                            'button:has-text("Accept all")',
                            timeout=3000
                        )
                        await page2.wait_for_timeout(2000)
                    except:
                        pass

                competitor_cards = page2.locator('div.Nv2PK')
                total = min(await competitor_cards.count(), 6)
                competitors = []
                for idx in range(total):
                    try:
                        card = competitor_cards.nth(idx)
                        name = await card.locator('div.qBF1Pd').first.text_content(timeout=1500)
                        if not name or name.strip().lower() == business_name.strip().lower():
                            continue
                        rating_el = card.locator('span.MW4etd')
                        rating = None
                        if await rating_el.count() > 0:
                            rt = await rating_el.first.text_content(timeout=1000)
                            try:
                                rating = float(rt.replace(',', '.'))
                            except Exception:
                                pass
                        reviews_el = card.locator('span.UY7F9')
                        reviews_count = None
                        if await reviews_el.count() > 0:
                            rc = await reviews_el.first.text_content(timeout=1000)
                            try:
                                reviews_count = int(re.sub(r'\D', '', rc))
                            except Exception:
                                pass
                        competitors.append({
                            "name": name.strip(),
                            "rating": rating,
                            "reviews_count": reviews_count,
                        })
                        if len(competitors) >= 5:
                            break
                    except Exception:
                        continue
                result["local_competitors"] = competitors
                await page2.close()
            except Exception as e:
                print(f"[reviews_scraper] Errore competitor: {e}")

            await context.close()
            await browser.close()

    except Exception as e:
        print(f"[reviews_scraper] Errore generale: {e}")

    return result

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    load_dotenv = None

try:
    from supabase import create_client  # type: ignore
except Exception:  # pragma: no cover
    create_client = None

_SUPABASE_PUBLISHABLE_FALLBACK = "sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp"

def _load_env_files() -> None:
    try:
        if load_dotenv is None:
            return
        for env_path in (
            os.path.join(_BACKEND_DIR, ".env"),
            os.path.join(_REPO_ROOT, ".env"),
        ):
            try:
                load_dotenv(dotenv_path=env_path, override=False)
            except Exception:
                pass
    except Exception:
        pass

def _get_supabase_url() -> str:
    _load_env_files()
    return os.getenv("SUPABASE_URL", "https://rtjmnjromqpsfqsgyfvp.supabase.co").strip()

def _get_supabase_key() -> str:
    _load_env_files()

    # Prefer service role key (server-side only) to bypass RLS.
    # Do NOT hardcode secrets in source code.
    k = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
    if k:
        return k
    return _SUPABASE_PUBLISHABLE_FALLBACK


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _calc_freshness_score(last_audited_iso: Optional[str]) -> int:
    """Returns 0-100. Decays over 30 days."""
    if not last_audited_iso:
        return 0
    try:
        last = datetime.fromisoformat(str(last_audited_iso).replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        age_days = (now - last).total_seconds() / 86400
        score = max(0, int(100 - (age_days / 30) * 100))
        return score
    except Exception:
        return 0


def _calc_opportunity_score(r: Dict[str, Any]) -> int:
    score = 0
    try:
        tech = r.get("tech_stack") or []
        stack = " ".join(tech).lower() if isinstance(tech, list) else ""
        tr = r.get("technical_report") or {}

        if not r.get("meta_pixel") or "no pixel" in stack:
            score += 25
        if not r.get("sito") and not r.get("website"):
            score += 30
        if not r.get("instagram"):
            score += 10
        if tr.get("seo_disaster") or "disastro seo" in stack:
            score += 15
        if tr.get("has_dmarc") is False or "no dmarc" in stack:
            score += 10
        if "no mobile" in stack or "not mobile" in stack:
            score += 5
        if isinstance(tr.get("load_speed_seconds"), (int, float)) and float(tr.get("load_speed_seconds", 0) or 0) > 4.0:
            score += 5

        rating = r.get("rating")
        if isinstance(rating, (int, float)):
            if float(rating) < 3.5:
                score += 20
            elif float(rating) < 4.0:
                score += 10

        reviews = r.get("reviews_count") or 0
        if isinstance(reviews, (int, float)) and int(reviews) < 10:
            score += 5
    except Exception:
        pass
    return min(int(score), 100)


def _detect_changes(old: Dict[str, Any], new: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Compare old and new audit results and return change events."""
    changes: List[Dict[str, Any]] = []
    now = _utc_now_iso()
    logger = logging.getLogger("worker_supabase.changes")

    fields_to_watch = [
        ("meta_pixel", "Meta Pixel"),
        ("google_tag_manager", "Google Tag Manager"),
        ("instagram", "Instagram"),
        ("facebook", "Facebook"),
        ("sito", "Sito Web"),
        ("email", "Email"),
    ]

    try:
        for field, label in fields_to_watch:
            old_val = bool(old.get(field))
            new_val = bool(new.get(field))
            if old_val != new_val:
                changes.append(
                    {
                        "field": field,
                        "label": label,
                        "from": old_val,
                        "to": new_val,
                        "detected_at": now,
                        "signal": f"{label} {'installato' if new_val else 'rimosso'}",
                    }
                )

        old_rating = old.get("rating")
        new_rating = new.get("rating")
        if isinstance(old_rating, (int, float)) and isinstance(new_rating, (int, float)):
            diff = float(new_rating) - float(old_rating)
            if abs(diff) >= 0.3:
                direction = "salito" if diff > 0 else "sceso"
                changes.append(
                    {
                        "field": "rating",
                        "label": "Rating Google",
                        "from": old_rating,
                        "to": new_rating,
                        "detected_at": now,
                        "signal": f"Rating {direction} da {old_rating} a {new_rating}",
                    }
                )

        had_site = bool(old.get("sito") or old.get("website"))
        has_site = bool(new.get("sito") or new.get("website"))
        if had_site != has_site:
            changes.append(
                {
                    "field": "website_status",
                    "label": "Sito Web",
                    "from": had_site,
                    "to": has_site,
                    "detected_at": now,
                    "signal": "Sito web creato!" if has_site else "Sito web offline",
                }
            )
    except Exception as e:
        try:
            logger.warning(f"[changes] Errore detection: {e}")
        except Exception:
            pass

    return changes


def _format_results(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in rows:
        azienda_raw = r.get("business_name")
        azienda = (str(azienda_raw).strip() if azienda_raw is not None else "")
        if not azienda:
            azienda = "N/A"

        telefono = _normalize_phone_compound(r.get("phone")) or ""

        email_raw = r.get("email")
        email = (str(email_raw).strip() if email_raw is not None else "")

        website_raw = r.get("website")
        website = None
        try:
            ws = (str(website_raw).strip() if website_raw is not None else "")
            website = ws or None
        except Exception:
            website = None

        citta_raw = r.get("city")
        citta = (str(citta_raw).strip() if citta_raw is not None else "")
        if not citta:
            citta = "N/A"

        tech_stack_list_raw = r.get("tech_stack")
        tech_stack_list: List[str] = []
        if isinstance(tech_stack_list_raw, list):
            for x in tech_stack_list_raw:
                sx = str(x).strip()
                if sx:
                    tech_stack_list.append(sx)
        if not tech_stack_list:
            tech_stack_list = ["Verifica in corso"]

        result_dict: Dict[str, Any] = {
                "azienda": azienda,
                "telefono": telefono,
                "email": email,
                "sito": website,
                "website": website,
                "citta": citta,
                "tech_stack": tech_stack_list,

                "rating": r.get("rating"),
                "reviews_count": int(r.get("reviews_count") or 0),
                "is_claimed": r.get("is_claimed"),

                "instagram": r.get("instagram"),
                "facebook": r.get("facebook"),
                "meta_ads_library": r.get("meta_ads_library"),
                "decision_maker": r.get("decision_maker") or "N/D",
                "meta_pixel": bool(r.get("meta_pixel")),
                "google_tag_manager": bool(r.get("google_tag_manager")),
                "html_errors": int(r.get("html_errors") or 0),
                "technical_report": r.get("technical_report") or {},

                # Freshness
                "last_audited_at": _utc_now_iso(),
                "freshness_score": 100,
                "audit_version": 2,
            }

        try:
            result_dict["opportunity_score"] = _calc_opportunity_score(result_dict)
        except Exception:
            result_dict["opportunity_score"] = 0

        out.append(result_dict)
    return out


def _build_meta_ads_library_url(facebook_url: Optional[str], website_url: Optional[str]) -> Optional[str]:
    try:
        q: Optional[str] = None
        if facebook_url and isinstance(facebook_url, str):
            u = facebook_url.strip()
            if "facebook.com" in u:
                try:
                    # Normalize and extract the first path segment (page handle)
                    u2 = u.split("?", 1)[0]
                    parts = u2.split("facebook.com/", 1)[1].split("/")
                    handle = parts[0].strip()
                    if handle and handle.lower() not in {"pages", "profile.php"}:
                        q = handle
                except Exception:
                    q = None

        if not q and website_url and isinstance(website_url, str):
            try:
                from urllib.parse import urlparse

                netloc = (urlparse(website_url).netloc or "").split(":", 1)[0]
                if netloc.startswith("www."):
                    netloc = netloc[4:]
                q = netloc or None
            except Exception:
                q = None

        if not q:
            return None

        from urllib.parse import quote

        return (
            "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IT&q="
            + quote(q)
        )
    except Exception:
        return None


async def _run_core_scraper(category: str, location: str, zone: Optional[str] = None, on_result=None, on_audit_done=None) -> List[Dict[str, Any]]:
    # Import here to keep the module import light and avoid side effects at worker startup.
    # NOTE: This does NOT start the FastAPI server; main.py runs uvicorn only under __main__.
    # Also: the repo's `backend/` folder is not a Python package (no __init__.py), so we
    # add the repo root to sys.path and import `backend/main.py` as `backend.main`.
    # Defensive sys.path setup (in case this function is invoked in isolation)
    for _p in (_REPO_ROOT, _BACKEND_DIR):
        if _p and _p not in sys.path:
            sys.path.insert(0, _p)

    try:
        from backend import main as core  # type: ignore
    except ModuleNotFoundError as e:
        # Helpful diagnostics if imports fail on some machines.
        print("[worker_supabase] Import error while loading backend.main:", str(e))
        print("[worker_supabase] sys.path:")
        for p in sys.path[:15]:
            print(" -", p)
        raise

    AuditSignals = core.AuditSignals
    audit_website_with_status = core.audit_website_with_status
    deep_scrape_mobile_from_website = core.deep_scrape_mobile_from_website
    normalize_phone_italy = core.normalize_phone_italy
    normalize_website = core.normalize_website
    scrape_google_maps_playwright = core.scrape_google_maps_playwright
    run_technical_audit = getattr(core, "run_technical_audit", None)

    raw = await scrape_google_maps_playwright(category, location, zone, on_result=on_result)
    if not raw:
        # Fallback for cases where Maps opens directly a single activity card.
        try:
            one = await _scrape_single_place_fallback(category, location, zone)
            if one:
                raw = one
        except Exception:
            pass
    results: List[Dict[str, Any]] = []

    for i, item in enumerate(raw or []):
        name = item.get("business_name") or "Unknown"
        address = item.get("address")
        website = item.get("website")
        rating = item.get("rating")
        reviews_count = item.get("reviews_count")
        is_claimed = item.get("is_claimed")
        website_norm = normalize_website(website) if website else None

        phone_norm = normalize_phone_italy(item.get("phone"))
        phone_from_maps = phone_norm

        website_http_status: Optional[int] = None
        website_error: Optional[str] = None
        website_error_line: Optional[int] = None
        website_error_hint: Optional[str] = None
        website_html: Optional[str] = None
        website_has_html = False
        tech_stack = "Custom HTML"
        load_speed_s: Optional[float] = None
        domain_creation_date: Optional[str] = None
        domain_expiration_date: Optional[str] = None

        if website_norm:
            try:
                (
                    audit,
                    tech_stack,
                    load_speed_s,
                    domain_creation_date,
                    domain_expiration_date,
                    email,
                    website_http_status,
                    website_error,
                    website_html,
                    website_error_line,
                    website_error_hint,
                ) = await asyncio.wait_for(audit_website_with_status(website_norm), timeout=25.0)
            except asyncio.TimeoutError:
                audit, email = AuditSignals(), None
                tech_stack = "Custom HTML"
                load_speed_s = None
                domain_creation_date = None
                domain_expiration_date = None
                website_http_status, website_error = None, "Timeout"
                website_error_line, website_error_hint = None, "Timeout"
            except Exception:
                # Non-fatal: do not crash the entire worker if a single site audit fails.
                audit, email = AuditSignals(), None
                tech_stack = "Custom HTML"
                load_speed_s = None
                domain_creation_date = None
                domain_expiration_date = None
                website_http_status, website_error = None, "Audit failed"
                website_error_line, website_error_hint = None, "Audit failed"
            website_status = "HAS_WEBSITE"
        else:
            audit = AuditSignals()
            email = None
            website_status = "MISSING_WEBSITE"

        # NO WEBSITE shortcut: replicate desktop behavior (skip audits, mark opportunity)
        error_details: List[str] = []
        has_google_ads = False
        has_ga4 = False
        has_chatbot = False
        has_booking_system = False
        has_ecommerce = False
        has_spf = False
        has_dmarc = False
        seo_disaster = False
        decision_maker = "N/D"
        load_speed_seconds: Optional[float] = None
        if not website_norm:
            instagram = None
            facebook = None
            meta_pixel = False
            google_tag_manager = False
            html_errors = 0
            error_details = []
            has_google_ads = False
            has_ga4 = False
            has_chatbot = False
            has_booking_system = False
            has_ecommerce = False
            has_spf = False
            has_dmarc = False
            seo_disaster = False
            decision_maker = "N/D"
            load_speed_seconds = None
            tech_stack_list = ["NO WEBSITE"]
        else:
            instagram = _extract_first_social_link(website_html, "instagram")
            facebook = _extract_first_social_link(website_html, "facebook")

            # Strengthen TikTok detection: besides existing patterns, check for ttq.load and generic tiktok.com.
            html_lower = (website_html or "").lower() if website_html else ""
            tiktok_pixel = bool(getattr(audit, "has_tiktok_pixel", False)) or (
                "ttq.load" in html_lower or "tiktok.com" in html_lower
            )

            # Cookie banners (Cookiebot, Iubenda, etc.) often prevent JS execution, so rely on
            # raw HTML string scanning (including <script type="text/plain"> blocks).
            raw_html = website_html or ""
            raw_lower = raw_html.lower()

            meta_pixel = bool(getattr(audit, "has_facebook_pixel", False)) or (
                "fbevents.js" in raw_lower
                or "connect.facebook.net" in raw_lower
                or "fbq('init'" in raw_lower
                or "fbq(\"init\"" in raw_lower
            )

            google_tag_manager = bool(getattr(audit, "has_gtm", False)) or (
                "gtm.js" in raw_lower or bool(re.search(r"\bGTM-[A-Z0-9]+\b", raw_html, flags=re.IGNORECASE))
            )

            # Keep payload flags consistent even if audit engine couldn't detect them.
            try:
                setattr(audit, "has_facebook_pixel", bool(meta_pixel))
            except Exception:
                pass
            try:
                setattr(audit, "has_gtm", bool(google_tag_manager))
            except Exception:
                pass

            html_errors = 0
            if run_technical_audit is not None:
                try:
                    report = await asyncio.to_thread(run_technical_audit, website_norm, existing_phone=phone_from_maps)
                    issues = report.get("issues") if isinstance(report, dict) else None
                    if isinstance(issues, list):
                        html_errors = len(issues)
                    # Fill phone only if Maps didn't provide it.
                    try:
                        if not phone_from_maps and isinstance(report, dict) and report.get("phone"):
                            phone_norm = normalize_phone_italy(str(report.get("phone")))
                    except Exception:
                        pass
                    ed = report.get("error_details") if isinstance(report, dict) else None
                    if isinstance(ed, list):
                        error_details = [str(x) for x in ed if str(x).strip()]
                    has_google_ads = bool(report.get("has_google_ads")) if isinstance(report, dict) else False
                    has_ga4 = bool(report.get("has_ga4")) if isinstance(report, dict) else False
                    has_chatbot = bool(report.get("has_chatbot")) if isinstance(report, dict) else False
                    has_booking_system = bool(report.get("has_booking_system")) if isinstance(report, dict) else False
                    has_ecommerce = bool(report.get("has_ecommerce")) if isinstance(report, dict) else False
                    has_spf = bool(report.get("has_spf")) if isinstance(report, dict) else False
                    has_dmarc = bool(report.get("has_dmarc")) if isinstance(report, dict) else False
                    seo_disaster = bool(report.get("seo_disaster")) if isinstance(report, dict) else False
                    try:
                        decision_maker = (
                            str(report.get("decision_maker"))
                            if isinstance(report, dict) and report.get("decision_maker")
                            else "N/D"
                        )
                    except Exception:
                        decision_maker = "N/D"
                    try:
                        load_speed_seconds = (
                            float(report.get("load_speed_seconds"))
                            if isinstance(report, dict) and report.get("load_speed_seconds") is not None
                            else None
                        )
                    except Exception:
                        load_speed_seconds = None
                except Exception:
                    html_errors = 0
                    error_details = []
                    has_google_ads = False
                    has_ga4 = False
                    has_chatbot = False
                    has_booking_system = False
                    has_ecommerce = False
                    has_spf = False
                    has_dmarc = False
                    seo_disaster = False
                    decision_maker = "N/D"
                    load_speed_seconds = None

            tech_stack_list: List[str] = []

            # CMS / technologies from tech_stack string (normalize to labels)
            try:
                ts_raw = (tech_stack or "").strip() if isinstance(tech_stack, str) else ""
                key = ts_raw.lower()
                if "wordpress" in key:
                    tech_stack_list.append("WORDPRESS")
                elif "shopify" in key:
                    tech_stack_list.append("SHOPIFY")
                elif "wix" in key:
                    tech_stack_list.append("WIX")
            except Exception:
                pass

            # Positive signals
            try:
                if bool(getattr(audit, "has_ssl", False)):
                    tech_stack_list.append("SSL")
                if bool(getattr(audit, "is_mobile_responsive", False)):
                    tech_stack_list.append("MOBILE")
            except Exception:
                pass

            # Absence labels (sales opportunities)
            if not meta_pixel:
                tech_stack_list.append("MISSING FB PIXEL")
            else:
                tech_stack_list.append("Meta Pixel")

            if not google_tag_manager:
                tech_stack_list.append("MISSING GTM")
            else:
                tech_stack_list.append("GTM")

            if not tiktok_pixel:
                tech_stack_list.append("NO TIKTOK")
            else:
                tech_stack_list.append("TikTok Pixel")

            # Ads / GA4 / Chatbot (presence + absence)
            if has_google_ads:
                tech_stack_list.append("GOOGLE ADS")
            else:
                tech_stack_list.append("MISSING GOOGLE ADS")

            if has_ga4:
                tech_stack_list.append("GA4")
            else:
                tech_stack_list.append("MISSING GA4")

            if has_chatbot:
                tech_stack_list.append("CHATBOT AI")
            else:
                tech_stack_list.append("NO CHATBOT")

            # Booking / E-commerce radar (only add if present)
            if has_booking_system:
                tech_stack_list.append("SISTEMA PRENOTAZIONI")
            if has_ecommerce:
                tech_stack_list.append("E-COMMERCE")

            # Slow site trigger (use audit_engine measurement if available, fallback to existing load_speed_s)
            try:
                effective_speed = load_speed_seconds if load_speed_seconds is not None else load_speed_s
                if effective_speed is not None and float(effective_speed) > 4.0:
                    tech_stack_list.append("SITO LENTO")
            except Exception:
                pass

            # DMARC/SPF trigger
            try:
                if has_dmarc:
                    tech_stack_list.append("DMARC OK")
                else:
                    tech_stack_list.append("EMAIL IN SPAM (NO DMARC)")
            except Exception:
                pass

            # SEO disaster trigger
            try:
                if seo_disaster:
                    tech_stack_list.append("DISASTRO SEO (NO H1/TITLE)")
            except Exception:
                pass

        # Maps claimed trigger
        try:
            if is_claimed is False:
                tech_stack_list.append("SCHEDA NON RIVENDICATA")
        except Exception:
            pass

        # De-duplicate while preserving order
        try:
            tech_stack_list = list(dict.fromkeys([t for t in tech_stack_list if str(t).strip()]))
        except Exception:
            pass

        # If audit failed or yielded nothing useful, keep a non-empty label.
        if not tech_stack_list:
            tech_stack_list = ["Verifica in corso"]

        if website_norm:
            try:
                deep_mobile = await asyncio.wait_for(
                    deep_scrape_mobile_from_website(website_norm, website_html),
                    timeout=8.0,
                )
                # Merge mobile found on website with Maps phone (often a landline).
                # If Maps phone is missing, fallback to the mobile.
                existing = (phone_norm or "").strip() if isinstance(phone_norm, str) else ""
                existing_valid = bool(existing) and existing.upper() not in {"N/D", "N/A", "NONE", "NULL"}

                if deep_mobile:
                    if not existing_valid:
                        phone_norm = deep_mobile
                    else:
                        try:
                            existing_digits = re.sub(r"\D+", "", existing)
                            mobile_digits = re.sub(r"\D+", "", str(deep_mobile))
                            already_present = bool(mobile_digits) and mobile_digits in existing_digits
                        except Exception:
                            already_present = False

                        if not already_present:
                            phone_norm = f"{existing} / {deep_mobile}"
            except Exception:
                pass

        if website_html:
            website_has_html = True

        meta_ads_library = _build_meta_ads_library_url(facebook, website_norm)

        results.append(
            {
                "result_index": i,
                "business_name": name,
                "address": address,
                "phone": phone_norm,
                "email": email,
                "website": website_norm,
                "website_status": website_status,
                "tech_stack": tech_stack_list,
                "load_speed_s": load_speed_s,
                "domain_creation_date": domain_creation_date,
                "domain_expiration_date": domain_expiration_date,
                "website_http_status": website_http_status,
                "website_error": website_error,
                "website_has_html": website_has_html,
                "website_error_line": website_error_line,
                "website_error_hint": website_error_hint,
                "instagram_missing": bool(getattr(audit, "missing_instagram", False)),
                "tiktok_missing": not bool(getattr(audit, "has_tiktok_pixel", False)),
                "pixel_missing": not bool(getattr(audit, "has_facebook_pixel", False)),
                "instagram": instagram,
                "facebook": facebook,
                "meta_ads_library": meta_ads_library,
                "decision_maker": decision_maker,
                "meta_pixel": meta_pixel,
                "google_tag_manager": google_tag_manager,
                "html_errors": html_errors,
                "technical_report": {
                    "html_errors": html_errors,
                    "load_speed_s": load_speed_s,
                    "load_speed_seconds": load_speed_seconds,
                    "error_details": error_details,
                    "has_google_ads": has_google_ads,
                    "has_ga4": has_ga4,
                    "has_chatbot": has_chatbot,
                    "has_booking_system": has_booking_system,
                    "has_ecommerce": has_ecommerce,
                    "has_spf": has_spf,
                    "has_dmarc": has_dmarc,
                    "seo_disaster": seo_disaster,
                },
                "audit": {
                    "has_ssl": bool(getattr(audit, "has_ssl", False)),
                    "is_mobile_responsive": bool(getattr(audit, "is_mobile_responsive", False)),
                    "has_facebook_pixel": bool(getattr(audit, "has_facebook_pixel", False)),
                    "has_tiktok_pixel": bool(getattr(audit, "has_tiktok_pixel", False)),
                    "has_gtm": bool(getattr(audit, "has_gtm", False)),
                    "missing_instagram": bool(getattr(audit, "missing_instagram", False)),
                },
                "category": category,
                "city": location,
                "rating": rating,
                "reviews_count": reviews_count,
                "is_claimed": is_claimed,
                "google_reviews": [],
                "local_competitors": [],
            }
        )

        # Progressive update: notify caller with current results (includes email)
        if on_audit_done:
            try:
                on_audit_done(list(results))
            except Exception:
                pass

    # Arricchisci ogni lead con recensioni e competitor
    # Lo facciamo DOPO il loop principale per non interferire con lo scraping
    for lead in results:
        try:
            enrichment = await asyncio.wait_for(
                _scrape_reviews_and_competitors(
                    business_name=lead.get("business_name", ""),
                    category=category,
                    location=location,
                ),
                timeout=45.0
            )
            lead["google_reviews"] = enrichment.get("google_reviews", [])
            lead["local_competitors"] = enrichment.get("local_competitors", [])
            await asyncio.sleep(random.uniform(1.0, 2.0))
        except Exception as e:
            print(f"[enrichment] Errore per {lead.get('business_name','?')}: {e}")
            # Non crashare — i campi restano liste vuote

    return results


def main() -> None:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument(
        "--enqueue",
        action="store_true",
        help="Inserisce job (status=pending) in Supabase senza avviare il worker.",
    )
    parser.add_argument(
        "--reaudit",
        action="store_true",
        help="Lancia il worker di re-audit (aggiorna lead esistenti)",
    )
    parser.add_argument(
        "--reaudit-max",
        type=int,
        default=20,
        help="Numero massimo di lead da ri-auditare (default: 20)",
    )
    parser.add_argument(
        "--user-id",
        type=str,
        default="",
        help="UUID user_id da associare ai job inseriti (necessario per --enqueue).",
    )
    parser.add_argument(
        "--cities",
        type=str,
        default="",
        help="Lista citta' separata da virgola, es: Milano,Roma,Torino",
    )
    parser.add_argument(
        "--categories",
        type=str,
        default="",
        help="Lista categorie separata da virgola, es: dentista,idraulico,ristorante",
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=0,
        help="Numero massimo di lead per job (0 = default scraper).",
    )
    parser.add_argument(
        "--mode",
        type=str,
        default="all",
        choices=["all", "user", "backlog"],
        help="Selezione job: all=user+backlog, user=solo user_id non nullo, backlog=solo user_id nullo.",
    )
    parser.add_argument(
        "--cooldown",
        type=int,
        default=20,
        help="Pausa (secondi) tra un job e il successivo.",
    )
    parser.add_argument(
        "--user-recent-minutes",
        type=int,
        default=10,
        help="In --mode user, considera solo job creati negli ultimi N minuti.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Esegue un solo ciclo del worker (un job pending se presente) e poi termina.",
    )

    args, _unknown = parser.parse_known_args()

    # Re-audit worker mode (runs independently from the normal polling loop)
    if bool(getattr(args, "reaudit", False)):
        try:
            max_l = int(getattr(args, "reaudit_max", 20) or 20)
        except Exception:
            max_l = 20
        run_reaudit_worker(max_leads=max_l)
        return

    if create_client is None:
        print("ERROR: supabase-py non è installato.")
        print("Installa con: pip install supabase")
        raise SystemExit(2)

    if load_dotenv is None:
        print(
            "[worker_supabase] INFO: python-dotenv non installato. "
            "Se vuoi leggere SUPABASE_SERVICE_ROLE_KEY da .env: pip install python-dotenv"
        )

    supabase_key = _get_supabase_key()
    if supabase_key == _SUPABASE_PUBLISHABLE_FALLBACK:
        print(
            "[worker_supabase] WARNING: stai usando la publishable key come fallback. "
            "Se hai RLS attiva, setta la variabile d'ambiente SUPABASE_SERVICE_ROLE_KEY."
        )

    supabase_url = _get_supabase_url()
    supabase = create_client(supabase_url, supabase_key)

    def _split_csv(s: str) -> List[str]:
        try:
            parts = [p.strip() for p in (s or "").split(",")]
            return [p for p in parts if p]
        except Exception:
            return []

    if bool(getattr(args, "enqueue", False)):
        cities = _split_csv(getattr(args, "cities", ""))
        categories = _split_csv(getattr(args, "categories", ""))
        user_id = (getattr(args, "user_id", "") or "").strip()
        if not cities or not categories:
            print("[worker_supabase] --enqueue richiede --cities e --categories")
            raise SystemExit(2)
        if not user_id:
            print("[worker_supabase] --enqueue richiede anche --user-id (UUID)")
            raise SystemExit(2)

        now_iso = _utc_now_iso()
        payloads: List[Dict[str, Any]] = []
        for city in cities:
            for cat in categories:
                # NOTE: the user's Supabase schema does NOT have a 'zone' column.
                payloads.append(
                    {
                        "user_id": user_id,
                        "status": "pending",
                        "category": cat,
                        "location": city,
                        "results": None,
                        "created_at": now_iso,
                    }
                )

        print(f"[worker_supabase] Enqueue jobs: {len(payloads)}")
        try:
            resp = supabase.table("searches").insert(payloads).execute()
            data = getattr(resp, "data", None)
            if isinstance(data, list) and data:
                ids = [str((r or {}).get("id")) for r in data if isinstance(r, dict) and (r or {}).get("id")]
                if ids:
                    print("[worker_supabase] Inseriti job id:")
                    for jid in ids[:50]:
                        print(" -", jid)
        except Exception as e:
            print("[worker_supabase] ERROR enqueue:", str(e))
            print(traceback.format_exc())
            raise SystemExit(2)

        print("[worker_supabase] Done (enqueue).")
        return

    # Optional: allow extracting more than the default cap from Google Maps.
    try:
        mr = int(getattr(args, "max_results", 0) or 0)
        if mr > 0:
            os.environ["DEMO_MAX_RESULTS"] = str(mr)
    except Exception:
        pass

    print("[worker_supabase] Avviato")
    print(f"[worker_supabase] Supabase URL: {supabase_url}")
    print("[worker_supabase] Polling tabella: searches (status=pending) ogni 4 secondi")

    mode = str(getattr(args, "mode", "all") or "all").strip().lower()
    if mode not in {"all", "user", "backlog"}:
        mode = "all"
    try:
        cooldown_s = int(getattr(args, "cooldown", 20) or 20)
    except Exception:
        cooldown_s = 20
    try:
        user_recent_minutes = int(getattr(args, "user_recent_minutes", 10) or 10)
    except Exception:
        user_recent_minutes = 10

    if user_recent_minutes < 0:
        user_recent_minutes = 0

    while True:
        try:
            # Desync workers to reduce stampedes / race windows.
            try:
                time.sleep(random.uniform(1.0, 5.0))
            except Exception:
                pass

            rows = []
            expected_pending_status = "pending"
            if mode in {"all", "user"}:
                # Priority 1: realtime user jobs (most recent first)
                expected_pending_status = "pending"
                q = (
                    supabase.table("searches")
                    .select("*")
                    .eq("status", "pending")
                )
                if mode == "user" and user_recent_minutes > 0:
                    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=user_recent_minutes)).isoformat()
                    q = q.gte("created_at", cutoff)
                resp = (
                    q.order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                rows = getattr(resp, "data", None) or []

            # Backlog selection
            if (not rows) and mode in {"all", "backlog"}:
                resp = (
                    supabase.table("searches")
                    .select("*")
                    .eq("status", "pending")
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                rows = getattr(resp, "data", None) or []
                expected_pending_status = "pending"

            if not rows:
                time.sleep(4)
                continue

            job = rows[0]

            job_id = job.get("id")
            category = (job.get("category") or "").strip()
            location = (job.get("location") or "").strip()
            zone = (job.get("zone") or None)

            if not job_id:
                print("[worker_supabase] WARNING: riga pending senza id. La salto.")
                time.sleep(4)
                continue

            if not category or not location:
                print(f"[worker_supabase] WARNING: job {job_id} mancante di category/location. Setto error.")
                supabase.table("searches").update(
                    {
                        "status": "error",
                        "results": {
                            "error": "Missing category or location",
                            "ts": _utc_now_iso(),
                        },
                    }
                ).eq("id", job_id).execute()
                time.sleep(1)
                continue

            print(f"[worker_supabase] Trovata richiesta pending id={job_id} :: {category} @ {location}")

            # Atomic claim: only one worker should be able to update pending -> processing.
            claim = (
                supabase.table("searches")
                .update(
                    {
                        "status": "processing",
                        "results": None,
                    }
                )
                .eq("id", job_id)
                .eq("status", expected_pending_status)
                .execute()
            )

            claimed_rows = getattr(claim, "data", None) or []
            if not claimed_rows:
                print("[worker_supabase] Job già preso da un collega, salto...")
                time.sleep(1)
                continue

            print(f"[worker_supabase] Job {job_id} -> processing. Avvio scraper...")

            # Real-time result callback: push each result to DB as it's found
            _rt_results = []
            _rt_lock = __import__('threading').Lock()
            def _on_maps_result(raw_item):
                try:
                    fmt = _format_results([raw_item])
                    if fmt:
                        with _rt_lock:
                            _rt_results.extend(fmt)
                            snapshot = list(_rt_results)
                        supabase.table("searches").update({"results": snapshot}).eq("id", job_id).execute()
                except Exception:
                    pass

            # Progressive audit callback: update DB with full results (incl. email) after each site audit
            def _on_audit_done(audited_results):
                try:
                    fmt = _format_results(audited_results)
                    if fmt:
                        supabase.table("searches").update({"results": fmt}).eq("id", job_id).execute()
                except Exception:
                    pass

            core_results = asyncio.run(_run_core_scraper(category=category, location=location, zone=zone, on_result=_on_maps_result, on_audit_done=_on_audit_done))
            formatted = _format_results(core_results)

            try:
                if formatted:
                    print(f"DEBUG DATA: {formatted[0]}")
                    print("[worker_supabase] Debug first result:")
                    print(json.dumps(formatted[0], ensure_ascii=False))
            except Exception:
                pass

            print(f"[worker_supabase] Job {job_id} completato. Risultati: {len(formatted)}")

            supabase.table("searches").update(
                {
                    "status": "completed",
                    "results": formatted,
                }
            ).eq("id", job_id).execute()

            # Cooldown between jobs (avoid hammering and give browser/OS time to settle)
            time.sleep(max(0, cooldown_s))

            if bool(getattr(args, "once", False)):
                print("[worker_supabase] --once richiesto: termino dopo 1 job.")
                return

        except KeyboardInterrupt:
            print("[worker_supabase] Stop richiesto dall'utente.")
            return
        except Exception as e:
            err = str(e) or e.__class__.__name__
            print("[worker_supabase] ERROR:", err)
            print(traceback.format_exc())

            # Best effort: if we have an id in scope, mark error
            try:
                if "job_id" in locals() and locals().get("job_id"):
                    supabase.table("searches").update(
                        {
                            "status": "error",
                            "results": {
                                "error": err,
                                "trace": traceback.format_exc(),
                                "ts": _utc_now_iso(),
                            },
                        }
                    ).eq("id", locals()["job_id"]).execute()
            except Exception:
                pass

            time.sleep(4)
async def _reaudit_single_lead(
    lead_data: Dict[str, Any],
    supabase,
) -> Optional[Dict[str, Any]]:
    """Re-audit a single lead's website and return updated dict (or None)."""
    logger = logging.getLogger("worker_supabase.reaudit")

    try:
        website = (lead_data.get("sito") or lead_data.get("website") or "").strip()
        if not website:
            return None

        # Import from backend
        try:
            for _p in (_BACKEND_DIR, _REPO_ROOT):
                if _p not in sys.path:
                    sys.path.insert(0, _p)
            from backend import main as core  # type: ignore
        except Exception:
            return None

        audit_fn = getattr(core, "audit_website_with_status", None)
        if not audit_fn:
            return None

        try:
            (
                audit,
                tech_stack,
                load_speed_s,
                domain_creation_date,
                domain_expiration_date,
                email,
                http_status,
                error,
                html,
                error_line,
                error_hint,
            ) = await asyncio.wait_for(audit_fn(website), timeout=20.0)
        except asyncio.TimeoutError:
            try:
                logger.warning(f"[reaudit] Timeout per {website}")
            except Exception:
                pass
            return None
        except Exception as e:
            try:
                logger.warning(f"[reaudit] Errore audit per {website}: {e}")
            except Exception:
                pass
            return None

        updated: Dict[str, Any] = dict(lead_data)
        try:
            updated["meta_pixel"] = bool(getattr(audit, "has_facebook_pixel", False))
        except Exception:
            pass
        try:
            updated["google_tag_manager"] = bool(getattr(audit, "has_gtm", False))
        except Exception:
            pass

        updated["last_audited_at"] = _utc_now_iso()
        updated["freshness_score"] = 100
        updated["audit_version"] = 2

        try:
            updated["opportunity_score"] = _calc_opportunity_score(updated)
        except Exception:
            pass

        try:
            if email and not lead_data.get("email"):
                updated["email"] = email
        except Exception:
            pass

        # Detect what changed
        try:
            changes = _detect_changes(lead_data, updated)
            existing_changes = lead_data.get("change_history") or []
            if isinstance(existing_changes, list):
                updated["change_history"] = existing_changes + changes
            else:
                updated["change_history"] = changes

            if changes:
                try:
                    logger.info(
                        f"[reaudit] {lead_data.get('azienda','?')} — {len(changes)} cambiamenti"
                    )
                except Exception:
                    pass
        except Exception:
            pass

        return updated
    except Exception as e:
        try:
            logger.warning(f"[reaudit] Errore per lead: {e}")
        except Exception:
            pass
        return None


def run_reaudit_worker(max_leads: int = 20) -> None:
    """Background worker: re-audit stale leads stored in completed searches."""
    logger = logging.getLogger("worker_supabase.reaudit")
    try:
        logger.info(f"[reaudit] Avvio re-audit worker (max {max_leads} lead)")
    except Exception:
        pass

    try:
        supabase_key = _get_supabase_key()
        if create_client is None:
            try:
                logger.error("[reaudit] supabase-py non installato")
            except Exception:
                pass
            return

        supabase = create_client(_get_supabase_url(), supabase_key)
    except Exception:
        return

    reaudited = 0
    try:
        resp = (
            supabase.table("searches")
            .select("id, results, created_at")
            .eq("status", "completed")
            .not_.is_("results", "null")
            .order("created_at", desc=False)
            .limit(50)
            .execute()
        )
        rows = getattr(resp, "data", None) or []
        try:
            logger.info(f"[reaudit] Trovate {len(rows)} ricerche candidate")
        except Exception:
            pass

        for row in rows:
            if reaudited >= max_leads:
                break

            job_id = (row or {}).get("id")
            results = (row or {}).get("results") or []
            if not isinstance(results, list) or not results:
                continue

            updated_results: List[Any] = []
            changed = False

            for lead in results:
                if reaudited >= max_leads:
                    updated_results.append(lead)
                    continue
                if not isinstance(lead, dict):
                    updated_results.append(lead)
                    continue

                last_audited = lead.get("last_audited_at")
                freshness = _calc_freshness_score(last_audited)
                if freshness > 40 and last_audited:
                    updated_results.append(lead)
                    continue

                website = (lead.get("sito") or lead.get("website") or "").strip()
                if not website:
                    updated_results.append(lead)
                    continue

                try:
                    logger.info(f"[reaudit] Re-auditing: {lead.get('azienda','?')} | {website}")
                except Exception:
                    pass

                updated_lead = None
                try:
                    updated_lead = asyncio.run(_reaudit_single_lead(lead, supabase))
                except Exception:
                    updated_lead = None

                if updated_lead:
                    updated_results.append(updated_lead)
                    changed = True
                    reaudited += 1
                else:
                    updated_results.append(lead)

                try:
                    time.sleep(random.uniform(0.5, 1.5))
                except Exception:
                    pass

            if changed and job_id:
                try:
                    supabase.table("searches").update({"results": updated_results}).eq("id", job_id).execute()
                    try:
                        logger.info(f"[reaudit] Job {job_id} aggiornato")
                    except Exception:
                        pass
                except Exception as e:
                    try:
                        logger.error(f"[reaudit] Errore salvataggio: {e}")
                    except Exception:
                        pass

            try:
                time.sleep(random.uniform(2.0, 4.0))
            except Exception:
                pass

    except Exception as e:
        try:
            logger.error(f"[reaudit] Errore critico: {e}")
        except Exception:
            pass

    try:
        logger.info(f"[reaudit] Completato. Lead ri-auditati: {reaudited}")
    except Exception:
        pass


from playwright.async_api import async_playwright


@app.post("/scrape-reviews")
async def scrape_reviews(data: dict):
    business_name = data.get("business_name", "")
    city = data.get("city", "")
    if not business_name:
        return {"reviews": [], "rating": 0, "total": 0}

    # Usa la funzione già esistente e funzionante
    try:
        result = await asyncio.wait_for(
            _scrape_reviews_and_competitors(
                business_name=business_name,
                category="",
                location=city,
            ),
            timeout=45.0
        )
        reviews = result.get("google_reviews", [])
        return {
            "reviews": reviews,
            "rating": 0,
            "total": len(reviews)
        }
    except Exception as e:
        return {"reviews": [], "rating": 0, "total": 0, "error": str(e)}


@app.post("/scrape-competitors")
async def scrape_competitors(data: dict):
    category = data.get("category", "")
    city = data.get("city", "")
    if not category or not city:
        return {"competitors": []}

    # Usa la funzione già esistente e funzionante
    try:
        result = await asyncio.wait_for(
            _scrape_reviews_and_competitors(
                business_name="",
                category=category,
                location=city,
            ),
            timeout=45.0
        )
        return {"competitors": result.get("local_competitors", [])}
    except Exception as e:
        return {"competitors": [], "error": str(e)}


@app.post("/scrape-social")
async def scrape_social(data: dict):
    instagram_url = data.get("instagram_url", "")
    facebook_url = data.get("facebook_url", "")
    result = {}

    if not instagram_url and not facebook_url:
        return result

    try:
        async with async_playwright() as p:
            # User agent iPhone — unico modo per leggere Instagram
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-blink-features=AutomationControlled"
                ]
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                    "Version/16.6 Mobile/15E148 Safari/604.1"
                ),
                locale="it-IT",
                viewport={"width": 390, "height": 844}
            )

            # INSTAGRAM
            if instagram_url:
                page = await context.new_page()
                try:
                    await page.goto(
                        instagram_url,
                        timeout=25000,
                        wait_until="domcontentloaded"
                    )
                    await page.wait_for_timeout(3000)

                    followers = "N/D"
                    posts = 0

                    # Metodo 1: meta description (più affidabile)
                    meta = await page.query_selector('meta[name="description"]')
                    if meta:
                        content = await meta.get_attribute('content') or ""
                        # Formato IT: "1.520 follower, 320 seguiti, 45 post"
                        # Formato EN: "1,520 Followers, 320 Following, 45 Posts"
                        f_match = re.search(
                            r'([\d.,KkMm]+)\s*(?:follower|Follower)',
                            content, re.I
                        )
                        if f_match:
                            followers = f_match.group(1)
                        p_match = re.search(
                            r'(\d+)\s*(?:post|Post)',
                            content, re.I
                        )
                        if p_match:
                            posts = int(p_match.group(1))

                    # Metodo 2: titolo pagina
                    if followers == "N/D":
                        title = await page.title()
                        if title:
                            f_match = re.search(
                                r'([\d.,KkMm]+)\s*(?:follower|Follower)',
                                title, re.I
                            )
                            if f_match:
                                followers = f_match.group(1)

                    result["instagram"] = {
                        "found": True,
                        "url": instagram_url,
                        "followers": followers,
                        "posts": posts
                    }
                except Exception as e:
                    result["instagram"] = {
                        "found": False,
                        "url": instagram_url,
                        "error": str(e)
                    }
                finally:
                    await page.close()

            # FACEBOOK
            if facebook_url:
                page = await context.new_page()
                try:
                    await page.goto(
                        facebook_url,
                        timeout=25000,
                        wait_until="domcontentloaded"
                    )
                    await page.wait_for_timeout(3000)

                    likes = "N/D"
                    followers_fb = "N/D"

                    # Metodo 1: meta description
                    meta = await page.query_selector('meta[name="description"]')
                    if meta:
                        content = await meta.get_attribute('content') or ""
                        f_match = re.search(
                            r'([\d.,KkMm]+)\s*(?:Mi piace|like|follower)',
                            content, re.I
                        )
                        if f_match:
                            likes = f_match.group(1)

                    # Metodo 2: testo pagina
                    if likes == "N/D":
                        body = await page.inner_text('body')
                        f_match = re.search(
                            r'([\d.,]+)\s*(?:Mi piace|persone seguono)',
                            body, re.I
                        )
                        if f_match:
                            likes = f_match.group(1)

                    result["facebook"] = {
                        "found": True,
                        "url": facebook_url,
                        "likes": likes,
                        "followers": followers_fb
                    }
                except Exception as e:
                    result["facebook"] = {
                        "found": False,
                        "url": facebook_url,
                        "error": str(e)
                    }
                finally:
                    await page.close()

            await context.close()
            await browser.close()
    except Exception as e:
        return {"error": str(e)}

    return result


@app.post("/scrape-registry")
async def scrape_registry(data: dict):
    business_name = data.get("business_name", "")
    city = data.get("city", "")
    if not business_name:
        return {"found": False}

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox"]
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                locale="it-IT"
            )
            page = await context.new_page()

            # Cerca su registroimprese.it
            await page.goto("https://www.registroimprese.it/",
                          timeout=20000, wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)

            # Accetta cookie (Didomi banner su registroimprese.it)
            for cookie_sel in [
                'button.didomi-dismiss-button',
                'button:has-text("Accetta")',
                '#didomi-notice-agree-button',
                'button:has-text("Accetto")',
                'button:has-text("OK")',
            ]:
                try:
                    el = await page.query_selector(cookie_sel)
                    if el:
                        await el.click()
                        await page.wait_for_timeout(1000)
                        break
                except:
                    continue

            # Compila il campo di ricerca e cerca
            search_input = await page.query_selector('#inputSearchField')
            if not search_input:
                search_input = await page.query_selector('#inputSearchFieldMob')
            if not search_input:
                search_input = await page.query_selector('input[placeholder*="Nome Impresa"]')
            if not search_input:
                await browser.close()
                return {"found": False, "reason": "search_input_not_found"}

            query_str = f"{business_name} {city}".strip()
            await search_input.fill(query_str)
            await page.wait_for_timeout(500)

            # Click CERCA button
            search_btn = await page.query_selector('button.btnCercaGratuita')
            if not search_btn:
                search_btn = await page.query_selector('button.buttonCerca')
            if not search_btn:
                search_btn = await page.query_selector('button:has-text("CERCA")')
            if search_btn:
                await search_btn.click()
            else:
                await page.keyboard.press("Enter")
            await page.wait_for_timeout(4000)

            # Clicca primo risultato
            clicked = False
            for sel in [
                'a.company-name',
                '.nome-impresa a',
                'h3 a',
                '.result-item a',
                '.result a',
                'table tbody tr:first-child a',
                '.ri-search-result a',
                'ul.results li:first-child a',
                '.portlet-body a[href*="impresa"]',
            ]:
                try:
                    el = await page.query_selector(sel)
                    if el:
                        await el.click()
                        await page.wait_for_timeout(3000)
                        clicked = True
                        break
                except:
                    continue

            if not clicked:
                # Try to extract data from the search results page itself
                body_text = await page.inner_text('body')
                if business_name.lower() in body_text.lower():
                    clicked = True  # We have data on results page
                else:
                    await browser.close()
                    return {"found": False, "reason": "no_clickable_result"}

            # Leggi testo completo e parsa i campi
            body_text = await page.inner_text('body')

            res = {"found": True}

            patterns = {
                "ragione_sociale": [
                    r'(?:Denominazione|Ragione sociale)[:\s]+([^\n]+)',
                    r'(?:Nome impresa)[:\s]+([^\n]+)'
                ],
                "forma_giuridica": [
                    r'(?:Forma giuridica|Natura giuridica)[:\s]+([^\n]+)'
                ],
                "codice_ateco": [
                    r'(?:Codice ATECO|ATECO)[:\s]+([^\n]+)',
                    r'(?:Attività principale)[:\s]+([^\n]+)'
                ],
                "data_costituzione": [
                    r'(?:Data (?:di )?costituzione|Costituita il|'
                    r'Data iscrizione)[:\s]+([^\n]+)'
                ],
                "sede_legale": [
                    r'(?:Sede legale|Indirizzo sede)[:\s]+([^\n]+)'
                ],
                "stato": [
                    r'(?:Stato attività|Stato impresa|Status)[:\s]+([^\n]+)'
                ]
            }

            for field, pats in patterns.items():
                val = "N/D"
                for pat in pats:
                    m = re.search(pat, body_text, re.I)
                    if m:
                        val = m.group(1).strip()[:100]
                        break
                res[field] = val

            await browser.close()

            # Se tutti N/D non abbiamo trovato nulla di utile
            filled = [
                v for k, v in res.items()
                if k != "found" and v != "N/D"
            ]
            if not filled:
                return {"found": False, "reason": "nessun_dato_estratto"}

            return res

    except Exception as e:
        return {"found": False, "error": str(e)}


@app.post("/search-maps-single")
async def search_maps_single(data: dict):
    """Scrape Google Maps for ONE single business by name.
    Input: {"business_name": str, "city": str (optional), "max_results": int (optional, default 1)}
    Output: {"found": bool, "results": [{"name","website","phone","address","city","category","rating","reviews_count"}]}

    Used by Cerca Azienda Singola to get the CANONICAL website from Maps
    (same source of truth as Ricerca Categoria+Città).
    Non-breaking: never raises, returns {"found": False, "error": ...} on failure.
    """
    business_name = (data.get("business_name") or data.get("query") or "").strip()
    city = (data.get("city") or data.get("location") or "").strip()
    max_results = int(data.get("max_results") or 1)
    if not business_name:
        return {"found": False, "results": [], "error": "business_name required"}

    q = f"{business_name} {city}".strip()
    url = f"https://www.google.com/maps/search/{quote(q)}?hl=it&gl=it&entry=ttu"

    def _clean_phone(v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        s = " ".join(str(v).split())
        s = re.sub(r"^telefono\s*:?\s*", "", s, flags=re.IGNORECASE)
        return s.strip() or None

    results: List[Dict[str, Any]] = []
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
            )
            context = await browser.new_context(
                locale="it-IT",
                timezone_id="Europe/Rome",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1400, "height": 900},
            )
            page = await context.new_page()
            page.set_default_timeout(20000)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(2000)

                # Accept cookies if prompted
                for sel in [
                    'button[aria-label*="Accetta"]',
                    'button:has-text("Accetta tutto")',
                    'button:has-text("Accetta")',
                ]:
                    try:
                        el = await page.query_selector(sel)
                        if el:
                            await el.click()
                            await page.wait_for_timeout(800)
                            break
                    except Exception:
                        continue

                # Decide if we are on single-place card or list
                cards = await page.query_selector_all('div[role="article"]')
                alt_cards = await page.query_selector_all("div.Nv2PK")
                is_list = (len(cards) > 0) or (len(alt_cards) > 0)

                async def _extract_from_detail_panel() -> Optional[Dict[str, Any]]:
                    name_el = await page.query_selector("h1.DUwDvf, h1, div.DUwDvf")
                    name = (await name_el.text_content() if name_el else None)
                    name = (name or "").strip() or None
                    if not name:
                        return None
                    website = None
                    try:
                        w_el = await page.query_selector('a[data-item-id="authority"]')
                        if w_el:
                            website = await w_el.get_attribute("href")
                    except Exception:
                        pass
                    phone = None
                    try:
                        ph_el = await page.query_selector('button[data-item-id^="phone"]')
                        if ph_el:
                            ph_txt = await ph_el.text_content()
                            phone = _clean_phone(ph_txt)
                    except Exception:
                        pass
                    address = None
                    try:
                        a_el = await page.query_selector('button[data-item-id="address"]')
                        if a_el:
                            a_txt = await a_el.text_content()
                            address = (a_txt or "").strip() or None
                    except Exception:
                        pass
                    category = None
                    try:
                        c_el = await page.query_selector('button[jsaction*="category"]')
                        if c_el:
                            c_txt = await c_el.text_content()
                            category = (c_txt or "").strip() or None
                    except Exception:
                        pass
                    rating = None
                    reviews_count = None
                    try:
                        r_el = await page.query_selector('div.F7nice span[aria-hidden="true"]')
                        if r_el:
                            rating_txt = (await r_el.text_content() or "").replace(",", ".").strip()
                            try:
                                rating = float(rating_txt)
                            except Exception:
                                pass
                        rc_el = await page.query_selector('div.F7nice span[aria-label*="recensioni"], div.F7nice span[aria-label*="reviews"]')
                        if rc_el:
                            rc_txt = (await rc_el.text_content() or "")
                            m = re.search(r"(\d[\d\.\,]*)", rc_txt)
                            if m:
                                try:
                                    reviews_count = int(m.group(1).replace(".", "").replace(",", ""))
                                except Exception:
                                    pass
                    except Exception:
                        pass
                    return {
                        "name": name,
                        "website": website,
                        "phone": phone,
                        "address": address,
                        "category": category,
                        "rating": rating,
                        "reviews_count": reviews_count,
                    }

                if not is_list:
                    item = await _extract_from_detail_panel()
                    if item:
                        results.append(item)
                else:
                    # Click first card and extract
                    try:
                        first_card = cards[0] if cards else alt_cards[0]
                        await first_card.click()
                        await page.wait_for_timeout(2000)
                        item = await _extract_from_detail_panel()
                        if item:
                            results.append(item)
                    except Exception:
                        pass
            finally:
                try: await context.close()
                except Exception: pass
                try: await browser.close()
                except Exception: pass
    except Exception as e:
        return {"found": False, "results": [], "error": str(e)}

    results = results[:max_results] if results else []
    return {"found": len(results) > 0, "results": results}


if __name__ == "__main__":
    main()
