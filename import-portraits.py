"""Match catalog players to openly licensed Wikimedia portraits by name and birth date."""
import argparse
import csv
from html import unescape
import json
from pathlib import Path
import re
import time
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
WIKIDATA = "https://www.wikidata.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"
LICENSE = re.compile(r"^/(?:licenses/(?:by|by-sa)/[1-4]\.0(?:/[a-z-]+)?|publicdomain/(?:zero|mark)/1\.0)/?$")


def api(endpoint, agent, **parameters):
    query = urlencode({"format": "json", "formatversion": 2, **parameters})
    request = Request(f"{endpoint}?{query}", headers={"User-Agent": agent, "Accept": "application/json"})
    with urlopen(request, timeout=8) as response:
        result = json.load(response)
    if "error" in result:
        raise RuntimeError(result["error"].get("code", "Wikimedia API error"))
    time.sleep(.2)
    return result


def claim(entity, prop):
    return [
        statement["mainsnak"]["datavalue"]["value"]
        for statement in entity.get("claims", {}).get(prop, [])
        if statement.get("rank") != "deprecated" and "datavalue" in statement["mainsnak"]
    ]


def identify(row, agent):
    for name in dict.fromkeys([row.get("long_name"), row.get("short_name")]):
        if not name:
            continue
        results = api(WIKIDATA, agent, action="wbsearchentities", search=name,
                      language="en", limit=5).get("search", [])
        if not results:
            continue
        entities = api(WIKIDATA, agent, action="wbgetentities", ids="|".join(r["id"] for r in results),
                       props="claims").get("entities", {})
        matches = [
            entity for entity in entities.values()
            if any(date.get("time", "")[1:11] == row["dob"] and date.get("precision", 0) >= 11
                   for date in claim(entity, "P569"))
            and any(job.get("id") == "Q937857" for job in claim(entity, "P106"))
        ]
        if len(matches) == 1:
            return claim(matches[0], "P18")
    return []


def plain(value):
    return unescape(re.sub(r"<[^>]*>", "", value)).strip()


def photo(files, agent):
    if not files:
        return None
    result = api(COMMONS, agent, action="query", prop="imageinfo", redirects=1,
                 titles="|".join("File:" + name for name in files[:5]),
                 iiprop="url|mime|extmetadata", iiurlwidth=250,
                 iiextmetadatafilter="LicenseShortName|LicenseUrl|Artist|Restriction")
    for page in result.get("query", {}).get("pages", []):
        if not page.get("imageinfo"):
            continue
        info = page["imageinfo"][0]
        if info.get("mime") not in {"image/jpeg", "image/png", "image/webp"}:
            continue
        metadata = info.get("extmetadata", {})
        license_url = metadata.get("LicenseUrl", {}).get("value", "")
        parsed = urlparse(license_url)
        author = plain(metadata.get("Artist", {}).get("value", ""))
        if parsed.hostname != "creativecommons.org" or not LICENSE.fullmatch(parsed.path):
            continue
        media = info.get("thumburl") or info["url"]
        if urlparse(media).hostname not in {"upload.wikimedia.org", "thumb.wikimedia.org"}:
            continue
        if parsed.path.startswith("/licenses/") and not author:
            continue
        return {
            "src": media, "original": info["url"], "source": info["descriptionurl"],
            "license": parsed._replace(scheme="https").geturl(), "author": author or "Autor desconhecido",
            "label": plain(metadata.get("LicenseShortName", {}).get("value", "")) or "Creative Commons",
        }
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="CSV de origem do FC 26, com player_id, nome completo e data de nascimento")
    parser.add_argument("--contact", required=True, help="Contato informado ao Wikimedia no User-Agent")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    agent = f"LANCEBALLPortraits/1.0 ({args.contact})"
    target = ROOT / "supabase/functions/_shared/licensed-portraits.json"
    portraits = json.loads(target.read_text(encoding="utf-8"))
    catalog = {row["id"]: row["overall"] for row in json.loads((ROOT / "catalog.json").read_text(encoding="utf-8-sig"))["players"]}
    with args.csv.open(encoding="utf-8-sig", newline="") as source:
        records = [row for row in csv.DictReader(source)
                   if row["player_id"] in catalog and row.get("dob") and row["player_id"] not in portraits]
    records.sort(key=lambda row: -catalog[row['player_id']])
    for index, row in enumerate(records[:args.limit], 1):
        portrait = photo(identify(row, agent), agent)
        if portrait:
            portraits[row["player_id"]] = portrait
            pending = target.with_suffix(".tmp")
            pending.write_text(json.dumps(portraits, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            pending.replace(target)
        if index % 25 == 0:
            print(f"{index} conferidos; {len(portraits)} retratos importados.", flush=True)
    print(f"{len(portraits)} retratos no arquivo de importação.")


if __name__ == "__main__":
    main()
